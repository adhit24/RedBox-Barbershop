'use strict';

const express = require('express');
const { createBackofficeSupabaseAuth } = require('../middleware/backofficeSupabaseAuth');

const TABLE = 'system_event_logs';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function parseLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

function createSystemEventLogRoutes(supabase, legacyAdminAuth) {
  const router = express.Router();
  const adminAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);

  router.get('/', adminAuth, async (req, res) => {
    const { module: moduleFilter, severity, status, eventName, from, to, correlationId, bookingId } = req.query;
    let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(parseLimit(req.query.limit));

    if (moduleFilter) query = query.eq('module', moduleFilter);
    if (severity) query = query.eq('severity', severity);
    if (status) query = query.eq('status', status);
    if (eventName) query = query.eq('event_name', eventName);
    if (correlationId) query = query.eq('correlation_id', correlationId);
    if (bookingId) query = query.eq('booking_id', bookingId);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'failed to load system event logs' });
    return res.json({ data: data || [] });
  });

  router.get('/timeline/:correlationId', adminAuth, async (req, res) => {
    const { correlationId } = req.params;
    if (!correlationId) return res.status(400).json({ error: 'correlationId required' });

    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('correlation_id', correlationId)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: 'failed to load timeline' });
    return res.json({ data: data || [] });
  });

  return router;
}

module.exports = { createSystemEventLogRoutes };
