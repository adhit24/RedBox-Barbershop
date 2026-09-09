'use strict';

/**
 * Service: stockistBackofficeDashboard
 * 
 * Computes live monitoring metrics for Redbox Backoffice Stockist & Inventory dashboard.
 * Read-only against Supabase. Single source of truth is existing Stockist tables.
 */

const { isFoodOrBeverageProduct } = require('./stockistInventory');

const REDBOX_BRANCH_DEFS = [
  { slug: 'bypass', name: 'Bypass' },
  { slug: 'samadikun', name: 'Samadikun' },
  { slug: 'csb', name: 'CSB Mall' },
  { slug: 'sumber', name: 'Sumber' },
  { slug: 'tegal', name: 'Tegal' },
];

function formatWIBTime(date = new Date()) {
  const d = new Date(date.getTime() + 7 * 3600000);
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatWIBDateShort(dateStr) {
  // dateStr is YYYY-MM-DD or ISO
  const d = new Date(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const day = d.getDate();
  const month = months[d.getMonth()];
  return `${day} ${month}`;
}

function formatWIBDateTime(date = new Date()) {
  const d = new Date(date.getTime() + 7 * 3600000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const day = d.getUTCDate();
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hours}:${minutes}`;
}

async function getStockistBackofficeData(supabase, access) {
  const isOwner = access.role === 'owner' || access.role === 'manager';
  const authorizedBranch = access.role === 'branch_admin' ? access.branch : null;

  // 1. Fetch outlets & inventory locations
  const [{ data: outlets, error: outletErr }, { data: locations, error: locErr }] = await Promise.all([
    supabase.from('outlets').select('id, name, slug'),
    supabase.from('inventory_locations').select('id, type, outlet_id'),
  ]);
  if (outletErr) throw new Error(`Outlets load failed: ${outletErr.message}`);
  if (locErr) throw new Error(`Locations load failed: ${locErr.message}`);

  const outletById = new Map((outlets || []).map((o) => [o.id, o]));
  const outletBySlug = new Map((outlets || []).map((o) => [(o.slug || o.id || '').toLowerCase(), o]));

  const locationNames = {};
  const branchLocations = new Map(); // slug -> location
  let warehouseLocation = null;

  for (const loc of locations || []) {
    if (loc.type === 'warehouse') {
      warehouseLocation = loc;
      locationNames[loc.id] = 'Gudang Pusat';
    } else if (loc.type === 'branch' && loc.outlet_id) {
      const outlet = outletById.get(loc.outlet_id);
      const name = outlet?.name || 'Cabang';
      locationNames[loc.id] = name;
      if (outlet?.slug) {
        branchLocations.set(outlet.slug.toLowerCase(), loc);
      }
    }
  }

  // Filter authorized locations
  const authorizedLocationIds = new Set();
  if (isOwner) {
    for (const loc of locations || []) authorizedLocationIds.add(loc.id);
  } else if (authorizedBranch) {
    const bLoc = branchLocations.get(authorizedBranch.toLowerCase());
    if (bLoc) authorizedLocationIds.add(bLoc.id);
  }

  // 2. Fetch products
  const { data: rawProducts, error: prodErr } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true);
  if (prodErr) throw new Error(`Products load failed: ${prodErr.message}`);

  const activeProducts = (rawProducts || []).filter((p) => !isFoodOrBeverageProduct(p));
  const productById = new Map(activeProducts.map((p) => [p.id, p]));
  const activeProductIds = new Set(activeProducts.map((p) => p.id));

  // 3. Fetch balances
  const { data: rawBalances, error: balErr } = await supabase
    .from('inventory_balances')
    .select('*');
  if (balErr) throw new Error(`Balances load failed: ${balErr.message}`);

  const balances = (rawBalances || []).filter((b) =>
    authorizedLocationIds.has(b.location_id) && activeProductIds.has(b.product_id)
  );

  // Balances by location
  const balancesByLoc = new Map();
  for (const b of balances) {
    if (!balancesByLoc.has(b.location_id)) balancesByLoc.set(b.location_id, []);
    balancesByLoc.get(b.location_id).push(b);
  }

  // 4. Fetch transfers
  const { data: rawTransfers, error: trfErr } = await supabase
    .from('stock_transfers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (trfErr) throw new Error(`Transfers load failed: ${trfErr.message}`);

  const transfers = (rawTransfers || []).filter((t) =>
    authorizedLocationIds.has(t.source_location_id) || authorizedLocationIds.has(t.destination_location_id)
  );

  // Transfer items for top transfers
  const transferIds = transfers.map((t) => t.id);
  let transferItems = [];
  if (transferIds.length > 0) {
    const { data: items } = await supabase
      .from('stock_transfer_items')
      .select('*')
      .in('stock_transfer_id', transferIds);
    transferItems = items || [];
  }

  const itemsByTransferId = new Map();
  for (const item of transferItems) {
    if (!itemsByTransferId.has(item.stock_transfer_id)) itemsByTransferId.set(item.stock_transfer_id, []);
    itemsByTransferId.get(item.stock_transfer_id).push(item);
  }

  // 5. Fetch stock opnames for audits
  const { data: rawOpnames, error: opnErr } = await supabase
    .from('stock_opnames')
    .select('*')
    .eq('status', 'APPROVED')
    .order('approved_at', { ascending: false })
    .limit(10);
  if (opnErr) throw new Error(`Opnames load failed: ${opnErr.message}`);

  const opnameIds = (rawOpnames || []).map((o) => o.id);
  let opnameItems = [];
  if (opnameIds.length > 0) {
    const { data: oItems } = await supabase
      .from('stock_opname_items')
      .select('*')
      .in('stock_opname_id', opnameIds)
      .neq('difference', 0);
    opnameItems = oItems || [];
  }

  // 6. Check latest analytical sync from inventory_daily_movements
  let analyticsCalcAt = null;
  const { data: latestDaily } = await supabase
    .from('inventory_daily_movements')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (latestDaily && latestDaily.length > 0 && latestDaily[0].updated_at) {
    analyticsCalcAt = formatWIBDateTime(new Date(latestDaily[0].updated_at));
  }

  // ==========================================
  // COMPUTE SUMMARY KPIS
  // ==========================================
  let totalStockQty = 0;
  let lowStockCount = 0;

  for (const b of balances) {
    if (b.quantity > 0) totalStockQty += b.quantity;
    const prod = productById.get(b.product_id);
    const minThreshold = prod?.minimum_stock ?? prod?.reorder_point ?? 0;
    if (b.quantity <= minThreshold) lowStockCount += 1;
  }

  const activeTransfersCount = transfers.filter((t) =>
    ['SENT', 'IN_TRANSIT', 'in_transit', 'PENDING', 'pending_receipt'].includes(t.status)
  ).length;

  // ==========================================
  // COMPUTE BRANCH HEALTH (5 BRANCHES OR SCOPED)
  // ==========================================
  const branchHealthCards = REDBOX_BRANCH_DEFS
    .filter((bDef) => !authorizedBranch || bDef.slug === authorizedBranch.toLowerCase())
    .map((bDef) => {
    const loc = branchLocations.get(bDef.slug);
    if (!loc) {
      return {
        id: bDef.slug,
        name: bDef.name,
        slug: bDef.slug,
        stock: 0,
        low_stock_count: 0,
        out_of_stock_count: 0,
        status: 'healthy',
        status_text: 'Sehat',
        capacity_pct: 0,
      };
    }

    const locBalances = balancesByLoc.get(loc.id) || [];
    let bStock = 0;
    let bLow = 0;
    let bOut = 0;

    for (const b of locBalances) {
      if (b.quantity > 0) bStock += b.quantity;
      const prod = productById.get(b.product_id);
      const minThreshold = prod?.minimum_stock ?? prod?.reorder_point ?? 0;
      if (b.quantity <= 0) bOut += 1;
      else if (b.quantity <= minThreshold) bLow += 1;
    }

    let status = 'healthy';
    let statusText = 'Sehat';

    if (bOut > 0) {
      status = 'out';
      statusText = `${bOut} Habis`;
    } else if (bLow > 0) {
      status = 'low';
      statusText = `${bLow} Low Stock`;
    }

    // Capacity percentage estimate normalized around target 1000 pcs
    const capacityPct = Math.min(100, Math.max(12, Math.round((bStock / 1200) * 100)));

    return {
      id: bDef.slug,
      name: bDef.name,
      slug: bDef.slug,
      stock: bStock,
      low_stock_count: bLow,
      out_of_stock_count: bOut,
      status,
      status_text: statusText,
      capacity_pct: capacityPct,
    };
  });

  // ==========================================
  // COMPUTE "NEEDS ATTENTION" ITEMS
  // ==========================================
  const needsAttentionList = [];
  let itemIdx = 1;

  for (const b of balances) {
    const prod = productById.get(b.product_id);
    if (!prod) continue;
    const minThreshold = prod.minimum_stock ?? prod.reorder_point ?? 0;
    if (b.quantity <= minThreshold) {
      const locName = locationNames[b.location_id] || 'Cabang';
      let itemStatus = 'Restock';
      if (b.quantity <= 0) itemStatus = 'Out';
      else if (b.quantity <= Math.ceil(minThreshold / 2)) itemStatus = 'Low';

      needsAttentionList.push({
        id: itemIdx++,
        product_id: prod.id,
        name: prod.name,
        sku: prod.sku,
        branch: locName.replace(/^RedBox\s*/i, ''),
        stock: b.quantity,
        min: minThreshold,
        status: itemStatus,
        img: getProductFallbackImage(prod.name),
      });
    }
  }

  // Sort: Out first (0 stock), then lowest stock
  needsAttentionList.sort((a, b) => a.stock - b.stock);
  const topNeedsAttention = needsAttentionList.slice(0, 10);

  // ==========================================
  // COMPUTE "TRANSFER STATUS" CARDS
  // ==========================================
  const transferCards = transfers.slice(0, 6).map((t) => {
    const items = itemsByTransferId.get(t.id) || [];
    const totalSent = items.reduce((sum, i) => sum + (i.quantity_sent || 0), 0);

    let displayStatus = 'Dikirim';
    if (t.has_discrepancy) {
      displayStatus = 'Discrepancy';
    } else if (t.status === 'RECEIVED') {
      displayStatus = 'Diterima';
    } else if (t.status === 'SENT') {
      displayStatus = 'Dikirim';
    }

    const fromName = locationNames[t.source_location_id] || 'Gudang Pusat';
    const toName = locationNames[t.destination_location_id] || 'Cabang';

    return {
      id: t.id,
      transfer_number: t.transfer_number,
      from: fromName.replace(/^RedBox\s*/i, ''),
      to: toName.replace(/^RedBox\s*/i, ''),
      status: displayStatus,
      raw_status: t.status,
      timestamp: formatWIBDateTime(new Date(t.sent_at || t.created_at)),
      qty: `${totalSent} pcs`,
      courier: t.has_discrepancy ? 'Discrepancy tercatat' : 'Kurir Redbox',
      has_discrepancy: Boolean(t.has_discrepancy),
    };
  });

  // ==========================================
  // COMPUTE "DISCREPANCY & AUDIT" LIST
  // ==========================================
  const discrepancyAudits = [];

  // 1. From transfers with discrepancy
  for (const t of transfers) {
    if (t.has_discrepancy) {
      const items = itemsByTransferId.get(t.id) || [];
      const diffItem = items.find((i) => i.quantity_sent !== i.quantity_received) || items[0];
      const prodName = diffItem ? productById.get(diffItem.product_id)?.name || 'Produk' : 'Produk';
      const destName = locationNames[t.destination_location_id] || 'Cabang';

      discrepancyAudits.push({
        id: t.transfer_number,
        branch: destName.replace(/^RedBox\s*/i, ''),
        date: formatWIBDateTime(new Date(t.received_at || t.sent_at || t.created_at)),
        summary: `Selisih pada transfer ${prodName}`,
        auditor: 'Penerima Cabang',
        status_text: 'Investigasi',
        type: 'discrepancy',
      });
    }
  }

  // 2. From approved opnames with difference
  for (const oItem of opnameItems.slice(0, 5)) {
    const parentOpname = (rawOpnames || []).find((o) => o.id === oItem.stock_opname_id);
    const prodName = productById.get(oItem.product_id)?.name || 'Produk';
    const locName = locationNames[parentOpname?.location_id] || 'Cabang';
    const diff = oItem.difference || 0;

    discrepancyAudits.push({
      id: parentOpname?.opname_number || `OPN-${oItem.id.slice(0, 6)}`,
      branch: locName.replace(/^RedBox\s*/i, ''),
      date: formatWIBDateTime(new Date(parentOpname?.approved_at || parentOpname?.created_at)),
      summary: `Penyesuaian stok ${prodName} (${diff > 0 ? '+' : ''}${diff} pcs)`,
      auditor: 'Supervisor / Owner',
      status_text: 'Penyesuaian Disetujui',
      type: 'adjustment',
    });
  }

  // If no discrepancies or audits, provide a clean matched entry
  if (discrepancyAudits.length === 0 && rawOpnames && rawOpnames.length > 0) {
    const latestOp = rawOpnames[0];
    const locName = locationNames[latestOp.location_id] || 'Semua Cabang';
    discrepancyAudits.push({
      id: latestOp.opname_number,
      branch: locName.replace(/^RedBox\s*/i, ''),
      date: formatWIBDateTime(new Date(latestOp.approved_at || latestOp.created_at)),
      summary: 'Semua item sesuai — Stok fisik matched 100%',
      auditor: 'Auditor Cabang',
      status_text: 'Match (100%)',
      type: 'match',
    });
  }

  // ==========================================
  // COMPUTE DYNAMIC ALERT BANNER
  // ==========================================
  const branchesNeedAttentionCount = branchHealthCards.filter((b) => b.status !== 'healthy').length;
  const criticalProductsCount = topNeedsAttention.length;

  let alertBannerText = 'Semua cabang dalam kondisi sehat dan stok tercukupi.';
  if (branchesNeedAttentionCount > 0 || criticalProductsCount > 0 || activeTransfersCount > 0) {
    alertBannerText = `Perlu perhatian: ${branchesNeedAttentionCount} cabang membutuhkan restock, ${activeTransfersCount} transfer berjalan, dan ${criticalProductsCount} produk berada di bawah minimum stock.`;
  }

  return {
    summary: {
      total_stock: totalStockQty,
      active_skus: activeProducts.length,
      low_stock_count: lowStockCount,
      active_transfers_count: activeTransfersCount,
    },
    alert_banner: {
      text: alertBannerText,
      has_issues: branchesNeedAttentionCount > 0 || criticalProductsCount > 0,
      branches_need_attention: branchesNeedAttentionCount,
      active_transfers: activeTransfersCount,
      critical_products: criticalProductsCount,
    },
    branches: branchHealthCards,
    needs_attention: topNeedsAttention,
    transfers: transferCards,
    discrepancy_and_audit: discrepancyAudits.slice(0, 5),
    live_sync_at: `Updated ${formatWIBTime(new Date())} WIB`,
    analytics_calc_at: analyticsCalcAt,
    role: access.role,
    authorized_branch: authorizedBranch,
  };
}

function getProductFallbackImage(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('pomade') || n.includes('oil')) return '/uploads/oil_base.jpeg';
  if (n.includes('tonic') || n.includes('water')) return '/uploads/water_base.jpeg';
  if (n.includes('shaving') || n.includes('gel')) return '/uploads/psyi.jpeg';
  if (n.includes('clay')) return '/uploads/clay.jpeg';
  return '/uploads/oil_base.jpeg';
}

async function getStockistMovementChart(supabase, access, { days = 7, branch = null } = {}) {
  const normalizedDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 7;
  const isOwner = access.role === 'owner' || access.role === 'manager';
  const authorizedBranch = access.role === 'branch_admin' ? access.branch : branch;

  // Calculate start date in WIB
  const now = new Date();
  const wibTime = new Date(now.getTime() + 7 * 3600000);
  const startDateObj = new Date(wibTime);
  startDateObj.setUTCDate(startDateObj.getUTCDate() - (normalizedDays - 1));
  const startDateIso = startDateObj.toISOString().slice(0, 10);
  const endDateIso = wibTime.toISOString().slice(0, 10);

  // If branch filter requested, resolve outlet_id
  let targetOutletId = null;
  if (authorizedBranch) {
    const { data: outlet } = await supabase
      .from('outlets')
      .select('id')
      .eq('slug', authorizedBranch.toLowerCase())
      .maybeSingle();
    targetOutletId = outlet?.id || null;
  }

  let query = supabase
    .from('inventory_daily_movements')
    .select('date, location_id, branch_id, received_qty, transfer_in_qty, transfer_out_qty')
    .gte('date', startDateIso)
    .lte('date', endDateIso);

  if (targetOutletId) {
    query = query.eq('branch_id', targetOutletId);
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(`Movement chart load failed: ${error.message}`);

  // Fetch latest calc timestamp
  const { data: latestRow } = await supabase
    .from('inventory_daily_movements')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);

  const calculatedAt = latestRow?.length && latestRow[0].updated_at
    ? formatWIBDateTime(new Date(latestRow[0].updated_at))
    : null;

  if (!rows || rows.length === 0) {
    return {
      points: [],
      calculated_at: calculatedAt,
      days: normalizedDays,
    };
  }

  // Group by date
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) {
      byDate.set(r.date, {
        date: r.date,
        masuk: 0,
        keluar: 0,
        terima: 0,
      });
    }
    const pt = byDate.get(r.date);
    pt.masuk += Number(r.received_qty || 0);
    pt.keluar += Number(r.transfer_out_qty || 0);
    pt.terima += Number(r.transfer_in_qty || 0);
  }

  // Construct continuous timeline
  const points = [];
  const curr = new Date(startDateObj);

  for (let i = 0; i < normalizedDays; i++) {
    const dateStr = curr.toISOString().slice(0, 10);
    const existing = byDate.get(dateStr);

    points.push({
      date: formatWIBDateShort(dateStr),
      raw_date: dateStr,
      masuk: existing ? existing.masuk : 0,
      keluar: existing ? existing.keluar : 0,
      terima: existing ? existing.terima : 0,
    });

    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return {
    points,
    calculated_at: calculatedAt,
    days: normalizedDays,
  };
}

module.exports = {
  getStockistBackofficeData,
  getStockistMovementChart,
  formatWIBTime,
  formatWIBDateShort,
  formatWIBDateTime,
};
