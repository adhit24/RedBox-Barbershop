import { apiClient } from '../lib/apiClient';

export interface StockistSummary {
  total_stock: number;
  active_skus: number;
  low_stock_count: number;
  active_transfers_count: number;
}

export interface StockistAlertBanner {
  text: string;
  has_issues: boolean;
  branches_need_attention: number;
  active_transfers: number;
  critical_products: number;
}

export interface BranchStockHealth {
  id: string;
  name: string;
  slug: string;
  stock: number;
  low_stock_count: number;
  out_of_stock_count: number;
  status: 'healthy' | 'low' | 'out';
  status_text: string;
  capacity_pct: number;
}

export interface NeedsAttentionItem {
  id: number;
  product_id: string;
  name: string;
  sku: string;
  branch: string;
  stock: number;
  min: number;
  status: 'Out' | 'Low' | 'Restock';
  img: string;
}

export interface StockistTransferItem {
  id: string;
  transfer_number: string;
  from: string;
  to: string;
  status: 'Dikirim' | 'Menunggu Konfirmasi' | 'Diterima' | 'Discrepancy';
  raw_status: string;
  timestamp: string;
  qty: string;
  courier: string;
  has_discrepancy: boolean;
}

export interface DiscrepancyAuditItem {
  id: string;
  branch: string;
  date: string;
  summary: string;
  auditor: string;
  status_text: string;
  type: 'discrepancy' | 'adjustment' | 'match';
}

export interface StockistBackofficeData {
  summary: StockistSummary;
  alert_banner: StockistAlertBanner;
  branches: BranchStockHealth[];
  needs_attention: NeedsAttentionItem[];
  transfers: StockistTransferItem[];
  discrepancy_and_audit: DiscrepancyAuditItem[];
  live_sync_at: string;
  analytics_calc_at: string | null;
  role: string;
  authorized_branch: string | null;
}

export interface MovementChartPoint {
  date: string;
  raw_date: string;
  masuk: number;
  keluar: number;
  terima: number;
}

export interface StockistMovementChartData {
  points: MovementChartPoint[];
  calculated_at: string | null;
  days: number;
}

export function getStockistBackofficeDashboard(): Promise<StockistBackofficeData> {
  return apiClient.get<StockistBackofficeData>('/api/stockist/backoffice-dashboard');
}

export function getStockistMovementChart(params: { days?: number; branch?: string } = {}): Promise<StockistMovementChartData> {
  const query = new URLSearchParams();
  if (params.days) query.set('days', String(params.days));
  if (params.branch) query.set('branch', params.branch);
  const qStr = query.toString();
  return apiClient.get<StockistMovementChartData>(`/api/stockist/movement-chart${qStr ? `?${qStr}` : ''}`);
}
