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

// ── 2. Service Inquiry Guidance ───────────────────────────────────────────────
test('2. Service inquiry naturally leads toward booking next step', () => {
  assert.match(webhookSource, /Tanya layanan/);
  assert.match(webhookSource, /aku bisa bantu pilih cabang dan jadwal/);
});

// ── 3. Barber Inquiry Guidance ────────────────────────────────────────────────
test('3. Barber inquiry naturally leads toward booking with that barber', () => {
  assert.match(webhookSource, /Tanya kapster/);
  assert.match(webhookSource, /aku bisa bantu lanjut cari jadwal/);
});

// ── 4. Branch Inquiry Guidance ────────────────────────────────────────────────
test('4. Branch inquiry naturally leads toward booking when relevant', () => {
  assert.match(webhookSource, /Tanya cabang/);
  assert.match(webhookSource, /aku bisa bantu lanjut ke booking/);
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
