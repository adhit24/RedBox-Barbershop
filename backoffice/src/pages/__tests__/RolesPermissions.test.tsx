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

  it('proves UI uses "akun terdaftar" and never claims "akun aktif" without authoritative active field', async () => {
    render(<RolesPermissions />);

    await waitFor(() => {
      expect(screen.getByText('2 akun terdaftar')).toBeInTheDocument();
      expect(screen.getByText('5 akun terdaftar')).toBeInTheDocument();
    });

    // Verify UI NEVER says 'akun aktif'
    expect(screen.queryByText(/akun aktif/i)).toBeNull();

    // Subtitle uses semantically accurate wording
    expect(
      screen.getByText(/Ringkasan akun berdasarkan role yang tercatat di sistem/i)
    ).toBeInTheDocument();

    // Manager and HR have 0 accounts in DB, displayed as 'Belum aktif'
    const inactiveBadges = screen.getAllByText('Belum aktif');
    expect(inactiveBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('clearly identifies permission matrix as Design Spec and not live backend authorization', async () => {
    render(<RolesPermissions />);

    await waitFor(() => {
      expect(screen.getByText('Rancangan Matriks Akses')).toBeInTheDocument();
    });

    // Visibly contains Design Spec badge
    expect(
      screen.getByText('Design Spec — bukan konfigurasi authorization live')
    ).toBeInTheDocument();

    // Explicitly states matrix is not live backend authorization
    expect(
      screen.getByText(
        /Matriks berikut adalah rancangan target akses modul\. Otorisasi aktual tetap ditentukan oleh middleware\/server-side policy/i
      )
    ).toBeInTheDocument();
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
