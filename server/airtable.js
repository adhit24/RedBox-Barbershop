const Airtable = require('airtable');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

function isConfigured() {
  return Boolean(
    process.env.AIRTABLE_API_KEY &&
    process.env.AIRTABLE_API_KEY !== 'your_airtable_api_key' &&
    process.env.AIRTABLE_BASE_ID &&
    process.env.AIRTABLE_TABLE_NAME
  );
}

function getBase() {
  if (!isConfigured()) return null;
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
}

function isBarbersConfigured() {
  return Boolean(
    process.env.AIRTABLE_API_KEY &&
    process.env.AIRTABLE_API_KEY !== 'your_airtable_api_key' &&
    process.env.AIRTABLE_BASE_ID &&
    (process.env.AIRTABLE_BARBERS_TABLE_NAME || process.env.AIRTABLE_BARBERS_TABLE)
  );
}

function getBarbersBase() {
  if (!isBarbersConfigured()) return null;
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
}

function getBarbersTableName() {
  return process.env.AIRTABLE_BARBERS_TABLE_NAME || process.env.AIRTABLE_BARBERS_TABLE;
}

function escapeAirtableValue(val) {
  // Escape single quotes untuk mencegah formula injection
  return String(val || '').replace(/'/g, "\\'");
}

function convertGDriveUrl(url) {
  if (!url) return '';
  if (url.includes('lh3.googleusercontent.com')) return url;
  const match = url.match(/(?:\/d\/|open\?id=|[?&]id=)([A-Za-z0-9_-]{10,})/);
  if (match) return `https://lh3.googleusercontent.com/d/${match[1]}=w800`;
  return url;
}

function normalizeAttachmentUrl(val) {
  if (!val) return '';
  let url = '';
  if (Array.isArray(val)) {
    const first = val.find(x => x && typeof x === 'object' && x.url) || val[0];
    url = first?.url ? String(first.url) : '';
  } else if (typeof val === 'object') {
    url = val.url ? String(val.url) : '';
  } else {
    url = String(val);
  }
  return convertGDriveUrl(url);
}

function parseAirtableWorkDays(val) {
  if (Array.isArray(val)) {
    return val.map(x => String(x || '').trim()).filter(Boolean);
  }
  const raw = String(val || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(x => String(x || '').trim()).filter(Boolean);
  } catch {}
  return raw.split(/[,;/|]+/).map(x => String(x || '').trim()).filter(Boolean);
}

function branchSlug(input) {
  const v = String(input || '').trim().toLowerCase();
  if (v.includes('bypass')) return 'bypass';
  if (v.includes('samad')) return 'samadikun';
  if (v.includes('csb')) return 'csb';
  if (v.includes('sumber')) return 'sumber';
  if (v.includes('tegal')) return 'tegal';
  return 'bypass';
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 45);
}

function isActiveFromStatus(input) {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return true;
  if (v.includes('tidak') || v.includes('non') || v.includes('resign') || v.includes('off')) return false;
  return true;
}

function buildFields(booking) {
  return {
    'Booking ID':  String(booking.id || ''),
    'Name':        String(booking.name || ''),
    'WhatsApp':    String(booking.wa || ''),
    'Service':     String(booking.service || ''),
    'Price':       Number(booking.price) || 0,
    'Barber':      String(booking.barber_name || booking.barber_id || ''),
    'Location':    String(booking.location || ''),
    'Date':        String(booking.date || ''),
    'Time':        String(booking.time || '').slice(0, 5),
    'Duration':    String(booking.duration || ''),
    'Status':      String(booking.status || 'pending'),
    'Notes':       String(booking.notes || ''),
    'Payment':     String(booking.payment || ''),
  };
}

async function syncBookingToAirtable(booking) {
  if (!isConfigured()) { console.log('Airtable sync skipped: API Key not configured.'); return; }
  try {
    const base = getBase();
    await base(process.env.AIRTABLE_TABLE_NAME).create([{ fields: buildFields(booking) }]);
    console.log(`Synced booking ${booking.id} to Airtable`);
  } catch (error) {
    console.error('Airtable Sync Error:', error.message);
  }
}

async function updateBookingInAirtable(booking) {
  if (!isConfigured()) return;
  try {
    const base = getBase();
    // Gunakan ID yang di-escape untuk mencegah formula injection
    const safeId = escapeAirtableValue(booking.id);
    const records = await base(process.env.AIRTABLE_TABLE_NAME).select({
      filterByFormula: `{Booking ID} = '${safeId}'`,
      maxRecords: 1,
    }).firstPage();

    if (records.length > 0) {
      await base(process.env.AIRTABLE_TABLE_NAME).update(records[0].id, buildFields(booking));
      console.log(`Updated booking ${booking.id} in Airtable`);
    } else {
      // Record tidak ditemukan → buat baru
      await syncBookingToAirtable(booking);
    }
  } catch (error) {
    console.error('Airtable Update Error:', error.message);
  }
}

async function fetchBarbersFromAirtable() {
  if (!isBarbersConfigured()) return { ok: false, data: [] };
  const base = getBarbersBase();
  const tableName = getBarbersTableName();
  const records = await base(tableName).select({ pageSize: 100 }).all();
  const data = (records || []).map(r => {
    const f = r.fields || {};
    const name = String(
      f['name']
      || f['Name']
      || f['Nama']
      || f['Nama Kapster']
      || f['Nama Panggilan']
      || f['Nama Lengkap']
      || ''
    ).trim();
    const branchRaw = String(
      f['branch']
      || f['Branch']
      || f['Cabang']
      || f['Cabang Tempat Bekerja']
      || ''
    ).trim();
    const role = String(
      f['role']
      || f['Role']
      || f['Keahlian']
      || f['Keahlian Utama']
      || ''
    ).trim();
    const id = String(f['id'] || f['ID'] || f['Barber ID'] || '').trim() || `${branchSlug(branchRaw)}-${slugify(name)}`;
    const is_active_raw = f['is_active'] ?? f['Active'] ?? f['Is Active'] ?? f['Status'] ?? f['Status Kerja'] ?? true;
    const is_active = typeof is_active_raw === 'boolean' ? is_active_raw : isActiveFromStatus(is_active_raw);
    const work_days = parseAirtableWorkDays(
      f['work_days']
      ?? f['Work Days']
      ?? f['Hari Kerja']
      ?? f['Hari Kerja (Yg Pilih Part Time,Abaikan)']
      ?? ''
    );
    const imgRaw = normalizeAttachmentUrl(
      f['img']
      ?? f['Image']
      ?? f['Foto']
      ?? f['Photo']
      ?? f['Upload Foto']
      ?? f['Upload Foto Diri (Opsional, klo ada yg terbaik ya :) )']
      ?? ''
    );
    const branch = branchSlug(branchRaw);
    return { id, name, role, img: imgRaw, work_days, branch, is_active };
  }).filter(b => b.id && b.name);
  return { ok: true, data };
}

module.exports = { syncBookingToAirtable, updateBookingInAirtable, fetchBarbersFromAirtable, isBarbersConfigured, getBarbersTableName };
