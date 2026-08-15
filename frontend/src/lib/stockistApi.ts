// frontend/src/lib/stockistApi.ts
export interface StockistProduct {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  purchase_price: number | null;
  retail_price: number | null;
  minimum_stock: number;
  reorder_point: number;
  is_active: boolean;
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

export const getInventorySummary = (location: string) =>
  req<{ balances: InventoryBalance[] }>(`/api/stockist/inventory/summary?location=${encodeURIComponent(location)}`);

export const receiveWarehouseStock = (input: { product_id: string; quantity: number; reason?: string }) =>
  req<{ ledger: unknown }>('/api/stockist/warehouse/receive', { method: 'POST', body: JSON.stringify(input) });

export const createTransfer = (input: { destination_branch: string; items: { product_id: string; quantity: number }[] }) =>
  req<{ transfer: StockTransfer }>('/api/stockist/transfers', { method: 'POST', body: JSON.stringify(input) });

export const listTransfers = () => req<{ transfers: StockTransfer[] }>('/api/stockist/transfers');

export const getTransfer = (id: string) =>
  req<{ transfer: StockTransfer; items: StockTransferItem[] }>(`/api/stockist/transfers/${id}`);

export const receiveTransfer = (id: string, items: { item_id: string; quantity_received: number }[]) =>
  req<{ transfer: StockTransfer; has_discrepancy: boolean }>(`/api/stockist/transfers/${id}/receive`, {
    method: 'PATCH', body: JSON.stringify({ items }),
  });
