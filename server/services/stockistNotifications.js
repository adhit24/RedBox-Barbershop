'use strict';

const { sendPushToUser } = require('./webPush');

// A product stays under the same low-stock alert for at most this long
// before it's allowed to re-notify — prevents spamming on every movement
// while a branch just hasn't acted on the first alert yet.
const LOW_STOCK_COOLDOWN_MS = 12 * 60 * 60 * 1000;

async function findOwnerUserIds(supabase) {
  const { data } = await supabase.from('users').select('id').eq('role', 'owner');
  return (data || []).map((u) => u.id);
}

async function findBranchAdminUserIds(supabase, branchSlug) {
  const { data } = await supabase.from('users').select('id').eq('role', 'branch_admin').eq('branch', branchSlug);
  return (data || []).map((u) => u.id);
}

// Push failures must never take down the caller's main transaction — each
// send is best-effort and independently swallowed.
async function notifyUsers(supabase, userIds, payload) {
  await Promise.allSettled(userIds.map((id) => sendPushToUser(supabase, id, payload)));
}

async function notifyStockRequestSubmitted(supabase, { request, branchName, itemCount }) {
  const ownerIds = await findOwnerUserIds(supabase);
  await notifyUsers(supabase, ownerIds, {
    title: 'Permintaan Stok Baru',
    body: `${branchName} mengajukan ${itemCount} produk untuk direstock.`,
    url: `/admin/stockist/requests/${request.id}`,
  });
}

async function notifyStockRequestReviewed(supabase, { request }) {
  const isRejected = request.status === 'REJECTED';
  const isFull = request.status === 'APPROVED';
  await notifyUsers(supabase, [request.requested_by], {
    title: isRejected ? 'Permintaan Stok Ditolak' : 'Permintaan Stok Disetujui',
    body: isRejected
      ? `Permintaan ${request.request_number} ditolak: ${request.rejection_reason}`
      : `Permintaan ${request.request_number} ${isFull ? 'disetujui penuh' : 'disetujui sebagian'}.`,
    url: `/admin/stockist/requests/${request.id}`,
  });
}

async function notifyStockRequestFulfilled(supabase, { request }) {
  await notifyUsers(supabase, [request.requested_by], {
    title: 'Barang Sedang Dikirim',
    body: `Permintaan ${request.request_number} sedang dikirim dari Gudang Pusat.`,
    url: `/admin/stockist/transfers/${request.fulfilling_transfer_id}`,
  });
}

async function notifyTransferDiscrepancy(supabase, { transfer }) {
  const ownerIds = await findOwnerUserIds(supabase);
  await notifyUsers(supabase, ownerIds, {
    title: 'Selisih Penerimaan Barang',
    body: `Transfer ${transfer.transfer_number} diterima dengan selisih jumlah.`,
    url: `/admin/stockist/transfers/${transfer.id}`,
  });
}

async function notifyStockOpnameSubmitted(supabase, { opname, locationName, discrepancyCount }) {
  const ownerIds = await findOwnerUserIds(supabase);
  await notifyUsers(supabase, ownerIds, {
    title: 'Stock Opname Menunggu Persetujuan',
    body: discrepancyCount > 0
      ? `${locationName} — ${opname.opname_number} punya ${discrepancyCount} produk dengan selisih.`
      : `${locationName} — ${opname.opname_number} siap disetujui, tidak ada selisih.`,
    url: `/admin/stockist/stock-opname/${opname.id}`,
  });
}

async function notifyStockOpnameApproved(supabase, { opname }) {
  await notifyUsers(supabase, [opname.created_by], {
    title: 'Stock Opname Disetujui',
    body: `${opname.opname_number} telah disetujui dan stok telah disesuaikan.`,
    url: `/admin/stockist/stock-opname/${opname.id}`,
  });
}

async function notifyStockReturnSubmitted(supabase, { stockReturn, branchName, itemCount }) {
  const ownerIds = await findOwnerUserIds(supabase);
  await notifyUsers(supabase, ownerIds, {
    title: 'Retur Barang Baru',
    body: `${branchName} mengajukan retur ${itemCount} produk.`,
    url: `/admin/stockist/returns/${stockReturn.id}`,
  });
}

async function notifyStockReturnReviewed(supabase, { stockReturn }) {
  const isRejected = stockReturn.status === 'REJECTED';
  await notifyUsers(supabase, [stockReturn.requested_by], {
    title: isRejected ? 'Retur Ditolak' : 'Retur Disetujui',
    body: isRejected
      ? `Retur ${stockReturn.return_number} ditolak: ${stockReturn.rejection_reason}`
      : `Retur ${stockReturn.return_number} disetujui, siap dikirim ke gudang.`,
    url: `/admin/stockist/returns/${stockReturn.id}`,
  });
}

async function notifyStockReturnReceived(supabase, { stockReturn }) {
  await notifyUsers(supabase, [stockReturn.requested_by], {
    title: 'Retur Diterima Gudang',
    body: `Retur ${stockReturn.return_number} telah diterima dan diproses gudang.`,
    url: `/admin/stockist/returns/${stockReturn.id}`,
  });
}

// Called after any movement that can reduce a branch's balance. Decides
// whether this particular dip deserves a fresh push, using stock_alert_state
// as the anti-spam ledger: always notify on a NORMAL->LOW transition, and
// re-notify on a LOW->LOW transition only once the cooldown has elapsed.
async function checkAndNotifyLowStock(supabase, {
  productId, locationId, branchSlug, productName, newQuantity, minimumStock,
}) {
  const { data: stateRows } = await supabase.from('stock_alert_state').select('*').eq('product_id', productId).eq('location_id', locationId);
  const state = (stateRows || [])[0] || null;

  if (newQuantity > minimumStock) {
    if (state && state.last_status !== 'NORMAL') {
      await supabase.from('stock_alert_state').upsert({ product_id: productId, location_id: locationId, last_status: 'NORMAL', last_alerted_at: null });
    }
    return;
  }

  const wasNormal = !state || state.last_status === 'NORMAL';
  const cooldownElapsed = !state?.last_alerted_at || (Date.now() - new Date(state.last_alerted_at).getTime()) > LOW_STOCK_COOLDOWN_MS;
  if (!wasNormal && !cooldownElapsed) return;

  await supabase.from('stock_alert_state').upsert({
    product_id: productId, location_id: locationId, last_status: 'LOW', last_alerted_at: new Date().toISOString(),
  });

  const branchAdminIds = await findBranchAdminUserIds(supabase, branchSlug);
  await notifyUsers(supabase, branchAdminIds, {
    title: 'Stok Menipis',
    body: `${productName} tersisa ${newQuantity} — di bawah batas minimum ${minimumStock}.`,
    url: '/admin/stockist/branch-stock',
  });
}

module.exports = {
  notifyStockRequestSubmitted,
  notifyStockRequestReviewed,
  notifyStockRequestFulfilled,
  notifyTransferDiscrepancy,
  checkAndNotifyLowStock,
  notifyStockOpnameSubmitted,
  notifyStockOpnameApproved,
  notifyStockReturnSubmitted,
  notifyStockReturnReviewed,
  notifyStockReturnReceived,
};
