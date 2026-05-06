'use strict';
/**
 * One-shot script: sync Moka schema (item IDs) → Supabase barbers/services
 * Run: node server/run-schema-sync.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');
const { syncMokaSchema } = require('./moka/schemaSync');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
                  || process.env.SUPABASE_SERVICE_ROLE_KEY
                  || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

syncMokaSchema(supabase)
  .then(result => {
    console.log('\n=== Sync complete ===');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal:', err.message, err.stack);
    process.exit(1);
  });
