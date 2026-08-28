'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const webhookPath = path.resolve(__dirname, '../../api/wa/webhook.js');
const webhookSource = fs.readFileSync(webhookPath, 'utf8');

// ── 1. Generic Loop Ending Prohibition ─────────────────────────────────────────
test('1. System prompt strictly prohibits repeated generic endings ("Ada yang ingin ditanyakan lagi?")', () => {
  assert.match(webhookSource, /CONVERSATION EFFICIENCY & BOOKING CONVERSION POLICY/);
  assert.match(webhookSource, /DILARANG mengakhiri pesan dengan pertanyaan generik berulang/);
  assert.match(webhookSource, /Ada yang ingin ditanyakan lagi?/);
  assert.match(webhookSource, /Ada yang bisa saya bantu lagi?/);
});

// ── 2. Service Inquiry Guidance (Task 14.1 correction: answer then STOP —────
//      conversion must never be automatic, only when the same turn also
//      expresses actual visit/booking intent) ────────────────────────────────
test('2. Service inquiry answers fully then stops; booking is not manufactured from the topic alone', () => {
  assert.match(webhookSource, /Tanya layanan/);
  assert.match(webhookSource, /jawab lengkap dari fakta, lalu BERHENTI/);
  assert.match(webhookSource, /JANGAN otomatis menawarkan pilih cabang\/jadwal hanya karena layanan disebut/);
});

// ── 3. Barber Inquiry Guidance ────────────────────────────────────────────────
test('3. Barber inquiry answers the fact then stops; no automatic booking redirect', () => {
  assert.match(webhookSource, /Tanya kapster/);
  assert.match(webhookSource, /jawab faktanya, lalu BERHENTI/);
});

// ── 4. Branch/hours Inquiry Guidance ──────────────────────────────────────────
test('4. Branch/hours inquiry answers the fact then stops; no automatic booking redirect', () => {
  assert.match(webhookSource, /Tanya cabang\/jam/);
  assert.match(webhookSource, /jawab jamnya, lalu BERHENTI/);
});

test('2b. Conversion guidance is explicitly conditional on the SAME turn expressing booking intent, not the topic alone', () => {
  assert.match(webhookSource, /Tawarkan langkah lanjutan booking HANYA jika pesan pelanggan JUGA secara eksplisit menunjukkan niat kunjungan\/booking/);
});

// ── 5. Complaint Protection (No Overselling) ──────────────────────────────────
test('5. Complaint does NOT immediately push booking', () => {
  assert.match(webhookSource, /DILARANG OVERSELL/);
  assert.match(webhookSource, /Komplain/);
  assert.match(webhookSource, /Selesaikan masalah dan bangun rasa percaya terlebih dahulu/);
});

// ── 6. Customer Correction / Discrepancy Protection ──────────────────────────
test('6. Customer correction / CRM conflict does NOT push booking before resolving discrepancy', () => {
  assert.match(webhookSource, /Koreksi data pelanggan/);
  assert.match(webhookSource, /konflik CRM/);
  assert.match(webhookSource, /Isu privasi/);
});

// ── 7. Off-Topic Relevance Boundary Redirect ──────────────────────────────────
test('7. Unrelated casual topic gets a brief response + Redbox redirect', () => {
  assert.match(webhookSource, /BATAS RELEVANSI/);
  assert.match(webhookSource, /OFF-TOPIC REDIRECT/);
  assert.match(webhookSource, /sepak bola, politik, cuaca/);
  assert.match(webhookSource, /secara halus belokkan kembali ke Redbox/);
});

// ── 8. Context Memory Continuity ──────────────────────────────────────────────
test('8. Existing booking context is remembered (do not ask branch/barber again)', () => {
  assert.match(webhookSource, /MEMORI PERCAKAPAN & PROGRESIF BOOKING/);
  assert.match(webhookSource, /JANGAN pernah menanyakan kembali informasi yang sudah dipilih/);
});

// ── 9. Single CTA Requirement ────────────────────────────────────────────────
test('9. Exactly ONE clear CTA per response (no multiple-choice menu lists)', () => {
  assert.match(webhookSource, /Tepat 1 opsi CTA per balasan/);
  assert.match(webhookSource, /JANGAN beri daftar menu pilihan/);
});

// ── 10. No Live Availability Fabrication ──────────────────────────────────────
test('10. No fabricated live availability before Task 14 integration', () => {
  assert.match(webhookSource, /SEBELUM TASK 14 INTEGRASI LIVE/);
  assert.match(webhookSource, /tanpa mengarang slot ketersediaan live/);
});
