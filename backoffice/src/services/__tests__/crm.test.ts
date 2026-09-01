import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getOwnerOverview, getOwnerRevenue, getMembership, getCommandCenterForBranch,
  getCustomer360, getCustomerSegments,
} from '../crm';

describe('crm service', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getOwnerOverview calls GET /api/admin/crm/owner-overview with no params', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ today: '2026-09-01', branches: [], totals: {} }), { status: 200 })
    );

    await getOwnerOverview();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/owner-overview');
  });

  it('getOwnerRevenue defaults to branch=all and period=month when no params given', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ summary: {}, daily_trend: [], branch_compare: [], top_barbers: [], top_services: [] }), { status: 200 })
    );

    await getOwnerRevenue({});

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/owner-revenue?branch=all&period=month');
  });

  it('getOwnerRevenue passes through an explicit branch and period', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ summary: {}, daily_trend: [], branch_compare: [], top_barbers: [], top_services: [] }), { status: 200 })
    );

    await getOwnerRevenue({ branch: 'csb', period: 'today' });

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/owner-revenue?branch=csb&period=today');
  });

  it('getMembership calls GET /api/admin/crm/membership and returns the array', async () => {
    const members = [{ user_key: 'a', membership_status: 'ACTIVE' }];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(members), { status: 200 })
    );

    const result = await getMembership();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/membership');
    expect(result).toEqual(members);
  });

  it('getCommandCenterForBranch calls GET /api/admin/crm/command-center?branch=<slug>', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ today: '2026-09-01', barbers: [], stats: {}, home_service: [], booking_feed: [], moka_open_bills: [], alerts: [] }), { status: 200 })
    );

    await getCommandCenterForBranch('csb');

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/command-center?branch=csb');
  });

  it('getCustomer360 calls GET with the given customer_id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ identity: { customer_found: false } }), { status: 200 })
    );
    await getCustomer360({ customer_id: 'c1' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/customer360?customer_id=c1');
  });

  it('getCustomer360 calls GET with the given phone', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ identity: { customer_found: false } }), { status: 200 })
    );
    await getCustomer360({ phone: '6281' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/customer360?phone=6281');
  });

  it('getCustomerSegments defaults to branch=all with no other params', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ customers: { items: [], total: 0, limit: 50, offset: 0 } }), { status: 200 })
    );
    await getCustomerSegments({});
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/customer-segments?branch=all');
  });

  it('getCustomerSegments passes through branch, limit, offset, and search', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ customers: { items: [], total: 0, limit: 10, offset: 5 } }), { status: 200 })
    );
    await getCustomerSegments({ branch: 'csb', limit: 10, offset: 5, search: 'budi' });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/customer-segments?branch=csb&limit=10&offset=5&search=budi');
  });
});
