'use strict';

const { calculateMode } = require('./customer360Service');

function computeBarberPerformance(visitRows = [], options = {}) {
  const branchFilter = options.branch && options.branch !== 'all' ? options.branch : null;
  const scopedRows = branchFilter ? visitRows.filter(r => r.branch === branchFilter) : visitRows;

  const byBarber = new Map();
  for (const row of scopedRows) {
    if (!row.barberId) continue;
    if (!byBarber.has(row.barberId)) {
      byBarber.set(row.barberId, { barberId: row.barberId, name: row.barberName || 'Tidak diketahui', visits: [] });
    }
    byBarber.get(row.barberId).visits.push(row);
  }

  const customersByBarber = new Map();
  for (const [barberId, entry] of byBarber.entries()) {
    const customerVisitCounts = new Map();
    for (const v of entry.visits) {
      const key = v.phone ? `phone:${v.phone}` : `name:${(v.name || 'unknown').toLowerCase()}`;
      customerVisitCounts.set(key, (customerVisitCounts.get(key) || 0) + 1);
    }
    customersByBarber.set(barberId, customerVisitCounts);
  }

  const barbers = [...byBarber.entries()].map(([barberId, entry]) => {
    const customerVisitCounts = customersByBarber.get(barberId);
    const customersServed = customerVisitCounts.size;
    const repeatCustomers = [...customerVisitCounts.values()].filter(c => c >= 2).length;
    const repeatRate = customersServed > 0 ? Math.round((repeatCustomers / customersServed) * 100) : 0;
    const branch = calculateMode(
      entry.visits.map(v => v.branch).filter(Boolean),
      entry.visits.map(v => v.branch).filter(Boolean).reverse()
    );

    return {
      barber_id: barberId,
      name: entry.name,
      branch,
      customers_served: customersServed,
      completed_services: entry.visits.length,
      repeat_rate: repeatRate,
    };
  }).sort((a, b) => b.customers_served - a.customers_served);

  return { barbers };
}

module.exports = { computeBarberPerformance };
