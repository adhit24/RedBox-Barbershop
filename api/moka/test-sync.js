/**
 * Test endpoint for Moka Open Bill Sync
 * Run manual sync and return results
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async (req) => {
  const url = new URL(req.url);
  const outletSlug = url.searchParams.get('outlet') || 'bypass';
  const secret = url.searchParams.get('secret');
  
  if (secret !== process.env.ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Get outlet info
    const { data: outlet, error: outletError } = await supabase
      .from('outlets')
      .select('id, slug, name')
      .eq('slug', outletSlug)
      .single();
    
    if (outletError) {
      return new Response(JSON.stringify({ error: 'Outlet not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check Moka token
    const { data: tokenData, error: tokenError } = await supabase
      .from('moka_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('outlet_id', outlet.id)
      .single();

    // Get barbers for this outlet
    const { data: barbers, error: barbersError } = await supabase
      .from('barbers')
      .select('id, name, moka_employee_id')
      .eq('outlet_id', outlet.id)
      .eq('is_active', true);

    const mappedBarbers = barbers?.filter(b => b.moka_employee_id) || [];
    const unmappedBarbers = barbers?.filter(b => !b.moka_employee_id) || [];

    // Get today's schedules
    const today = new Date().toISOString().split('T')[0];
    const { data: schedules, error: schedError } = await supabase
      .from('schedules')
      .select('id, barber_id, start_time, end_time, source, status')
      .eq('outlet_id', outlet.id)
      .gte('start_time', `${today}T00:00:00`)
      .lte('start_time', `${today}T23:59:59`);

    const mokaSchedules = schedules?.filter(s => s.source === 'moka_open_bill') || [];

    return new Response(JSON.stringify({
      timestamp: new Date().toISOString(),
      outlet: {
        id: outlet.id,
        slug: outlet.slug,
        name: outlet.name
      },
      moka_token: {
        has_token: !!tokenData,
        has_access_token: !!tokenData?.access_token,
        expires_at: tokenData?.expires_at,
        is_expired: tokenData?.expires_at ? new Date(tokenData.expires_at) < new Date() : null
      },
      barbers: {
        total: barbers?.length || 0,
        mapped: mappedBarbers.length,
        unmapped: unmappedBarbers.length,
        mapped_list: mappedBarbers.map(b => ({ id: b.id, name: b.name, moka_id: b.moka_employee_id })),
        unmapped_list: unmappedBarbers.map(b => ({ id: b.id, name: b.name }))
      },
      today_schedules: {
        total: schedules?.length || 0,
        moka_open_bills: mokaSchedules.length,
        moka_details: mokaSchedules.map(s => ({
          id: s.id,
          barber_id: s.barber_id,
          start: s.start_time,
          end: s.end_time,
          status: s.status
        }))
      },
      test_instructions: {
        step1: "Create open bill in Moka POS for this outlet",
        step2: "Wait 5 minutes (cron runs every 5 min) or call /api/moka/cron-sync?secret=YOUR_SECRET",
        step3: "Check booking website - slot should be blocked",
        step4: "Call this endpoint again to verify schedule was created"
      }
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Test failed',
      details: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: '/api/moka/test-sync'
};
