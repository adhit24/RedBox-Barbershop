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

function escapeAirtableValue(val) {
  // Escape single quotes untuk mencegah formula injection
  return String(val || '').replace(/'/g, "\\'");
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

module.exports = { syncBookingToAirtable, updateBookingInAirtable };
