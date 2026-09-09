import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StockistDashboard } from '../StockistDashboard';
import * as stockistService from '../../services/stockist';

vi.mock('../../services/stockist', () => ({
  getStockistBackofficeDashboard: vi.fn(),
  getStockistMovementChart: vi.fn(),
}));

const mockDashboardData: stockistService.StockistBackofficeData = {
  summary: {
    total_stock: 2980,
    active_skus: 109,
    low_stock_count: 5,
    active_transfers_count: 2,
  },
  alert_banner: {
    text: 'Perhatian: Ada 5 produk stok menipis dan 1 cabang memerlukan restock.',
    has_issues: true,
    branches_need_attention: 1,
    active_transfers: 2,
    critical_products: 5,
  },
  branches: [
    { id: 'loc-bypass', name: 'Bypass', slug: 'bypass', stock: 680, low_stock_count: 2, out_of_stock_count: 0, status: 'low', status_text: '2 Low Stock', capacity_pct: 72 },
    { id: 'loc-samadikun', name: 'Samadikun', slug: 'samadikun', stock: 740, low_stock_count: 0, out_of_stock_count: 0, status: 'healthy', status_text: 'Sehat', capacity_pct: 88 },
    { id: 'loc-csb', name: 'CSB Mall', slug: 'csb', stock: 520, low_stock_count: 1, out_of_stock_count: 0, status: 'low', status_text: '1 Low Stock', capacity_pct: 64 },
    { id: 'loc-sumber', name: 'Sumber', slug: 'sumber', stock: 590, low_stock_count: 0, out_of_stock_count: 0, status: 'healthy', status_text: 'Sehat', capacity_pct: 82 },
    { id: 'loc-tegal', name: 'Tegal', slug: 'tegal', stock: 450, low_stock_count: 2, out_of_stock_count: 1, status: 'out', status_text: '1 Habis', capacity_pct: 45 },
  ],
  needs_attention: [
    {
      id: 1,
      product_id: 'prod-1',
      name: 'Pomade Waterbased Extreme',
      sku: 'POM-001',
      branch: 'Tegal',
      stock: 0,
      min: 5,
      status: 'Out',
      img: '',
    },
    {
      id: 2,
      product_id: 'prod-2',
      name: 'Beard Oil Original',
      sku: 'OIL-002',
      branch: 'Bypass',
      stock: 2,
      min: 8,
      status: 'Low',
      img: '',
    },
  ],
  transfers: [
    {
      id: 'trf-1',
      transfer_number: 'TRF-LIVE-001',
      from: 'Warehouse Utama',
      to: 'Cabang Bypass',
      status: 'Dikirim',
      raw_status: 'in_transit',
      timestamp: '09 Sep 10:00 WIB',
      qty: '24 pcs',
      courier: 'Internal Driver',
      has_discrepancy: false,
    },
    {
      id: 'trf-2',
      transfer_number: 'TRF-LIVE-002',
      from: 'Warehouse Utama',
      to: 'Cabang Tegal',
      status: 'Menunggu Konfirmasi',
      raw_status: 'pending_receipt',
      timestamp: '09 Sep 08:30 WIB',
      qty: '15 pcs',
      courier: 'Vendor Express',
      has_discrepancy: false,
    },
  ],
  discrepancy_and_audit: [
    {
      id: 'AUD-0926',
      branch: 'Bypass',
      date: '09 Sep 2026',
      summary: 'Selisih 2 pcs pada Shaving Cream',
      auditor: 'Budi (Manager)',
      status_text: 'Investigasi',
      type: 'discrepancy',
    },
  ],
  live_sync_at: '06:20 WIB',
  analytics_calc_at: '10 Sep 2026 00:15 WIB',
  role: 'owner',
  authorized_branch: null,
};

const mockChartData: stockistService.StockistMovementChartData = {
  points: [
    { date: '04 Sep', raw_date: '2026-09-04', masuk: 120, keluar: 45, terima: 40 },
    { date: '05 Sep', raw_date: '2026-09-05', masuk: 80, keluar: 60, terima: 55 },
    { date: '06 Sep', raw_date: '2026-09-06', masuk: 0, keluar: 30, terima: 30 },
  ],
  days: 7,
  calculated_at: '10 Sep 2026 00:15 WIB',
};

describe('StockistDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially without hardcoded mock numbers', () => {
    vi.mocked(stockistService.getStockistBackofficeDashboard).mockReturnValue(new Promise(() => {}));
    vi.mocked(stockistService.getStockistMovementChart).mockReturnValue(new Promise(() => {}));

    render(<StockistDashboard />);
    expect(screen.getByRole('heading', { level: 1, name: /Stockist & Inventory/i })).toBeInTheDocument();
    // Verify hardcoded mock numbers are NOT in the document
    expect(screen.queryByText('2.846')).not.toBeInTheDocument();
    expect(screen.queryByText('TRF-24091')).not.toBeInTheDocument();
  });

  it('renders live KPI values, branch health, and live sync timestamp when data loads', async () => {
    vi.mocked(stockistService.getStockistBackofficeDashboard).mockResolvedValue(mockDashboardData);
    vi.mocked(stockistService.getStockistMovementChart).mockResolvedValue(mockChartData);

    render(<StockistDashboard />);

    // Verify header and live sync timestamps
    await waitFor(() => {
      expect(screen.getByText(/Inventory live •/i)).toBeInTheDocument();
      expect(screen.getByText(/06:20 WIB/i)).toBeInTheDocument();
      expect(screen.getByText(/Calc: 10 Sep 2026 00:15 WIB/i)).toBeInTheDocument();
    });

    // Verify computed KPI values
    expect(screen.getByText('2.980')).toBeInTheDocument();
    expect(screen.getByText('109')).toBeInTheDocument();
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);

    // Verify branches and computed health
    expect(screen.getAllByText('Bypass').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2 Low Stock')).toBeInTheDocument();
    expect(screen.getByText('Samadikun')).toBeInTheDocument();
    expect(screen.getAllByText('Sehat').length).toBe(2);
    expect(screen.getAllByText('Tegal').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1 Habis')).toBeInTheDocument();

    // Verify needs attention items
    expect(screen.getByText('Pomade Waterbased Extreme')).toBeInTheDocument();
    expect(screen.getByText('Beard Oil Original')).toBeInTheDocument();

    // Verify real transfers
    expect(screen.getByText('TRF-LIVE-001')).toBeInTheDocument();
    expect(screen.getByText('TRF-LIVE-002')).toBeInTheDocument();

    // Verify discrepancy & audit
    expect(screen.getByText('Audit #AUD-0926')).toBeInTheDocument();
    expect(screen.getByText('Selisih 2 pcs pada Shaving Cream')).toBeInTheDocument();
  });

  it('links to the external Stockist application with primary CTA', async () => {
    vi.mocked(stockistService.getStockistBackofficeDashboard).mockResolvedValue(mockDashboardData);
    vi.mocked(stockistService.getStockistMovementChart).mockResolvedValue(mockChartData);

    render(<StockistDashboard />);
    const link = screen.getByRole('link', { name: /Open Stockist Application/i });
    expect(link.getAttribute('href')).toBe('https://stockist.redboxbarbershop.com');
  });

  it('renders honest failure state if inventory backend cannot be loaded, without mock numbers', async () => {
    vi.mocked(stockistService.getStockistBackofficeDashboard).mockRejectedValue(new Error('Network failure'));
    vi.mocked(stockistService.getStockistMovementChart).mockRejectedValue(new Error('Network failure'));

    render(<StockistDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Data inventory belum dapat dimuat.')).toBeInTheDocument();
    });

    // Ensure Open Stockist Application button is still available
    const openBtn = screen.getByRole('link', { name: /Open Stockist Application/i });
    expect(openBtn).toBeInTheDocument();
    expect(openBtn.getAttribute('href')).toBe('https://stockist.redboxbarbershop.com');

    // Ensure mock data does NOT leak into failure state
    expect(screen.queryByText('2.846')).not.toBeInTheDocument();
    expect(screen.queryByText('TRF-24091')).not.toBeInTheDocument();
    expect(screen.queryByText('Pomade Classic')).not.toBeInTheDocument();
  });

  it('renders fallback when historical movement chart has no data or fails', async () => {
    vi.mocked(stockistService.getStockistBackofficeDashboard).mockResolvedValue(mockDashboardData);
    vi.mocked(stockistService.getStockistMovementChart).mockResolvedValue({ points: [], days: 7, calculated_at: null });

    render(<StockistDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Data pergerakan inventory belum tersedia.')).toBeInTheDocument();
    });
  });

  it('re-fetches chart data when time range selector changes', async () => {
    vi.mocked(stockistService.getStockistBackofficeDashboard).mockResolvedValue(mockDashboardData);
    vi.mocked(stockistService.getStockistMovementChart).mockResolvedValue(mockChartData);

    render(<StockistDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Pergerakan Inventory')).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '30' } });

    expect(stockistService.getStockistMovementChart).toHaveBeenCalledWith({ days: 30 });
  });
});
