require('dotenv').config();
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const table = process.env.AIRTABLE_BARBERS_TABLE_NAME;

base(table).select({ pageSize: 100 }).all().then(records => {
  console.log('Total records:', records.length);
  records.forEach(r => {
    const f = r.fields;
    const name = f['Nama Panggilan'] || f['Nama Lengkap'] || f['name'] || f['Name'] || '';
    const branch = f['Cabang Tempat Bekerja'] || f['branch'] || f['Branch'] || '';
    const id = f['id'] || f['ID'] || f['Barber ID'] || '';
    console.log(r.id, '| name:', name, '| branch:', branch, '| custom_id:', id);
  });
}).catch(e => console.error('ERROR:', e.message));
