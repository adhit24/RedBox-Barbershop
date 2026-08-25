// frontend/src/lib/stockistApi.ts
export interface StockistProduct {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  barcode: string | null;
  purchase_price?: number | null;
  retail_price: number | null;
  minimum_stock: number;
  reorder_point: number;
  is_active: boolean;
  product_type?: 'RETAIL' | 'SERVICE' | 'SERVICE_CONSUMABLE' | 'BOTH' | 'CONSUMABLE';
}

export interface ServiceUsage {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string | null;
  product_unit: string;
  branch: string | null;
  location_id: string;
  quantity: number;
  status: 'IN_USE' | 'FINISHED';
  pic_user_id: string | null;
  pic_name: string;
  opened_at: string;
  opened_by: string;
  finished_at: string | null;
  finished_by: string | null;
  notes: string | null;
}

export interface ServiceUsageItem extends StockistProduct {
  branch: string;
  location_id: string;
  available_quantity: number;
  in_use_quantity: number;
}

export interface InventoryBalance {
  product_id: string;
  location_id: string;
  quantity: number;
  updated_at: string;
}

export interface StockTransferItem {
  id: string;
  product_id: string;
  quantity_sent: number;
  quantity_received: number | null;
}

export interface StockTransfer {
  id: string;
  transfer_number: string;
  source_location_id: string;
  destination_location_id: string;
  status: 'SENT' | 'RECEIVED';
  sent_by: string;
  sent_at: string;
  received_by: string | null;
  received_at: string | null;
  source_name?: string;
  destination_name?: string;
}

export type StockRequestStatus =
  | 'SUBMITTED' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' | 'CANCELLED' | 'FULFILLED';

export interface StockRequestItem {
  id: string;
  product_id: string;
  quantity_requested: number;
  quantity_approved: number | null;
}

export interface StockRequest {
  id: string;
  request_number: string;
  branch_location_id: string;
  status: StockRequestStatus;
  requested_by: string;
  reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  fulfilling_transfer_id: string | null;
  created_at: string;
  branch_name?: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || `request failed: ${res.status}`);
  return body as T;
}

export const listProducts = () => req<{ products: StockistProduct[] }>('/api/stockist/products');

export const createProduct = (input: Partial<StockistProduct>) =>
  req<{ product: StockistProduct }>('/api/stockist/products', { method: 'POST', body: JSON.stringify(input) });

export const updateProduct = (id: string, input: Partial<StockistProduct>) =>
  req<{ product: StockistProduct }>(`/api/stockist/products/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deactivateProduct = (id: string) =>
  req<{ product: StockistProduct }>(`/api/stockist/products/${id}/deactivate`, { method: 'PATCH' });

export const activateProduct = (id: string) =>
  req<{ product: StockistProduct }>(`/api/stockist/products/${id}/activate`, { method: 'PATCH' });

export const getInventorySummary = (location: string) =>
  req<{ balances: InventoryBalance[] }>(`/api/stockist/inventory/summary?location=${encodeURIComponent(location)}`);

export const getServiceUsage = (branch?: string) =>
  req<{ items: ServiceUsageItem[]; usages: ServiceUsage[] }>(`/api/stockist/service-usage${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`);

export const getServiceUsagePicOptions = (branch?: string) =>
  req<{ people: Array<{ id: string; name: string; role: 'branch_admin' | 'barber'; branch: string }> }>(`/api/stockist/service-usage/pic-options${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`);

export const openServiceUsage = (input: { product_id: string; quantity?: number; pic_user_id?: string; notes?: string }) =>
  req<{ usage: ServiceUsage }>('/api/stockist/service-usage/open', { method: 'POST', body: JSON.stringify(input) });

export const finishServiceUsage = (id: string) =>
  req<{ usage: ServiceUsage }>(`/api/stockist/service-usage/${id}/finish`, { method: 'PATCH' });

export const receiveWarehouseStock = (input: { product_id: string; quantity: number; reason?: string }) =>
  req<{ ledger: unknown }>('/api/stockist/warehouse/receive', { method: 'POST', body: JSON.stringify(input) });

export const createTransfer = (input: { destination_branch: string; items: { product_id: string; quantity: number }[] }) =>
  req<{ transfer: StockTransfer }>('/api/stockist/transfers', { method: 'POST', body: JSON.stringify(input) });

export const listTransfers = () => req<{ transfers: StockTransfer[] }>('/api/stockist/transfers');

export const getTransfer = (id: string) =>
  req<{ transfer: StockTransfer; items: StockTransferItem[] }>(`/api/stockist/transfers/${id}`);

export const receiveTransfer = (id: string, items: { item_id: string; quantity_received: number; reason?: string; photo_url?: string }[]) =>
  req<{ transfer: StockTransfer; has_discrepancy: boolean }>(`/api/stockist/transfers/${id}/receive`, {
    method: 'PATCH', body: JSON.stringify({ items }),
  });

export const createStockRequest = (input: { items: { product_id: string; quantity_requested: number }[]; reason?: string }) =>
  req<{ request: StockRequest }>('/api/stockist/requests', { method: 'POST', body: JSON.stringify(input) });

export const listStockRequests = (status?: string) =>
  req<{ requests: StockRequest[] }>(`/api/stockist/requests${status ? `?status=${encodeURIComponent(status)}` : ''}`);

export const getStockRequest = (id: string) =>
  req<{ request: StockRequest; items: StockRequestItem[] }>(`/api/stockist/requests/${id}`);

export const approveStockRequest = (id: string, items: { item_id: string; quantity_approved: number }[]) =>
  req<{ request: StockRequest }>(`/api/stockist/requests/${id}/approve`, {
    method: 'PATCH', body: JSON.stringify({ items }),
  });

export const rejectStockRequest = (id: string, reason: string) =>
  req<{ request: StockRequest }>(`/api/stockist/requests/${id}/reject`, {
    method: 'PATCH', body: JSON.stringify({ reason }),
  });

export const cancelStockRequest = (id: string) =>
  req<{ request: StockRequest }>(`/api/stockist/requests/${id}/cancel`, { method: 'PATCH' });

export const fulfillStockRequest = (id: string) =>
  req<{ request: StockRequest; transfer: StockTransfer }>(`/api/stockist/requests/${id}/fulfill`, { method: 'POST' });

export type StockOpnameStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CANCELLED';

export interface StockOpnameItem {
  id: string;
  product_id: string;
  system_quantity: number;
  in_use_quantity?: number;
  total_accounted_quantity?: number;
  physical_quantity: number | null;
  difference: number | null;
  reason: string | null;
}

export interface StockOpname {
  id: string;
  opname_number: string;
  location_id: string;
  status: StockOpnameStatus;
  created_by: string;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  location_name?: string;
}

export const createStockOpname = (input: { location_type: 'warehouse' | 'branch'; location_branch?: string }) =>
  req<{ opname: StockOpname }>('/api/stockist/stock-opname', { method: 'POST', body: JSON.stringify(input) });

export const listStockOpnames = (status?: string) =>
  req<{ opnames: StockOpname[] }>(`/api/stockist/stock-opname${status ? `?status=${encodeURIComponent(status)}` : ''}`);

export const getStockOpname = (id: string) =>
  req<{ opname: StockOpname; items: StockOpnameItem[] }>(`/api/stockist/stock-opname/${id}`);

export const countStockOpname = (id: string, items: { item_id: string; physical_quantity: number; reason?: string }[]) =>
  req<{ items: StockOpnameItem[] }>(`/api/stockist/stock-opname/${id}/count`, { method: 'PATCH', body: JSON.stringify({ items }) });

export const submitStockOpname = (id: string) =>
  req<{ opname: StockOpname }>(`/api/stockist/stock-opname/${id}/submit`, { method: 'PATCH' });

export const approveStockOpname = (id: string) =>
  req<{ opname: StockOpname }>(`/api/stockist/stock-opname/${id}/approve`, { method: 'PATCH' });

export const cancelStockOpname = (id: string) =>
  req<{ opname: StockOpname }>(`/api/stockist/stock-opname/${id}/cancel`, { method: 'PATCH' });

export type ReturnCategory = 'RUSAK' | 'KEDALUWARSA' | 'SALAH_KIRIM' | 'KELEBIHAN' | 'LAINNYA';
export type StockReturnStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SHIPPED' | 'RECEIVED' | 'CANCELLED';

export interface StockReturnItem {
  id: string;
  product_id: string;
  quantity: number;
}

export interface StockReturn {
  id: string;
  return_number: string;
  branch_location_id: string;
  category: ReturnCategory;
  status: StockReturnStatus;
  reason: string | null;
  requested_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  shipped_at: string | null;
  received_at: string | null;
  created_at: string;
  branch_name?: string;
}

export const createStockReturn = (input: { category: ReturnCategory; reason?: string; items: { product_id: string; quantity: number }[] }) =>
  req<{ return: StockReturn }>('/api/stockist/returns', { method: 'POST', body: JSON.stringify(input) });

export const listStockReturns = (status?: string) =>
  req<{ returns: StockReturn[] }>(`/api/stockist/returns${status ? `?status=${encodeURIComponent(status)}` : ''}`);

export const getStockReturn = (id: string) =>
  req<{ return: StockReturn; items: StockReturnItem[] }>(`/api/stockist/returns/${id}`);

export const approveStockReturn = (id: string) =>
  req<{ return: StockReturn }>(`/api/stockist/returns/${id}/approve`, { method: 'PATCH' });

export const rejectStockReturn = (id: string, reason: string) =>
  req<{ return: StockReturn }>(`/api/stockist/returns/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) });

export const shipStockReturn = (id: string) =>
  req<{ return: StockReturn }>(`/api/stockist/returns/${id}/ship`, { method: 'PATCH' });

export const receiveStockReturn = (id: string) =>
  req<{ return: StockReturn }>(`/api/stockist/returns/${id}/receive`, { method: 'PATCH' });

export const cancelStockReturn = (id: string) =>
  req<{ return: StockReturn }>(`/api/stockist/returns/${id}/cancel`, { method: 'PATCH' });

export interface DashboardLocationSummary {
  location_id: string;
  type: 'warehouse' | 'branch';
  total_quantity: number;
  low_stock_count: number;
  sku_count: number;
  location_name: string;
}

export interface DashboardProblemShipment {
  id: string;
  transfer_number: string;
  source_name: string;
  destination_name: string;
  received_at: string;
}

export interface DashboardOpnameDiscrepancy {
  stock_opname_id: string;
  opname_number: string;
  location_name: string;
  product_name: string;
  difference: number;
}

export interface DashboardTopRequestedProduct {
  product_id: string;
  product_name: string;
  total_requested: number;
}

export interface DashboardOverview {
  locations: DashboardLocationSummary[];
  pending_requests_count: number;
  problem_shipments: DashboardProblemShipment[];
  top_discrepancies: DashboardOpnameDiscrepancy[];
  top_requested_products: DashboardTopRequestedProduct[];
}

export const getDashboardOverview = () =>
  req<DashboardOverview>('/api/stockist/dashboard/overview');

export interface AssetLocationSummary {
  location_id: string;
  location_name: string;
  type: 'warehouse' | 'branch';
  total_quantity: number;
  total_asset_value: number | null;
  sku_count: number;
  low_stock_count: number;
}

export interface StockistAssetDashboard {
  total_asset_value: number | null;
  warehouse_asset_value: number | null;
  branch_asset_value: number | null;
  asset_by_location: AssetLocationSummary[];
  attention_items: Array<{
    product_id: string;
    product_name: string;
    product_sku: string;
    location_id: string;
    location_name: string;
    quantity: number;
    reorder_point: number;
    reason: 'OUT_OF_STOCK' | 'LOW_STOCK';
  }>;
  active_transfers: StockTransfer[];
  role: 'owner' | 'branch_admin';
  breakdown: { warehouse: number | null; branches: number | null };
}

export const getAssetDashboard = () =>
  req<StockistAssetDashboard>('/api/stockist/dashboard/assets');

export interface InventoryLedgerEntry {
  id: string;
  product_id: string;
  location_id: string;
  movement_type: string;
  quantity_delta: number;
  quantity_before?: number;
  quantity_after?: number;
  reference_type?: string | null;
  reference_id?: string | null;
  performed_by?: string;
  reason?: string | null;
  created_at: string;
}

export const getInventoryLedger = () =>
  req<{ ledger: InventoryLedgerEntry[] }>('/api/stockist/inventory/ledger');

export interface StockistNotification {
  id: string;
  user_id: string;
  category: 'Stok' | 'Transfer' | 'Pengiriman' | 'Sistem' | 'Pengumuman';
  title: string;
  body: string;
  url: string | null;
  is_read: boolean;
  created_at: string;
}

export const listNotifications = (category?: string) =>
  req<{ notifications: StockistNotification[] }>(`/api/stockist/notifications${category ? `?category=${encodeURIComponent(category)}` : ''}`);

export const markNotificationRead = (id: string) =>
  req<{ notification: StockistNotification }>(`/api/stockist/notifications/${id}/read`, { method: 'PATCH' });

export const markAllNotificationsRead = () =>
  req<{ updated: number }>('/api/stockist/notifications/read-all', { method: 'POST' });
