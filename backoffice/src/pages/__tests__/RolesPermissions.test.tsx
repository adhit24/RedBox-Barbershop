import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RolesPermissions } from '../RolesPermissions';

describe('RolesPermissions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/crm/role-counts')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              roles: {
                owner: 2,
                branch_admin: 5,
                manager: 0,
                hr: 0,
              },
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does NOT render DemoBadge or fake (contoh) counts', async () => {
    render(<RolesPermissions />);

    await waitFor(() => {
      expect(screen.getByText('Owner / Super Admin')).toBeInTheDocument();
    });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO "(contoh)" text
    expect(screen.queryByText(/contoh/i)).toBeNull();
  });

  it('renders real dynamic role counts from API and marks unconfigured roles as Belum aktif', async () => {
    render(<RolesPermissions />);

    await waitFor(() => {
      expect(screen.getByText('2 akun aktif')).toBeInTheDocument();
      expect(screen.getByText('5 akun aktif')).toBeInTheDocument();
    });

    // Manager and HR have 0 accounts in DB, displayed as 'Belum aktif'
    const inactiveBadges = screen.getAllByText('Belum aktif');
    expect(inactiveBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('handles authorization error (403) gracefully by failing closed', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'Forbidden: Owner role required' }), {
          status: 403,
        })
      )
    ));

    render(<RolesPermissions />);

    await waitFor(() => {
      expect(
        screen.getByText(/Hanya akun dengan peran Owner yang memiliki otorisasi/i)
      ).toBeInTheDocument();
    });
  });
});
