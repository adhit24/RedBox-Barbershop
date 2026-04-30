require('dotenv').config();
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const table = process.env.AIRTABLE_BARBERS_TABLE_NAME;

base(table).select({ pageSize: 100 }).all().then(records => {
  // Find Khamami record
  const rec = records.find(r => r.id === 'recIoGIDHUWBBFVMs');
  if (rec) {
    const f = rec.fields;
    // Simulate the exact airtable.js logic
    const name = String(
      f['name'] || f['Name'] || f['Nama'] || f['Nama Kapster'] || f['Nama Panggilan'] || f['Nama Lengkap'] || ''
    ).trim();
    console.log('name result:', JSON.stringify(name));
    console.log('f[name]:', f['name']);
    console.log('f[Name]:', f['Name']);
    console.log('f[Nama]:', f['Nama']);
    console.log('f[Nama Kapster]:', f['Nama Kapster']);
    console.log('f[Nama Panggilan]:', f['Nama Panggilan']);
    console.log('f[Nama Lengkap]:', f['Nama Lengkap']);
    
    function slugify(input) {
      return String(input || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 45);
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
    const branchRaw = String(f['branch'] || f['Branch'] || f['Cabang'] || f['Cabang Tempat Bekerja'] || '').trim();
    const id = String(f['id'] || f['ID'] || f['Barber ID'] || '').trim() || `${branchSlug(branchRaw)}-${slugify(name)}`;
    console.log('\nGenerated ID:', id);
  } else {
    console.log('Record not found');
  }
}).catch(e => console.error('ERROR:', e.message));
