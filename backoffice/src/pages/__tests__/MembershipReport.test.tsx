import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MembershipReport } from '../MembershipReport';

const MEMBERS = [
  { user_key: 'u1', full_name: 'Budi', email: 'budi@x.com', membership_status: 'ACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'gold', total_points: 100, total_visits: 5, created_at: new Date().toISOString(), phone: '+6281', last_visit: null },
  { user_key: 'u2', full_name: 'Sari', email: 'sari@x.com', membership_status: 'INACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'bronze', total_points: 0, total_visits: 1, created_at: '2025-01-01T00:00:00.000Z', phone: '+6282', last_visit: null },
];

describe('MembershipReport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Active Members computed from the real membership list', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(MEMBERS), { status: 200 }));
    render(<MembershipReport />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Active Members')).toBeInTheDocument();
    });
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('renders tier distribution from the real membership list', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(MEMBERS), { status: 200 }));
    render(<MembershipReport />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('gold')).toBeInTheDocument();
    });
    expect(screen.getByText('bronze')).toBeInTheDocument();
  });

  it('shows Points Issued/Redeemed and Membership by Branch as UNAVAILABLE', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(MEMBERS), { status: 200 }));
    render(<MembershipReport />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getAllByText(/UNAVAILABLE/i).length).toBeGreaterThan(0);
    });
  });
});
