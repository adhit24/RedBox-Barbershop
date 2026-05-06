module.exports = (req, res) => {
  const { createInMemorySupabase, _outlets } = require('../server/moka/memoryStore');
  const supabase = createInMemorySupabase();
  
  res.json({
    outletsSize: _outlets.size,
    outletsKeys: Array.from(_outlets.keys()),
    envMokaId: process.env.MOKA_OUTLET_ID || 'NOT_SET',
    timestamp: new Date().toISOString()
  });
};
