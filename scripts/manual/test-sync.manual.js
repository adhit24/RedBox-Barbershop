#!/usr/bin/env node
'use strict';
/**
 * Test Moka Sync - Pull Open Bills manually
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MOKA_API_BASE = 'https://api.mokapos.com';
const MOKA_CLIENT_ID = 'cab486edcbb2c038e0fc0385dcf589596275cbc692c4a0b0408e43b5b1786b91';
const MOKA_CLIENT_SECRET = '359823d3bf3cb9fdd61a2fffb1d4c8c68db0b18b677e63cf2f49157b8f752b60';

async function getAccessToken() {
  const { data: tokenRow } = await supabase
    .from('moka_tokens')
    .select('access_token')
    .order('expires_at', { ascending: false })
    .limit(1)
    .single();
  
  if (!tokenRow) {
    console.error('❌ No token found in database');
    return null;
  }
  
  return tokenRow.access_token;
}

async function mokaApiRequest(pathname, token) {
  const url = `${MOKA_API_BASE}${pathname}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Moka API error ${res.status}: ${err.slice(0, 200)}`);
  }
  
  return res.json();
}

async function main() {
  console.log('🔄 Testing Moka Sync...\n');
  
  try {
    // 1. Get access token
    const token = await getAccessToken();
    if (!token) {
      console.error('❌ Cannot proceed without token');
      process.exit(1);
    }
    
    console.log('✅ Token retrieved from database');
    
    // 2. Test API - Get outlets (with outlet_id from token)
    console.log('\n📡 Testing API: GET /v1/outlets');
    try {
      const outlets = await mokaApiRequest('/v1/outlets', token);
      console.log('✅ API Response:', JSON.stringify(outlets.data?.[0] || outlets, null, 2).slice(0, 200));
    } catch (e) {
      console.log('⚠️ /v1/outlets failed, trying /v1/me...');
      try {
        const me = await mokaApiRequest('/v1/me', token);
        console.log('✅ /v1/me Response:', JSON.stringify(me, null, 2).slice(0, 300));
      } catch (e2) {
        console.log('❌ Both endpoints failed');
      }
    }
    
    // 3. Get outlet ID from database
    const { data: outlet } = await supabase
      .from('outlets')
      .select('id, name, slug, moka_outlet_id')
      .eq('slug', 'bypass')
      .single();
    
    console.log('\n🏪 Local Outlet:', outlet);
    
    if (!outlet.moka_outlet_id) {
      console.log('❌ No moka_outlet_id set for this outlet');
      process.exit(1);
    }
    
    // 4. Test API dengan outlet ID
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    
    // Format untuk Moka: DD/MM/YYYY
    const toFmt = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
    
    console.log(`\n� Testing: sync_bills for outlet ${outlet.moka_outlet_id}`);
    console.log(`Date range: ${toFmt(today)} - ${toFmt(tomorrow)}`);
    
    try {
      const qs = new URLSearchParams({ 
        statuses: 'PENDING', 
        start: toFmt(today), 
        end: toFmt(tomorrow), 
        per_page: '200', 
        deep: 'true' 
      });
      
      const bills = await mokaApiRequest(
        `/v1/outlets/${outlet.moka_outlet_id}/sync_bills/?${qs}`,
        token
      );
      
      console.log('✅ Bills API Response:', JSON.stringify(bills, null, 2).slice(0, 500));
      
      if (bills.data && bills.data.length > 0) {
        console.log(`\n🎉 Found ${bills.data.length} open bills!`);
        
        // Show first bill
        const bill = bills.data[0];
        console.log('\n📄 First bill:', {
          id: bill.id,
          name: bill.name,
          status: bill.status,
          createdAt: bill.createdAt || bill.created_at,
        });
      } else {
        console.log('\nℹ️ No open bills found for today/tomorrow');
      }
      
    } catch (e) {
      console.error('❌ Bills API failed:', e.message);
    }
    
    console.log('\n🎉 Test complete!');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
