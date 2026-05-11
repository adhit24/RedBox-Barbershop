#!/usr/bin/env node
'use strict';
/**
 * Generate Moka Token via Client Credentials Flow
 * Usage: node server/generate-moka-token.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const MOKA_CLIENT_ID = 'cab486edcbb2c038e0fc0385dcf589596275cbc692c4a0b0408e43b5b1786b91';
const MOKA_CLIENT_SECRET = '359823d3bf3cb9fdd61a2fffb1d4c8c68db0b18b677e63cf2f49157b8f752b60';
const MOKA_TOKEN_URL = process.env.MOKA_TOKEN_URL || 'https://api.mokapos.com/oauth/token';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env');
  process.exit(1);
}

if (!MOKA_CLIENT_ID || !MOKA_CLIENT_SECRET) {
  console.error('❌ MOKA_CLIENT_ID and MOKA_CLIENT_SECRET required in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function generateToken() {
  console.log('🔑 Generating Moka token via Client Credentials...\n');
  
  try {
    // 1. Get token from Moka
    // Try with minimal/default scope first
    console.log('📡 Calling Moka OAuth endpoint...');
    const res = await fetch(MOKA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: MOKA_CLIENT_ID,
        client_secret: MOKA_CLIENT_SECRET,
      }).toString(),
    });

    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    if (!res.ok) {
      console.error('❌ Token generation failed:');
      console.error('Status:', res.status);
      console.error('Response:', body);
      process.exit(1);
    }

    console.log('✅ Token generated successfully!');
    console.log('Scopes:', body.scope || ALL_SCOPES);
    console.log('Expires in:', body.expires_in, 'seconds');
    console.log('Token type:', body.token_type);

    // 2. Get outlet ID for bypass
    const { data: outlet, error: outletError } = await supabase
      .from('outlets')
      .select('id, name, slug')
      .eq('slug', 'bypass')
      .single();

    if (outletError || !outlet) {
      console.error('❌ Could not find bypass outlet:', outletError?.message);
      process.exit(1);
    }

    console.log('\n🏪 Outlet:', outlet.name, `(ID: ${outlet.id})`);

    // 3. Calculate expiry
    const expiresAt = new Date(
      Date.now() + (body.expires_in || 15552000) * 1000
    ).toISOString();

    // 4. Store token in database (created_at has default value)
    const { error: insertError } = await supabase
      .from('moka_tokens')
      .upsert({
        outlet_id: outlet.id,
        access_token: body.access_token,
        refresh_token: body.refresh_token || null,
        token_type: body.token_type || 'Bearer',
        expires_at: expiresAt,
        scope: body.scope || 'profile',
      }, { onConflict: 'outlet_id' });

    if (insertError) {
      console.error('❌ Failed to store token:', insertError.message);
      process.exit(1);
    }

    console.log('\n✅ Token stored in database successfully!');
    console.log('Expires at:', expiresAt);
    
    // 5. Test the token
    console.log('\n🧪 Testing token with Moka API...');
    const testRes = await fetch('https://api.mokapos.com/v1/outlets', {
      headers: {
        'Authorization': `Bearer ${body.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (testRes.ok) {
      const outlets = await testRes.json();
      console.log('✅ API test successful!');
      console.log('Accessible outlets:', outlets.data?.length || 0);
    } else {
      console.warn('⚠️ Token generated but API test failed:', testRes.status);
      const err = await testRes.text();
      console.warn('Error:', err.slice(0, 200));
    }

    console.log('\n🎉 Done! Sync will begin automatically on next cron tick.');
    console.log('   Or trigger manually via: POST /api/moka/sync');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

generateToken();
