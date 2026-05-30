# Home Service Extended Hours & Anti-Korupsi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend home service availability to 06:00–23:00 WIB, create a tamper-proof job lifecycle tracked via WhatsApp double-verification (kapster + pelanggan), auto-flag no-shows, and log every transaction to Moka.

**Architecture:** The booking form passes `type=home_service` to the slot engine, which widens its window to 06:00–23:00 and filters for `home_service_enabled` barbers. After booking, a `home_service_jobs` row tracks lifecycle state. WhatsApp commands `BERANGKAT` / `SELESAI` / `YA` advance the status and notify the other party; a 15-minute cron flags jobs that go stale.

**Tech Stack:** Node.js, Supabase (PostgreSQL + PostgREST), Fonnte WhatsApp API, Vercel Cron, vanilla JS (booking form)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/migrations/2026-05-30-home-service-jobs.sql` | **Create** | DB schema: new table + column additions + GRANTs |
| `server/moka/slotEngine.js` | **Modify** | Accept `type`; use 06:00–23:00 for home_service; filter `home_service_enabled` |
| `server/moka/routes.js` | **Modify** | Pass `type` to `getAvailableSlots`; add POST `/home-service/reschedule` route |
| `server/index.js` | **Modify** | Extract `type`/`address` from bookings payload; create `home_service_jobs` after `bridgeBookingToMoka` |
| `server/services/waNotification.js` | **Modify** | Add `notifyBarberNewHomeServiceJob()` |
| `server/whatsapp-ai/services/homeServiceHandler.js` | **Create** | Handle BERANGKAT / SELESAI / YA with phone-based job lookup |
| `server/whatsapp-ai/services/messageHandler.js` | **Modify** | Call homeServiceHandler before other intent checks |
| `server/home-service/reschedule.js` | **Create** | H-1 validation + cancel-old / insert-new schedule + Moka + WA notify |
| `api/cron/home-service-flag.js` | **Create** | 15-min cron: flag barber_no_show + customer_no_confirm, notify admin |
| `js/booking.js` | **Modify** | Pass `type=home_service` to availability API; add `type`+`address` to booking payload |
| `vercel.json` | **Modify** | Add cron entry + function config for home-service-flag |

---

## Task 1: Database Migration

**Files:**
- Create: `server/migrations/2026-05-30-home-service-jobs.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- server/migrations/2026-05-30-home-service-jobs.sql

-- 1. New table: home_service_jobs
CREATE TABLE IF NOT EXISTS home_service_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id           UUID REFERENCES schedules(id) ON DELETE CASCADE,
  status                TEXT DEFAULT 'confirmed',
  -- confirmed | on_the_way | done_barber | completed | flagged
  address               TEXT NOT NULL,
  reschedule_count      INT DEFAULT 0,
  barber_enroute_at     TIMESTAMPTZ,
  barber_done_at        TIMESTAMPTZ,
  customer_confirmed_at TIMESTAMPTZ,
  flagged_at            TIMESTAMPTZ,
  flag_reason           TEXT,
  -- 'barber_no_show' | 'customer_no_confirm'
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_home_service_jobs_schedule_id
  ON home_service_jobs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_home_service_jobs_status
  ON home_service_jobs(status);

-- Reuse existing updated_at trigger function
CREATE TRIGGER home_service_jobs_updated_at
  BEFORE UPDATE ON home_service_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Extend schedules table
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'outlet';
-- 'outlet' | 'home_service'

-- 3. Extend barbers table
ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS home_service_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS phone TEXT;
-- Barber's personal WhatsApp number for lifecycle notifications

-- 4. GRANTs (required by Supabase PostgREST — see project memory)
GRANT SELECT, INSERT, UPDATE ON home_service_jobs TO anon, authenticated;
```

- [ ] **Step 2: Run in Supabase SQL Editor**

Open Supabase → SQL Editor → paste the migration → Run.
Expected: no errors. If `update_updated_at` function does not exist, create it first:
```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 3: Verify in Supabase Table Editor**

Check that:
- Table `home_service_jobs` appears with all columns
- `schedules` has a `type` column (default `outlet`)
- `barbers` has `home_service_enabled` (default `false`) and `phone` columns

- [ ] **Step 4: Enable home_service for at least one barber (for testing)**

```sql
UPDATE barbers SET home_service_enabled = TRUE, phone = '628XXXXXXXXXX'
WHERE name = '[nama kapster test]';
```

- [ ] **Step 5: Commit**

```bash
git add server/migrations/2026-05-30-home-service-jobs.sql
git commit -m "feat: add home_service_jobs table and barber/schedules columns"
```

---

## Task 2: Slot Engine — Extended Hours + Barber Filter

**Files:**
- Modify: `server/moka/slotEngine.js:27-45` and `server/moka/slotEngine.js:119-121`

- [ ] **Step 1: Add `type` parameter to `getAvailableSlots` signature (line 27-33)**

Replace:
```javascript
async function getAvailableSlots(supabase, {
  outletId,
  date,
  durationMinutes,
  barberId = null,
  timezone = 'Asia/Jakarta',
}) {
```
With:
```javascript
async function getAvailableSlots(supabase, {
  outletId,
  date,
  durationMinutes,
  barberId = null,
  timezone = 'Asia/Jakarta',
  type = 'outlet',
}) {
```

- [ ] **Step 2: Add `home_service_enabled` filter to barbers query (lines 35-45)**

Replace:
```javascript
  const barbersQuery = supabase
    .from('barbers')
    .select('id, name, is_active')
    .eq('outlet_id', outletId)
    .eq('is_active', true);

  if (barberId) barbersQuery.eq('id', barberId);
```
With:
```javascript
  const barbersQuery = supabase
    .from('barbers')
    .select('id, name, is_active, home_service_enabled')
    .eq('outlet_id', outletId)
    .eq('is_active', true);

  if (barberId) barbersQuery.eq('id', barberId);
  if (type === 'home_service') barbersQuery.eq('home_service_enabled', true);
```

- [ ] **Step 3: Change working hours for home service (lines 119-121)**

Replace:
```javascript
    // Use working hours from DB, or fall back to outlet defaults (10:00–21:00)
    const openTime  = (wh && !wh.is_off) ? wh.open_time  : '10:00';
    const closeTime = (wh && !wh.is_off) ? wh.close_time : '21:00';
```
With:
```javascript
    // Home service: 06:00–23:00 WIB regardless of outlet hours
    // Outlet: use configured hours, fall back to 10:00–21:00
    const openTime  = type === 'home_service' ? '06:00'
      : ((wh && !wh.is_off) ? wh.open_time  : '10:00');
    const closeTime = type === 'home_service' ? '23:00'
      : ((wh && !wh.is_off) ? wh.close_time : '21:00');
```

> Note: The `if (wh?.is_off) continue;` check at line 124 remains unchanged — barbers explicitly marked off are still skipped even for home service.

- [ ] **Step 4: Extract `type` from query in GET /api/availability (routes.js lines 58, 80-85)**

In `server/moka/routes.js`, in the `router.get('/availability', ...)` handler:

Replace (line 58):
```javascript
      const { outletId: rawOutletId, date, serviceId, durationMinutes, barberId } = req.query;
```
With:
```javascript
      const { outletId: rawOutletId, date, serviceId, durationMinutes, barberId, type } = req.query;
```

Replace (lines 80-85):
```javascript
      const slots = await getAvailableSlots(supabase, {
        outletId,
        date,
        durationMinutes: duration,
        barberId:        barberId || null,
      });
```
With:
```javascript
      const slots = await getAvailableSlots(supabase, {
        outletId,
        date,
        durationMinutes: duration,
        barberId:        barberId || null,
        type:            type || 'outlet',
      });
```

- [ ] **Step 5: Test with curl**

```bash
# Should return slots from 06:00 WIB onwards (only if at least one barber has home_service_enabled=TRUE)
curl "https://your-api-url/api/availability?outletId=bypass&date=2026-06-02&durationMinutes=60&type=home_service"
# Expected: slots array with times starting as early as 06:00, only home_service_enabled barbers
```

- [ ] **Step 6: Commit**

```bash
git add server/moka/slotEngine.js server/moka/routes.js
git commit -m "feat: extend slot engine with home_service hours 06:00-23:00"
```

---

## Task 3: Booking API — Create home_service_jobs After Booking

**Files:**
- Modify: `server/index.js:887-1045`

- [ ] **Step 1: Extract `type` and `address` from POST /api/bookings body (line 888)**

Replace:
```javascript
  const { name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment, status } = req.body;
```
With:
```javascript
  const { name, wa, service_id, service, price, duration, barber_id, date, time, location, notes, payment, status, type, address } = req.body;
```

- [ ] **Step 2: After `bridgeBookingToMoka` succeeds, insert home_service_jobs**

Find this block (around line 963-966):
```javascript
      if (supabase && desiredStatus === 'confirmed') {
        try {
          const r = await require('./moka/sync').bridgeBookingToMoka(supabase, data);
          return res.status(201).json({ data, autoBooked: true, scheduleId: r.scheduleId, mokaSync: r.mokaSync });
```

Replace with:
```javascript
      if (supabase && desiredStatus === 'confirmed') {
        try {
          const r = await require('./moka/sync').bridgeBookingToMoka(supabase, data);

          // If home service: create lifecycle tracking row
          let homeServiceJobId = null;
          if (type === 'home_service' && r.scheduleId) {
            const jobAddress = address || (notes?.match(/\[HOME SERVICE\] Alamat:\s*(.+)/)?.[1]?.trim()) || '';
            if (jobAddress) {
              const { data: hsJob } = await supabase
                .from('home_service_jobs')
                .insert({ schedule_id: r.scheduleId, address: jobAddress, status: 'confirmed' })
                .select('id')
                .single();
              homeServiceJobId = hsJob?.id || null;

              // Notify barber via WhatsApp (fire-and-forget)
              if (homeServiceJobId) {
                _notifyBarberHomeService(supabase, r.scheduleId, jobAddress).catch(err =>
                  console.error('[HomeService] Barber notif failed:', err.message)
                );
              }
            }
          }

          return res.status(201).json({
            data, autoBooked: true, scheduleId: r.scheduleId, mokaSync: r.mokaSync,
            homeServiceJobId,
          });
```

- [ ] **Step 3: Add `_notifyBarberHomeService` helper in server/index.js (add before the POST /api/bookings route)**

Find a good location near the top of `server/index.js` (after existing requires) and add:
```javascript
async function _notifyBarberHomeService(supabase, scheduleId, address) {
  const { notifyBarberNewHomeServiceJob } = require('./services/waNotification');
  const { data: sch } = await supabase
    .from('schedules')
    .select('start_time, price, service_name, barber_id, customers(name)')
    .eq('id', scheduleId)
    .single();
  if (!sch) return;

  const { data: barber } = await supabase
    .from('barbers').select('name, phone').eq('id', sch.barber_id).single();
  if (!barber?.phone) return;

  const dtWIB = new Date(new Date(sch.start_time).getTime());
  const dateStr = dtWIB.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const timeStr = dtWIB.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });

  await notifyBarberNewHomeServiceJob({
    barberPhone:  barber.phone,
    barberName:   barber.name,
    customerName: sch.customers?.name || 'Pelanggan',
    dateStr,
    timeStr,
    address,
    serviceLabel: sch.service_name || 'Gentleman Grooming',
    price:        `Rp ${(sch.price || 0).toLocaleString('id-ID')}`,
  });
}
```

- [ ] **Step 4: Update schedules `type` column in bridgeBookingToMoka (server/moka/sync.js)**

Open `server/moka/sync.js` and find the `schedules.insert` call inside `bridgeBookingToMoka`. Add `type` field:

```javascript
// Find the insert into schedules inside bridgeBookingToMoka
// Add: type: booking.type === 'home_service' ? 'home_service' : 'outlet',
// alongside the other fields being inserted
```

To locate: search for `.from('schedules').insert(` in `sync.js`. Add `type: booking.type === 'home_service' ? 'home_service' : 'outlet',` to that insert object.

- [ ] **Step 5: Test end-to-end**

```bash
curl -X POST https://your-api-url/api/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "wa": "628123456789",
    "service": "Gentleman Grooming",
    "service_id": "your-service-id",
    "date": "2026-06-02",
    "time": "07:00",
    "location": "bypass",
    "barber_id": "your-barber-id",
    "type": "home_service",
    "address": "Jl. Test No. 1, Cirebon"
  }'
# Expected: 201 with homeServiceJobId populated
```

Verify in Supabase: check `home_service_jobs` table has a new row with `status=confirmed`.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/moka/sync.js
git commit -m "feat: create home_service_jobs row and notify barber on home service booking"
```

---

## Task 4: WA Notification — notifyBarberNewHomeServiceJob

**Files:**
- Modify: `server/services/waNotification.js`

- [ ] **Step 1: Add the function before `module.exports` in waNotification.js**

```javascript
async function notifyBarberNewHomeServiceJob({
  barberPhone, barberName, customerName, dateStr, timeStr, address, serviceLabel, price,
}) {
  const msg =
`🔔 *[HOME SERVICE] Booking Baru*

Pelanggan : ${customerName}
Tanggal   : ${dateStr} | ${timeStr} WIB
Alamat    : ${address}
Layanan   : ${serviceLabel}
Harga     : ${price}

Balas *BERANGKAT* saat berangkat ke lokasi.
Balas *SELESAI* setelah pekerjaan selesai.`;

  return sendWA(barberPhone, msg);
}
```

- [ ] **Step 2: Export the function**

Find `module.exports = {` at the bottom of the file and add `notifyBarberNewHomeServiceJob` to the exports:
```javascript
module.exports = {
  notifyCustomerBookingConfirmed,
  notifyCustomerReminderH1,
  notifyAdminNewBooking,
  notifyCustomerReviewRequest,
  notifyCustomerReviewPointsCredited,
  notifyBarberNewHomeServiceJob,   // ← add this line
};
```

- [ ] **Step 3: Commit**

```bash
git add server/services/waNotification.js
git commit -m "feat: add notifyBarberNewHomeServiceJob WA notification"
```

---

## Task 5: WhatsApp Lifecycle Handler (BERANGKAT / SELESAI / YA)

**Files:**
- Create: `server/whatsapp-ai/services/homeServiceHandler.js`
- Modify: `server/whatsapp-ai/services/messageHandler.js`

- [ ] **Step 1: Create homeServiceHandler.js**

```javascript
// server/whatsapp-ai/services/homeServiceHandler.js
'use strict';
const { createClient } = require('@supabase/supabase-js');
const { sendWA } = require('../../services/fonnte');

function _db() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Find the earliest job for a barber (looked up by phone) in a given status.
async function _jobByBarberPhone(supabase, phone, status) {
  const { data: barber } = await supabase
    .from('barbers').select('id, name, outlet_id').eq('phone', phone).maybeSingle();
  if (!barber) return null;

  // Get non-cancelled schedules for this barber, ordered by start_time
  const { data: schRows } = await supabase
    .from('schedules')
    .select('id, start_time, external_id, customer_id')
    .eq('barber_id', barber.id)
    .not('status', 'eq', 'cancelled')
    .order('start_time', { ascending: true });
  if (!schRows?.length) return null;

  // Find job with matching status
  const { data: job } = await supabase
    .from('home_service_jobs')
    .select('id, address, status, schedule_id')
    .in('schedule_id', schRows.map(s => s.id))
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!job) return null;

  const schedule = schRows.find(s => s.id === job.schedule_id);
  const { data: customer } = await supabase
    .from('customers').select('name, phone').eq('id', schedule.customer_id).maybeSingle();

  return { job, schedule, barber, customer };
}

// Find the earliest job for a customer (looked up by phone) in a given status.
async function _jobByCustomerPhone(supabase, phone, status) {
  const { data: customer } = await supabase
    .from('customers').select('id, name')
    .or(`phone.eq.${phone},phone_e164.eq.${phone},wa.eq.${phone}`)
    .maybeSingle();
  if (!customer) return null;

  const { data: schRows } = await supabase
    .from('schedules')
    .select('id, external_id, barber_id')
    .eq('customer_id', customer.id)
    .not('status', 'eq', 'cancelled')
    .order('start_time', { ascending: true });
  if (!schRows?.length) return null;

  const { data: job } = await supabase
    .from('home_service_jobs')
    .select('id, address, status, schedule_id')
    .in('schedule_id', schRows.map(s => s.id))
    .eq('status', status)
    .limit(1)
    .maybeSingle();
  if (!job) return null;

  const schedule = schRows.find(s => s.id === job.schedule_id);
  const { data: barber } = await supabase
    .from('barbers').select('name, phone').eq('id', schedule.barber_id).maybeSingle();

  return { job, schedule, customer, barber };
}

async function _handleBerangkat(from) {
  const supabase = _db();
  const result = await _jobByBarberPhone(supabase, from, 'confirmed');
  if (!result) {
    await sendWA(from, 'Tidak ada pekerjaan home service aktif yang ditemukan untuk nomor Anda.');
    return;
  }
  const { job, barber, customer } = result;

  await supabase
    .from('home_service_jobs')
    .update({ status: 'on_the_way', barber_enroute_at: new Date().toISOString() })
    .eq('id', job.id);

  await sendWA(from, '✅ Status diperbarui: *Dalam Perjalanan*. Hati-hati di jalan!');

  if (customer?.phone) {
    await sendWA(customer.phone,
      `🛵 Kapster *${barber.name}* sedang dalam perjalanan ke lokasi Anda.\n\nDitunggu ya! ✂️`
    );
  }
}

async function _handleSelesai(from) {
  const supabase = _db();
  const result = await _jobByBarberPhone(supabase, from, 'on_the_way');
  if (!result) {
    await sendWA(from, 'Tidak ada pekerjaan home service aktif yang ditemukan untuk nomor Anda.');
    return;
  }
  const { job, barber, customer } = result;

  await supabase
    .from('home_service_jobs')
    .update({ status: 'done_barber', barber_done_at: new Date().toISOString() })
    .eq('id', job.id);

  await sendWA(from, '✅ Pekerjaan dilaporkan selesai. Menunggu konfirmasi pelanggan.');

  if (customer?.phone) {
    await sendWA(customer.phone,
      `✅ Kapster *${barber.name}* melaporkan pekerjaan selesai.\n\nSudah menerima layanan? Balas *YA* untuk konfirmasi.`
    );
  }
}

// Returns true if a matching job was found and handled.
// Returns false if no job found (allows messageHandler to continue its normal flow).
async function _handleYa(from) {
  const supabase = _db();
  const result = await _jobByCustomerPhone(supabase, from, 'done_barber');
  if (!result) return false; // 'ya' is common Indonesian — don't spam error reply

  const { job, customer, barber } = result;

  await supabase
    .from('home_service_jobs')
    .update({ status: 'completed', customer_confirmed_at: new Date().toISOString() })
    .eq('id', job.id);

  await sendWA(from, '🎉 Terima kasih sudah mengkonfirmasi! Senang bisa melayani kamu ✂️');

  if (barber?.phone) {
    await sendWA(barber.phone,
      '✅ Pekerjaan Anda telah dikonfirmasi selesai oleh pelanggan. Terima kasih! 🎉'
    );
  }
  return true;
}

// Main entry: returns true if the message was handled as a home service command.
const handle = async (from, lowerText) => {
  if (lowerText === 'berangkat') { await _handleBerangkat(from); return true; }
  if (lowerText === 'selesai')   { await _handleSelesai(from);   return true; }
  if (lowerText === 'ya')        { return await _handleYa(from); }
  return false;
};

module.exports = { handle };
```

- [ ] **Step 2: Wire into messageHandler.js — add early check before intent logic**

In `server/whatsapp-ai/services/messageHandler.js`, add the require at the top (after existing requires):
```javascript
const homeServiceHandler = require('./homeServiceHandler');
```

Then in the `handle` function, add this block right after the `0c` stale session check (around line 126, before the `console.log` intent logging):
```javascript
    // 0d. Home service lifecycle commands (kapster/pelanggan)
    const hsHandled = await homeServiceHandler.handle(from, lower);
    if (hsHandled) return;
```

The full surrounding context should look like:
```javascript
    // 0c. If booking flow active, clear it...
    if (bookingService.isActive(from)) { ... return; }

    // 0d. Home service lifecycle commands (kapster/pelanggan)
    const hsHandled = await homeServiceHandler.handle(from, lower);
    if (hsHandled) return;

    // Log intent for monitoring dashboard
    console.log(`[Intent] ${from} (${name}) → ${intent}: "${text.substring(0, 80)}"`);
```

- [ ] **Step 3: Manually test BERANGKAT flow**

1. In Supabase: confirm a `home_service_jobs` row exists with `status=confirmed` and a schedule linked to a barber whose `phone` matches your test number.
2. Send WhatsApp `BERANGKAT` from that test number.
3. Check Supabase: `status` should be `on_the_way`, `barber_enroute_at` should be set.
4. Check customer's WhatsApp: should receive "Kapster sedang dalam perjalanan" message.

- [ ] **Step 4: Commit**

```bash
git add server/whatsapp-ai/services/homeServiceHandler.js server/whatsapp-ai/services/messageHandler.js
git commit -m "feat: add WhatsApp lifecycle handler for home service (BERANGKAT/SELESAI/YA)"
```

---

## Task 6: Auto-flag Cron

**Files:**
- Create: `api/cron/home-service-flag.js`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron handler**

```javascript
// api/cron/home-service-flag.js
'use strict';
const { createClient } = require('@supabase/supabase-js');
const { sendWA } = require('../../server/services/fonnte');

const ADMIN_PHONE = process.env.WA_ADMIN_NUMBER;

function _db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function _shortId(uuid) {
  return uuid.slice(0, 8).toUpperCase();
}

function _fmtTime(isoStr) {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta',
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function _sendAdminAlert(job, barberName, reason) {
  if (!ADMIN_PHONE) return;
  const label = reason === 'barber_no_show' ? 'Kapster tidak berangkat' : 'Pelanggan tidak konfirmasi';
  await sendWA(ADMIN_PHONE,
`⚠️ *FLAG HOME SERVICE*

Job    : HS-${_shortId(job.id)}
Kapster: ${barberName}
Alasan : ${label}
Waktu  : ${job._startTime}
Alamat : ${job.address}`
  ).catch(() => {});
}

// Flag jobs where kapster didn't reply BERANGKAT within 30 min of booking time
async function flagNoShows(supabase) {
  const { data: jobs } = await supabase
    .from('home_service_jobs')
    .select('id, address, schedule_id')
    .eq('status', 'confirmed')
    .is('barber_enroute_at', null);

  for (const job of jobs || []) {
    const { data: sch } = await supabase
      .from('schedules')
      .select('start_time, barbers(name)')
      .eq('id', job.schedule_id)
      .single();
    if (!sch) continue;

    const deadline = new Date(sch.start_time).getTime() + 30 * 60 * 1000;
    if (Date.now() < deadline) continue; // not late enough yet

    await supabase.from('home_service_jobs').update({
      status: 'flagged', flag_reason: 'barber_no_show', flagged_at: new Date().toISOString(),
    }).eq('id', job.id);

    await _sendAdminAlert(
      { ...job, _startTime: _fmtTime(sch.start_time) },
      sch.barbers?.name || 'Unknown',
      'barber_no_show'
    );
  }
}

// Flag jobs where customer didn't reply YA within 45 min after kapster said SELESAI
async function flagCustomerNoConfirm(supabase) {
  const cutoff = new Date(Date.now() - 45 * 60 * 1000).toISOString();

  const { data: jobs } = await supabase
    .from('home_service_jobs')
    .select('id, address, schedule_id, barber_done_at')
    .eq('status', 'done_barber')
    .is('customer_confirmed_at', null)
    .lt('barber_done_at', cutoff);

  for (const job of jobs || []) {
    await supabase.from('home_service_jobs').update({
      status: 'flagged', flag_reason: 'customer_no_confirm', flagged_at: new Date().toISOString(),
    }).eq('id', job.id);

    const { data: sch } = await supabase
      .from('schedules')
      .select('start_time, barbers(name)')
      .eq('id', job.schedule_id)
      .single();

    await _sendAdminAlert(
      { ...job, _startTime: _fmtTime(sch?.start_time) },
      sch?.barbers?.name || 'Unknown',
      'customer_no_confirm'
    );
  }
}

module.exports = async (req, res) => {
  const auth = req.headers.authorization || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = _db();
    await flagNoShows(supabase);
    await flagCustomerNoConfirm(supabase);
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    console.error('[Cron/HomeServiceFlag]', err.message);
    res.status(500).json({ error: err.message });
  }
};
```

- [ ] **Step 2: Add to vercel.json — function config + cron entry**

In `vercel.json`, add to `"functions"` object:
```json
"api/cron/home-service-flag.js": {
  "maxDuration": 60,
  "includeFiles": "server/**"
},
```

Add to `"crons"` array:
```json
{ "path": "/api/cron/home-service-flag", "schedule": "*/15 * * * *" }
```

Add to `"rewrites"` array:
```json
{ "source": "/api/cron/home-service-flag", "destination": "/api/cron/home-service-flag.js" },
```

- [ ] **Step 3: Test cron manually**

```bash
curl -X GET https://your-api-url/api/cron/home-service-flag \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
# Expected: { "ok": true, "ts": "..." }
```

Check Supabase: any jobs that are past their start_time + 30 min with no BERANGKAT should be `status=flagged`.

- [ ] **Step 4: Commit**

```bash
git add api/cron/home-service-flag.js vercel.json
git commit -m "feat: add home service auto-flag cron (barber_no_show + customer_no_confirm)"
```

---

## Task 7: Reschedule Endpoint

**Files:**
- Create: `server/home-service/reschedule.js`
- Modify: `server/moka/routes.js`

- [ ] **Step 1: Create the reschedule logic module**

```javascript
// server/home-service/reschedule.js
'use strict';
const { isSlotAvailable } = require('../moka/slotEngine');
const { pushScheduleToMoka } = require('../moka/sync');
const { sendWA } = require('../services/fonnte');

async function reschedule(supabase, { jobId, newStartTime }) {
  // 1. Load job
  const { data: job, error: jobErr } = await supabase
    .from('home_service_jobs')
    .select('id, status, address, reschedule_count, schedule_id')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) {
    throw Object.assign(new Error('Job tidak ditemukan'), { statusCode: 404 });
  }
  if (job.status !== 'confirmed') {
    throw Object.assign(new Error('Reschedule hanya bisa dilakukan sebelum kapster berangkat'), { statusCode: 400 });
  }

  // 2. Load old schedule
  const { data: old } = await supabase
    .from('schedules')
    .select('id, start_time, end_time, outlet_id, barber_id, customer_id, service_id, service_name, price, notes')
    .eq('id', job.schedule_id)
    .single();

  // 3. H-1 check (must be > 24 hours from now)
  const hoursUntil = (new Date(old.start_time).getTime() - Date.now()) / 3_600_000;
  if (hoursUntil < 24) {
    throw Object.assign(
      new Error('Reschedule tidak dapat dilakukan kurang dari 24 jam sebelum jadwal.'),
      { statusCode: 400 }
    );
  }

  // 4. Check new slot availability
  const durationMs  = new Date(old.end_time) - new Date(old.start_time);
  const newEndTime  = new Date(new Date(newStartTime).getTime() + durationMs).toISOString();
  const slotFree    = await isSlotAvailable(supabase, {
    barberId: old.barber_id, startTime: newStartTime, endTime: newEndTime,
  });
  if (!slotFree) {
    throw Object.assign(new Error('Slot baru tidak tersedia. Pilih waktu lain.'), { statusCode: 409 });
  }

  // 5. Cancel old schedule
  await supabase.from('schedules').update({ status: 'cancelled' }).eq('id', old.id);

  // 6. Insert new schedule
  const { data: newSch } = await supabase
    .from('schedules')
    .insert({
      outlet_id:    old.outlet_id,
      barber_id:    old.barber_id,
      customer_id:  old.customer_id,
      service_id:   old.service_id,
      service_name: old.service_name,
      price:        old.price,
      start_time:   newStartTime,
      end_time:     newEndTime,
      status:       'confirmed',
      source:       'web',
      notes:        old.notes,
      type:         'home_service',
    })
    .select()
    .single();

  // 7. Update home_service_jobs to point to new schedule
  await supabase.from('home_service_jobs')
    .update({ schedule_id: newSch.id, reschedule_count: (job.reschedule_count || 0) + 1 })
    .eq('id', jobId);

  // 8. Push to Moka (non-blocking)
  pushScheduleToMoka(supabase, newSch.id).catch(err =>
    console.error('[Reschedule] Moka push failed:', err.message)
  );

  // 9. Notify barber & customer (non-blocking)
  const [barberRes, customerRes] = await Promise.all([
    supabase.from('barbers').select('name, phone').eq('id', old.barber_id).single(),
    supabase.from('customers').select('name, phone').eq('id', old.customer_id).single(),
  ]);

  const dtStr = new Date(newStartTime).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  if (barberRes.data?.phone) {
    sendWA(barberRes.data.phone,
      `📅 *Reschedule Home Service*\n\nJadwal kamu telah diubah:\n${dtStr} WIB\nAlamat: ${job.address}`
    ).catch(() => {});
  }
  if (customerRes.data?.phone) {
    sendWA(customerRes.data.phone,
      `📅 *Reschedule Berhasil*\n\nJadwal baru kamu:\n${dtStr} WIB\n\nKapster akan hadir sesuai jadwal baru. ✂️`
    ).catch(() => {});
  }

  return { jobId, newScheduleId: newSch.id, rescheduleCount: (job.reschedule_count || 0) + 1 };
}

module.exports = { reschedule };
```

- [ ] **Step 2: Register route in server/moka/routes.js**

At the top of `server/moka/routes.js` (with other requires), add:
```javascript
const { reschedule } = require('../home-service/reschedule');
```

After the existing `router.post('/reservations', ...)` handler (after line 443), add:
```javascript
  // ── POST /api/home-service/reschedule ─────────────────────
  router.post('/home-service/reschedule', async (req, res) => {
    try {
      const { jobId, newStartTime } = req.body;
      if (!jobId || !newStartTime) {
        return res.status(400).json({ error: 'jobId and newStartTime are required' });
      }
      const result = await reschedule(supabase, { jobId, newStartTime });
      res.json({ ok: true, ...result });
    } catch (err) {
      const status = err.statusCode || 500;
      res.status(status).json({ error: err.message });
    }
  });
```

- [ ] **Step 3: Test reschedule endpoint**

First create a test job (via Task 3 test). Then:
```bash
curl -X POST https://your-api-url/api/home-service/reschedule \
  -H "Content-Type: application/json" \
  -d '{ "jobId": "YOUR-JOB-UUID", "newStartTime": "2026-06-05T01:00:00.000Z" }'
# Expected: { "ok": true, "jobId": "...", "newScheduleId": "...", "rescheduleCount": 1 }
```

Test H-0 rejection:
```bash
# Set up a job with start_time < 24 hours from now, then:
curl -X POST https://your-api-url/api/home-service/reschedule \
  -H "Content-Type: application/json" \
  -d '{ "jobId": "YOUR-RECENT-JOB-UUID", "newStartTime": "2026-06-03T08:00:00.000Z" }'
# Expected: 400 "Reschedule tidak dapat dilakukan kurang dari 24 jam sebelum jadwal."
```

- [ ] **Step 4: Commit**

```bash
git add server/home-service/reschedule.js server/moka/routes.js
git commit -m "feat: add home service reschedule endpoint with H-1 validation"
```

---

## Task 8: Frontend — Pass type=home_service to Availability API + Booking Payload

**Files:**
- Modify: `js/booking.js:767-772` and `js/booking.js:1692-1706`

- [ ] **Step 1: Add `type=home_service` to availability API call (line 772)**

Find this block (lines 767-772):
```javascript
          const params = new URLSearchParams({
            outletId: outletIdFixed,
            date: dateStr,
            durationMinutes: durMins,
          });
          if (barberIdFixed) params.set('barberId', barberIdFixed);
```

Add one line after the `barberId` line:
```javascript
          if (barberIdFixed) params.set('barberId', barberIdFixed);
          if (isHomeService) params.set('type', 'home_service');
```

- [ ] **Step 2: Add `type` and `address` to booking payload (lines 1692-1706)**

Find the `return {` block in `_buildPayloadFor` (around line 1692):
```javascript
      return {
        name: name || state.name,
        wa: state.wa,
        service_id: svc?.id || '',
        service: serviceFull,
        price: svc?.price || 0,
        duration: svc?.duration || '',
        barber_id: barber?.id || 'any',
        date: state.date,
        time: state.time,
        location: state.location,
        notes: noteParts.join('\n'),
        payment: state.payment?.name || '',
        status: 'pending'
      };
```

Replace with:
```javascript
      return {
        name: name || state.name,
        wa: state.wa,
        service_id: svc?.id || '',
        service: serviceFull,
        price: svc?.price || 0,
        duration: svc?.duration || '',
        barber_id: barber?.id || 'any',
        date: state.date,
        time: state.time,
        location: state.location,
        notes: noteParts.join('\n'),
        payment: state.payment?.name || '',
        status: 'pending',
        type: isHomeService ? 'home_service' : 'outlet',
        address: isHomeService ? (state.address || '') : undefined,
      };
```

- [ ] **Step 3: Test in browser**

1. Open `booking.html?type=homeservice&pkg=single` in a browser.
2. Open DevTools Network tab.
3. Navigate to the date/time step and observe the `/api/availability` call.
4. Verify the URL includes `type=home_service`.
5. Verify that time slots appear from 06:00 WIB onwards (not just 10:00).

- [ ] **Step 4: Commit**

```bash
git add js/booking.js
git commit -m "feat: pass type=home_service to availability API and booking payload"
```

---

## Self-Review: Spec Coverage Check

| Spec Section | Task |
|---|---|
| Jam 06:00–23:00 WIB | Task 2 (slotEngine hours) |
| Filter `home_service_enabled` barbers | Task 2 (barbers query) |
| Pembayaran di muka | Not in scope — existing payment flow |
| Double verification kapster + pelanggan | Task 5 (BERANGKAT/SELESAI/YA) |
| Notif kapster saat booking baru | Tasks 3+4 (notifyBarberNewHomeServiceJob) |
| Auto-flag barber_no_show | Task 6 (flagNoShows) |
| Auto-flag customer_no_confirm | Task 6 (flagCustomerNoConfirm) |
| Push ke Moka sebagai online order | Task 3 (bridgeBookingToMoka already does this) |
| Reschedule H-1 only | Task 7 |
| DB: home_service_jobs table | Task 1 |
| DB: schedules.type column | Task 1 |
| DB: barbers.home_service_enabled + phone | Task 1 |
| GRANTs Supabase | Task 1 |
| Frontend type=home_service param | Task 8 |

All spec requirements covered. ✅

---

> **Plan complete and saved to `docs/superpowers/plans/2026-05-30-home-service-extended-hours.md`. Two execution options:**
>
> **1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration
>
> **2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints
>
> **Which approach?**
