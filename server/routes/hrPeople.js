'use strict';

const express = require('express');
const { createBackofficeSupabaseAuth } = require('../middleware/backofficeSupabaseAuth');

const FILTERS = new Set(['all', 'redbox', 'sundaze']);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function mapBarber(row) {
  return {
    id: `barber:${row.id}`,
    source: 'barbers',
    source_record_id: row.id,
    name: row.name,
    nickname: null,
    business_unit: 'Redbox',
    position: 'Kapster',
    branch: row.branch,
    branch_name: row.branch,
    employment_type: 'commission-based',
    payroll_type: null,
    attendance_status: null,
    is_active: row.is_active === true,
  };
}

function mapEmployee(row) {
  return {
    id: `employee:${row.id}`,
    source: 'employees',
    source_record_id: row.id,
    name: row.name,
    nickname: row.nickname || null,
    business_unit: row.business_unit,
    position: row.position,
    branch: row.branch || null,
    branch_name: row.branch_name || null,
    employment_type: row.employment_type,
    payroll_type: row.payroll_type || null,
    attendance_status: null,
    is_active: row.is_active === true,
  };
}

function dedupePeople(people) {
  const unique = new Map();
  for (const person of people) {
    const identity = [person.business_unit, person.name, person.position]
      .map(normalizeName)
      .join(':');
    if (!unique.has(identity)) unique.set(identity, person);
  }
  return [...unique.values()];
}

function applyPeopleFilter(people, filter) {
  if (filter === 'all') return people;
  return people.filter(person => normalizeText(person.business_unit) === filter);
}

function summarizePeople(people) {
  const activeBarbers = people.filter(person => person.source === 'barbers' && person.is_active);
  const regularEmployees = people.filter(person => (
    person.source === 'employees'
    && person.is_active
    && normalizeText(person.employment_type) === 'regular'
  ));
  return {
    active_barbers: activeBarbers.length,
    regular_employees: regularEmployees.length,
    barber_branches: new Set(activeBarbers.map(person => normalizeText(person.branch)).filter(Boolean)).size,
    active_business_units: new Set(people.filter(person => person.is_active).map(person => normalizeText(person.business_unit)).filter(Boolean)).size,
  };
}

function createHRPeopleRoutes(supabase, legacyAdminAuth) {
  const router = express.Router();
  const adminAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);

  router.get('/', adminAuth, async (req, res) => {
    const filter = normalizeText(req.query.filter || 'all');
    if (!FILTERS.has(filter)) return res.status(400).json({ error: 'Invalid workforce filter' });

    const [barberResult, employeeResult] = await Promise.all([
      supabase.from('barbers')
        .select('id,name,branch,is_active')
        .eq('is_active', true),
      supabase.from('employees')
        .select('id,name,nickname,business_unit,position,branch,branch_name,employment_type,payroll_type,is_active')
        .eq('is_active', true)
        .eq('employment_type', 'regular'),
    ]);

    if (barberResult.error || employeeResult.error) {
      return res.status(500).json({ error: 'Unable to load HR & People data' });
    }

    const people = dedupePeople([
      ...(barberResult.data || []).map(mapBarber),
      ...(employeeResult.data || []).map(mapEmployee),
    ]);
    const filteredPeople = applyPeopleFilter(people, filter).sort((a, b) => (
      String(a.business_unit || '').localeCompare(String(b.business_unit || ''), 'id', { sensitivity: 'base' })
      || String(a.branch_name || a.branch || '').localeCompare(String(b.branch_name || b.branch || ''), 'id', { sensitivity: 'base' })
      || String(a.name || '').localeCompare(String(b.name || ''), 'id', { sensitivity: 'base' })
    ));

    return res.json({
      source: 'database',
      filter,
      kpis: summarizePeople(filteredPeople),
      people: filteredPeople,
      attendance: { available: false, label: 'Belum tersedia' },
      reconciliation: {
        owner_expected_active_barbers: 27,
        status: 'pending_owner_review',
      },
    });
  });

  return router;
}

module.exports = {
  FILTERS,
  normalizeName,
  mapBarber,
  mapEmployee,
  dedupePeople,
  applyPeopleFilter,
  summarizePeople,
  createHRPeopleRoutes,
};
