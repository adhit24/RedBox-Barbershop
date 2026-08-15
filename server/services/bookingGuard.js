'use strict';

const BRANCH_ALIASES = new Map([
  ['csb mall', 'csb'],
  ['redbox csb mall', 'csb'],
  ['redbox barbershop csb', 'csb'],
  ['redbox barbershop bypass', 'bypass'],
  ['redbox bypass', 'bypass'],
  ['redbox barbershop samadikun', 'samadikun'],
  ['redbox samadikun', 'samadikun'],
  ['redbox barbershop sumber', 'sumber'],
  ['redbox sumber', 'sumber'],
  ['redbox barbershop tegal', 'tegal'],
  ['redbox tegal', 'tegal'],
]);

function normalizeBranch(value) {
  const raw = String(value || '').trim().toLowerCase();
  return BRANCH_ALIASES.get(raw) || raw;
}

async function getBarberForBooking(supabase, barberId) {
  if (!barberId) return { data: null, error: null };
  return supabase
    .from('barbers')
    .select('id, name, is_active, branch, outlet_id')
    .eq('id', barberId)
    .maybeSingle();
}

function branchMatchesBarber(barber, branch, outletId = null) {
  if (!barber) return false;
  const requestedBranch = normalizeBranch(branch);
  const barberBranch = normalizeBranch(barber.branch);
  if (requestedBranch && barberBranch && requestedBranch === barberBranch) return true;
  return Boolean(outletId && barber.outlet_id && String(outletId) === String(barber.outlet_id));
}

module.exports = {
  normalizeBranch,
  getBarberForBooking,
  branchMatchesBarber,
};
