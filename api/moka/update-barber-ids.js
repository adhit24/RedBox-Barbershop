/**
 * API Endpoint to update barber IDs from CSV data
 * Run this after extracting IDs from Moka Item Library CSV files
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async (req) => {
  // Verify admin secret
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  
  if (secret !== process.env.ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Tegal barber IDs from CSV
    const tegalUpdates = [
      { id: 'tegal-faiz', moka_id: '147468093' },
      { id: 'tegal-wawan', moka_id: '147470744' },
      { id: 'tegal-epik', moka_id: '147465521' },
      { id: 'tegal-ahmad', moka_id: '147463715' },
      { id: 'tegal-sephril', moka_id: '147470666' },
      { id: 'tegal-yafi', moka_id: '147470745' },
    ];

    const results = [];
    
    for (const barber of tegalUpdates) {
      const { data, error } = await supabase
        .from('barbers')
        .update({ moka_employee_id: barber.moka_id })
        .eq('id', barber.id)
        .select('id, name, moka_employee_id');
      
      if (error) {
        results.push({ id: barber.id, status: 'error', error: error.message });
      } else {
        results.push({ id: barber.id, status: 'updated', data });
      }
    }

    // Get final summary
    const { data: summary } = await supabase
      .from('barbers')
      .select('outlet_id, moka_employee_id, is_active')
      .eq('is_active', true);

    const outletSummary = summary.reduce((acc, row) => {
      const outlet = row.outlet_id;
      if (!acc[outlet]) acc[outlet] = { total: 0, mapped: 0 };
      acc[outlet].total++;
      if (row.moka_employee_id) acc[outlet].mapped++;
      return acc;
    }, {});

    return new Response(JSON.stringify({
      success: true,
      updates: results,
      summary: outletSummary
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to update barber IDs',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: '/api/moka/update-barber-ids'
};
