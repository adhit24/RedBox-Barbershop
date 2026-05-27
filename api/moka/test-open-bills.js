'use strict';
/**
 * Diagnostic endpoint to test Moka API open bills endpoint variations
 * POST /api/moka/test-open-bills
 * 
 * Tests multiple endpoint hypotheses:
 * 1. Current: /v1/outlets/{id}/sync_bills/?statuses=PENDING&start=DD/MM/YYYY&end=DD/MM/YYYY
 * 2. Without trailing slash: /v1/outlets/{id}/sync_bills?statuses=PENDING...
 * 3. v2 endpoint: /v2/outlets/{id}/sync_bills?...
 * 4. v3 endpoint: /v3/outlets/{id}/bills?status=pending&...
 * 5. Alternative: /v1/outlets/{id}/bills?status=pending&...
 * 6. Orders endpoint: /v1/outlets/{id}/orders?status=pending&...
 */

const { getAccessToken } = require('../../server/moka/oauth');

const MOKA_API_BASE = process.env.MOKA_API_BASE || 'https://api.mokapos.com';

module.exports = async function testOpenBillsHandler(req, res) {
  try {
    const { outletId: rawOutletId, date } = req.query;
    
    if (!rawOutletId) {
      return res.status(400).json({ error: 'outletId is required' });
    }

    // Resolve outlet
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    let query = supabase.from('outlets').select('id, slug, moka_outlet_id');
    if (rawOutletId.includes('-')) {
      query = query.eq('id', rawOutletId);
    } else {
      query = query.eq('slug', rawOutletId);
    }
    const { data: outlet } = await query.single();
    
    if (!outlet?.moka_outlet_id) {
      return res.status(404).json({ error: `Outlet not found or missing moka_outlet_id: ${rawOutletId}` });
    }

    // Get access token
    const token = await getAccessToken(supabase, outlet.id);
    const mokaOutletId = outlet.moka_outlet_id;
    
    // Format date
    const testDate = date || new Date().toISOString().slice(0, 10);
    const [y, m, d] = testDate.split('-');
    const fmtDate = `${d}/${m}/${y}`;
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // Define endpoint variations to test
    const variations = [
      {
        name: 'current_with_trailing_slash',
        path: `/v1/outlets/${mokaOutletId}/sync_bills/?statuses=PENDING&start=${fmtDate}&end=${fmtDate}&per_page=10&deep=true`,
        desc: 'Current implementation (with trailing slash)'
      },
      {
        name: 'without_trailing_slash',
        path: `/v1/outlets/${mokaOutletId}/sync_bills?statuses=PENDING&start=${fmtDate}&end=${fmtDate}&per_page=10&deep=true`,
        desc: 'Without trailing slash (hypothesis: Moka changed path handling)'
      },
      {
        name: 'v2_sync_bills',
        path: `/v2/outlets/${mokaOutletId}/sync_bills?statuses=PENDING&start=${fmtDate}&end=${fmtDate}&per_page=10&deep=true`,
        desc: 'v2 endpoint (hypothesis: API version migration)'
      },
      {
        name: 'v1_bills_alt',
        path: `/v1/outlets/${mokaOutletId}/bills?status=PENDING&start=${fmtDate}&end=${fmtDate}&per_page=10`,
        desc: 'Alternative v1 bills endpoint'
      },
      {
        name: 'v3_bills',
        path: `/v3/outlets/${mokaOutletId}/bills?status=pending&start=${fmtDate}&end=${fmtDate}&per_page=10`,
        desc: 'v3 bills endpoint (hypothesis: v3 migration)'
      },
      {
        name: 'v1_orders_pending',
        path: `/v1/outlets/${mokaOutletId}/orders?status=pending&start_date=${fmtDate}&end_date=${fmtDate}&per_page=10`,
        desc: 'Orders endpoint with pending status'
      },
      {
        name: 'advanced_orderings_orders',
        path: `/v1/outlets/${mokaOutletId}/advanced_orderings/orders?per_page=10`,
        desc: 'Advanced orderings orders endpoint'
      }
    ];

    // Test each variation
    const results = [];
    for (const variant of variations) {
      const start = Date.now();
      try {
        const url = `${MOKA_API_BASE}${variant.path}`;
        const response = await fetch(url, { method: 'GET', headers });
        const text = await response.text();
        
        let data = null;
        try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
        
        results.push({
          name: variant.name,
          description: variant.desc,
          url: variant.path,
          status: response.status,
          statusText: response.statusText,
          latency_ms: Date.now() - start,
          success: response.ok,
          hasData: data?.data ? true : (Array.isArray(data) ? data.length > 0 : false),
          dataPreview: data?.data ? 
            (Array.isArray(data.data) ? `Array[${data.data.length}]` : 'Object') 
            : (data?.raw ? data.raw.slice(0, 100) : JSON.stringify(data).slice(0, 100)),
          fullResponse: data
        });
      } catch (err) {
        results.push({
          name: variant.name,
          description: variant.desc,
          url: variant.path,
          status: 'ERROR',
          statusText: err.message,
          latency_ms: Date.now() - start,
          success: false,
          hasData: false,
          error: err.message
        });
      }
    }

    // Summary
    const working = results.filter(r => r.success);
    const failing404 = results.filter(r => r.status === 404);
    
    res.json({
      outlet: {
        id: outlet.id,
        slug: outlet.slug,
        moka_outlet_id: outlet.moka_outlet_id
      },
      testDate: testDate,
      summary: {
        total: results.length,
        working: working.length,
        failing_404: failing404.length,
        recommended: working.length > 0 ? working[0].name : null
      },
      results: results
    });

  } catch (err) {
    console.error('[test-open-bills] Error:', err);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};
