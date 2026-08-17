# Security Hardening — Design

## Context

RedBox website terdiri dari 3 permukaan:

1. **Next.js frontend + API routes** (`frontend/src/app/api/**`) — di-deploy ke Vercel, memakai Supabase Auth (cookie session) untuk admin/owner/barber/stockist, lalu memproxy sebagian request ke backend Express lewat header `x-admin-token` + assertion HMAC (`x-redbox-admin-session`).
2. **Express + MySQL backend** (`server/index.js`) — legacy CRM server, menyimpan `bookings`, `barbers`, dll di MySQL, diakses lewat `adminAuth` middleware (shared-secret token) dan endpoint publik (booking, OTP).
3. **Supabase Postgres** — sumber data utama untuk membership, stockist, dsb, sudah punya sebagian RLS policy (lihat `server/migrations/2026-08-09-fix-*-rls.sql`).

Audit awal menemukan:
- Query MySQL yang sudah ada konsisten pakai parameterized query (`?` placeholder) dan whitelist kolom (`allowed = [...]` sebelum membangun `SET` clause) — pola ini sudah benar, harus dipertahankan sebagai standar untuk audit dan kode baru.
- **Tidak ada rate limiting** di Express maupun di Next.js API routes — endpoint publik (booking, OTP kapster) dan endpoint admin (`adminAuth`, Supabase login) rawan brute-force/spam.
- **Tidak ada security header** — Express tidak pakai `helmet`; `next.config.ts` hanya set header untuk `/sw.js`, tidak ada CSP/HSTS/X-Frame-Options/X-Content-Type-Options.
- **Tidak ada bot protection** di form publik (booking, OTP request).
- `cors()` di Express dipakai tanpa allowlist origin yang eksplisit (perlu verifikasi & pengetatan).
- CSRF belum diverifikasi eksplisit untuk route Next.js yang state-changing dan bergantung pada cookie session Supabase.

## Goals

- Menutup permukaan serangan paling umum: brute-force, spam/bot, SQL injection, XSS, CSRF, tanpa mengganggu UX booking pelanggan atau alur kerja admin/kapster.
- Menjadikan proteksi ini *default* di semua endpoint baru ke depannya (lewat shared middleware/util), bukan tempelan per-route.

## Non-goals

- Tidak mengganti arsitektur auth yang sudah ada (Supabase Auth + HMAC session assertion ke Express) — desain itu sudah solid, kita hanya menambah lapisan proteksi di sekitarnya.
- Tidak migrasi `server/index.js` (Express/MySQL) ke Next.js API routes — di luar scope ini.
- Tidak menerapkan WAF/CDN-level protection (Cloudflare proxy in front of Vercel) — bisa jadi proyek terpisah kalau dibutuhkan nanti.

## Phased approach

Empat fase independen, urut berdasarkan dependency (fase belakangan memanfaatkan util yang dibangun di fase 1):

### Phase 1 — Backend hardening

- **Security headers**: pasang `helmet` di `server/index.js`. Di Next.js, lengkapi `headers()` di `next.config.ts` dengan CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`.
- **Rate limiting**:
  - Express: `express-rate-limit` dengan store in-memory (cukup untuk single-instance; kalau nanti multi-instance, upgrade ke Redis store) — limit ketat untuk endpoint publik (booking create, OTP) dan endpoint `adminAuth` (login-like), limit lebih longgar untuk endpoint read-only admin.
  - Next.js API routes: middleware ringan berbasis IP + route key (in-memory Map dengan TTL, cukup untuk single Vercel region; dicatat sebagai limitasi known-tradeoff untuk fase ini — bukan blocker).
- **CORS allowlist**: ganti `cors()` polos dengan daftar origin eksplisit (domain produksi RedBox + localhost dev).
- **SQL injection audit**: grep menyeluruh semua `mysqlPool.execute`/`.query` call di `server/*.js` untuk pastikan tidak ada string interpolation dari input user yang tidak lewat whitelist/parameterization. Perbaiki temuan.
- **Input validation**: tambahkan `zod` sebagai standar validasi body/query di Next.js API routes yang menerima input publik (booking, OTP) — Express side tetap pakai validasi manual/whitelist yang sudah ada, diperkuat kalau ada celah dari hasil audit.

### Phase 2 — Bot protection (Cloudflare Turnstile)

- Pasang widget Turnstile (invisible/managed mode) di form booking publik dan form request-OTP kapster.
- Verifikasi token Turnstile di server side (Next.js API route booking, OTP send) sebelum memproses — reject kalau verifikasi gagal.
- Terapkan sebagai util bersama (`verifyTurnstile(token)`) supaya endpoint publik baru ke depan tinggal panggil.

### Phase 3 — Auth & session hardening

- Brute-force protection tambahan di atas rate limit umum: lockout/backoff progresif untuk percobaan gagal `ADMIN_PASSWORD` dan OTP verify (per-IP dan/atau per-akun).
- Audit log untuk aksi admin sensitif (siapa, kapan, aksi apa) — minimal di endpoint yang mengubah data booking/membership/inventory lewat `adminAuth`.
- Review masa berlaku session Supabase Auth (cookie) dan HMAC assertion (`ADMIN_SESSION_PROXY_SECRET`) — pastikan ada expiry yang wajar dan tidak infinite.

### Phase 4 — Frontend hardening

- CSP + header lain dari Phase 1 sudah menutupi sebagian besar; fase ini fokus ke:
  - CSRF: validasi `Origin`/`Referer` untuk request state-changing (POST/PATCH/DELETE) di Next.js API routes yang mengandalkan cookie session, sebagai defense-in-depth di luar SameSite cookie.
  - Audit pemakaian `dangerouslySetInnerHTML` dan sumber data yang di-render langsung dari input user (XSS sink) di seluruh `frontend/src`.

## Testing approach

- Rate limit & header changes: automated smoke test (curl/fetch berulang melewati limit → expect 429; cek header keamanan muncul di response).
- SQL injection audit: tidak ada test otomatis baru — hasil audit didokumentasikan sebagai temuan + fix per file.
- Turnstile: manual test end-to-end (submit booking dengan token valid vs invalid/absent).
- Auth hardening: test lockout trigger setelah N percobaan gagal, reset setelah window habis.
- CSRF: test request dengan `Origin` asing ditolak, request dari origin sah diterima.

## Error handling / fail-safe defaults

- Rate limiter/Turnstile verification failure karena masalah infra (mis. Turnstile API down) → **fail closed** untuk endpoint yang mengubah data (reject), tapi log jelas supaya gampang didiagnosis — jangan sampai orang jadi tidak bisa booking tanpa ada yang tahu kenapa. Beri pesan error yang jelas ke user.
- Security header tambahan tidak boleh mematahkan fitur existing (mis. CSP terlalu ketat memblokir script/style yang dipakai) — rollout CSP dengan `Content-Security-Policy-Report-Only` dulu sebelum enforce, kalau ada risiko breaking.
