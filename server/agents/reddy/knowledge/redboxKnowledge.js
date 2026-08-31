'use strict';

const { REDBOX_SERVICES } = require('../../../../public/js/services-data');
const { validateKnowledge } = require('./validateKnowledge');

const KNOWLEDGE_VERSION = 'reddy_knowledge.v0.1';
const BRANCH_IDS = Object.freeze(['bypass', 'samadikun', 'csb', 'sumber', 'tegal']);
const SERVICE_ALIAS_EXTRAS = Object.freeze({
  'gentleman-grooming': ['redbox gentleman grooming', 'gentleman grooming', 'haircut', 'hair cut', 'potong rambut', 'potong', 'fade'],
  'hair-spa': ['hair spa', 'spa rambut'],
  'hair-color': ['hair color', 'coloring', 'cat rambut'],
  'hair-curly': ['hair curly', 'curly', 'keriting rambut'],
  'down-perm': ['down perm', 'root lift'],
  shaving: ['shaving', 'cukur jenggot', 'cukur kumis'],
  'men-massage': ['men massage', 'men massage service', 'pijat pria'],
});

function uniqueAliases(name, extras = []) {
  return [...new Set([name, ...extras].map(alias => alias.trim().toLowerCase()))];
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

const services = REDBOX_SERVICES.map(service => ({
  id: service.id,
  name: service.name,
  aliases: uniqueAliases(service.name, SERVICE_ALIAS_EXTRAS[service.id]),
  description: service.desc,
  duration_minutes: Number.parseInt(service.duration, 10),
  prices: { standard: service.price, csb: service.csbPrice },
}));

const REDBOX_KNOWLEDGE = freeze({
  version: KNOWLEDGE_VERSION,
  source_semantics: {
    services: 'Harga dan durasi berasal dari katalog booking publik.',
    branches: 'Alamat, jam, dan WhatsApp adalah data cabang yang sengaja dipublikasikan.',
    promotions: 'Daftar kosong berarti tidak ada promo publik terverifikasi.',
    membership: 'Hanya harga dan benefit yang ditegakkan backend; status pelanggan tetap CRM-only.',
  },
  branches: [
    { id: 'bypass', name: 'Redbox Bypass', aliases: ['bypass', 'redbox bypass', 'pusat'], address: 'Jl. Ahmad Yani No.88, Kecapi, Harjamukti, Cirebon, Jawa Barat', hours: { days: 'daily', opens: '10:00', closes: '21:00', timezone: 'Asia/Jakarta' }, last_booking_slot: '20:00', contact_id: 'whatsapp-bypass', phone: '0818202569', booking_url: 'booking.html?branch=bypass' },
    { id: 'samadikun', name: 'Redbox Samadikun', aliases: ['samadikun', 'redbox samadikun'], address: 'Jl. Kapten Samadikun No.60, Kesenden, Kec. Kejaksan, Kota Cirebon, Jawa Barat 45121', hours: { days: 'daily', opens: '10:00', closes: '21:00', timezone: 'Asia/Jakarta' }, last_booking_slot: '20:00', contact_id: 'whatsapp-samadikun', phone: '0818202589', booking_url: 'booking.html?branch=samadikun' },
    { id: 'csb', name: 'Redbox CSB Mall', aliases: ['csb', 'csb mall', 'cirebon super block'], address: 'CSB Mall, Jl. Dr. Cipto Mangunkusumo No.26, Kota Cirebon, Jawa Barat', hours: { days: 'daily', opens: '10:00', closes: '22:00', timezone: 'Asia/Jakarta' }, last_booking_slot: '21:00', contact_id: 'whatsapp-csb', phone: '0818202889', booking_url: 'booking.html?branch=csb' },
    { id: 'sumber', name: 'Redbox Sumber', aliases: ['sumber', 'redbox sumber'], address: 'Jl. Pangeran Cakrabuana No.2, Kemantren, Sumber, Kabupaten Cirebon, Jawa Barat 45611', hours: { days: 'daily', opens: '10:00', closes: '21:00', timezone: 'Asia/Jakarta' }, last_booking_slot: '20:00', contact_id: 'whatsapp-sumber', phone: '0818202599', booking_url: 'booking.html?branch=sumber' },
    { id: 'tegal', name: 'Redbox Tegal', aliases: ['tegal', 'tegal kota', 'redbox tegal'], address: 'Jl. Dr. Soetomo No.29, Pekauman, Kec. Tegal Barat, Kota Tegal, Jawa Tengah 52125', hours: { days: 'daily', opens: '10:00', closes: '21:00', timezone: 'Asia/Jakarta' }, last_booking_slot: '20:00', contact_id: 'whatsapp-tegal', phone: '0818268883', booking_url: 'booking.html?branch=tegal' },
  ],
  services,
  operational_policies: [
    { id: 'operating-hours', summary: 'Cabang buka setiap hari; jam tiap cabang tercantum pada data cabang.', branches: BRANCH_IDS },
  ],
  booking_policies: [
    { id: 'website-database-authority', summary: 'Website dan database booking adalah sumber status booking yang berwenang.', booking_url_template: 'booking.html?branch={branch_id}' },
    { id: 'walk-in-not-guaranteed', summary: 'Walk-in diperbolehkan, tetapi ketersediaan tidak dijamin.', booking_url_template: 'booking.html?branch={branch_id}' },
    { id: 'whatsapp-assist-authority-policy', summary: 'WhatsApp Redbox berfungsi untuk bantuan, edukasi, dan panduan. Pembuatan, konfirmasi, perubahan, reschedule, pembatalan, dan penguncian slot booking pelanggan harus dilakukan melalui sistem booking website Redbox.', booking_url_template: 'booking.html?branch={branch_id}' },
  ],
  // Task 14.1 correction — membership reconciliation. Three real sources were
  // audited (not just public/membership.html as in the previous pass):
  //   public/membership.html      (marketing page)
  //   server/membership-benefits.js (checkout discount calculator, tested)
  //   public/js/dashboard.js      (member dashboard benefit list, BENEFITS[])
  // The checkout calculator and the member dashboard independently AGREE with
  // each other, and both DISAGREE with the marketing page, on three points:
  //   - Silver: dashboard/calculator show NO general % discount (birthday
  //     only); the marketing page claims a 5% haircut discount.
  //   - Gold: dashboard/calculator EXCLUDE CSB Mall from the 10% discount;
  //     the marketing page claims it applies at every branch including CSB.
  //   - Platinum birthday: dashboard/calculator apply the same 50% formula
  //     used for every tier; the marketing page shows "FREE" (100%).
  // Per correction instructions: do not invent a canonical value for a
  // disputed rule, do not change checkout behavior here, and never let Reddy
  // state a disputed rule as unquestioned truth. Only the owner-confirmed
  // "Platinum includes Free Americano" and facts consistent across every
  // source are asserted as fact below; everything else disputed is flagged
  // via disputed_benefits so the prompt can make Reddy defer to a human
  // instead of guessing. See PR #38 discussion for the full matrix — flagged
  // for Aira/owner to resolve, not resolved by this correction.
  membership_public: {
    registration_url: 'membership.html',
    tiers: [
      {
        id: 'silver', price_idr: 100000, points_threshold: 500, uses_points: true,
        duration: '1 year after activation',
        benefits: [
          'Diskon ulang tahun 50% (-7 hari s/d +7 hari dari tanggal lahir).',
        ],
        disputed_benefits: [
          'Diskon haircut reguler (sumber resmi tidak sepakat — beberapa sumber menyatakan tidak ada diskon reguler untuk Silver; jangan sebutkan angka pasti, arahkan ke admin/kasir).',
        ],
      },
      {
        id: 'gold', price_idr: 250000, points_threshold: 501, uses_points: true,
        duration: '1 year after activation',
        benefits: [
          'Diskon 10% haircut.',
          'Diskon ulang tahun 50% (-7 hari s/d +7 hari dari tanggal lahir).',
        ],
        disputed_benefits: [
          'Cakupan cabang untuk diskon 10% (sumber resmi tidak sepakat apakah berlaku di CSB Mall — jangan pastikan cakupan cabang, arahkan ke admin/kasir untuk konfirmasi sebelum kunjungan ke CSB Mall).',
        ],
      },
      {
        id: 'platinum', price_idr: 1500000, points_threshold: null, uses_points: false,
        duration: '1 year after activation',
        benefits: [
          'Gratis Haircut/Gentleman Grooming.',
          'Gratis Americano setiap kunjungan.',
        ],
        disputed_benefits: [
          'Persentase benefit ulang tahun (sumber resmi tidak sepakat — beberapa sumber menyatakan gratis penuh, sumber lain menyatakan diskon 50%; jangan sebutkan angka pasti, arahkan ke admin/kasir).',
        ],
      },
    ],
  },
  promotions: [],
  faqs: [
    { id: 'membership-private-status', topics: ['membership', 'status'], question: 'Apakah saya member aktif atau tier saya apa?', answer_fact_ids: ['membership-crm-boundary'] },
    { id: 'live-booking-availability', topics: ['booking', 'availability'], question: 'Apakah slot atau kapster tersedia?', answer_fact_ids: ['website-database-authority'] },
  ],
  contacts: [
    { id: 'whatsapp-bypass', type: 'whatsapp', value: '+62 818-202-569', branches: ['bypass'], public: true },
    { id: 'whatsapp-samadikun', type: 'whatsapp', value: '+62 818-202-589', branches: ['samadikun'], public: true },
    { id: 'whatsapp-csb', type: 'whatsapp', value: '+62 818-202-889', branches: ['csb'], public: true },
    { id: 'whatsapp-sumber', type: 'whatsapp', value: '+62 818-202-599', branches: ['sumber'], public: true },
    { id: 'whatsapp-tegal', type: 'whatsapp', value: '+62 818-268-883', branches: ['tegal'], public: true },
  ],
  capabilities: [
    { id: 'home-service', available: true, static_only: true, booking_url: 'booking.html?type=homeservice', hours: { opens: '06:00', closes: '23:00', timezone: 'Asia/Jakarta' }, summary: 'Home service tersedia untuk Gentleman Grooming di Cirebon dan Tegal, dalam radius maksimal 5 KM dari cabang terdekat.' },
    { id: 'wedding-grooming', available: true, static_only: true, booking_url: 'home-service.html#wedding-pricing', packages: [{ id: 'wedding-gentleman', price_idr: 350000 }, { id: 'wedding-silver', price_idr: 500000 }, { id: 'wedding-gold', price_idr: 750000 }, { id: 'wedding-platinum', price_idr: 1000000 }], summary: 'Wedding Grooming tersedia dengan paket Rp350.000 hingga Rp1.000.000; harga ditegakkan server.' },
    { id: 'membership-crm-boundary', available: true, static_only: true, summary: 'Status tier, masa aktif, poin, dan kelayakan pelanggan memerlukan CRM terautentikasi.' },
    { id: 'live-booking-boundary', available: true, static_only: true, summary: 'Ketersediaan slot, kapster, dan status booking harus diperiksa melalui sistem booking.' },
  ],
});

const SERVICE_IDS = Object.freeze(REDBOX_KNOWLEDGE.services.map(service => service.id));

validateKnowledge(REDBOX_KNOWLEDGE);

module.exports = { REDBOX_KNOWLEDGE, KNOWLEDGE_VERSION, BRANCH_IDS, SERVICE_IDS };
