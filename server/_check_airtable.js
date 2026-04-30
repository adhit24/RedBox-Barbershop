require('dotenv').config();
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const table = process.env.AIRTABLE_BARBERS_TABLE_NAME;

base(table).select({ pageSize: 100 }).all().then(records => {
  console.log('Total records:', records.length);
  const samadikun = records.filter(r => {
    const fields = Object.values(r.fields).join(' ').toLowerCase();
    return fields.includes('samad') || fields.includes('hamami') || fields.includes('khamami');
  });
  console.log('\n--- Samadikun / Hamami records ---');
  samadikun.forEach(r => {
    console.log('\nRecord ID:', r.id);
    console.log(JSON.stringify(r.fields, null, 2));
  });
}).catch(e => console.error('ERROR:', e.message));
