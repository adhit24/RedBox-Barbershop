import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../Sidebar';

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    currentUser: { label: 'Backoffice Admin' },
    logout: vi.fn(),
  }),
}));

function renderSidebar(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>
  );
}

describe('Sidebar two-level navigation', () => {
  it('selects People from a nested payroll route and exposes real payroll child routes', () => {
    renderSidebar('/payroll/barber');

    expect(screen.getByRole('button', { name: 'People' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Payroll' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Payroll Kapster' })).toHaveAttribute('href', '/payroll/barber');
    expect(screen.getByRole('link', { name: 'Payroll Karyawan' })).toHaveAttribute('href', '/payroll/regular');
  });

  it('switches the detail panel when a rail category is selected', () => {
    renderSidebar('/');

    fireEvent.click(screen.getByRole('button', { name: 'Customer' }));

    expect(screen.getByRole('button', { name: 'Customer' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CRM & Customer' })).toHaveAttribute('href', '/crm');
    expect(screen.getByRole('link', { name: 'Membership' })).toHaveAttribute('href', '/reports/membership');
  });

  it('collapses and expands the detail panel while keeping the icon rail available', () => {
    renderSidebar('/attendance');

    fireEvent.click(screen.getByRole('button', { name: 'Tutup panel navigasi' }));

    expect(screen.getByRole('button', { name: 'Buka panel navigasi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'People' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Buka panel navigasi' }));
    expect(screen.getByRole('button', { name: 'Tutup panel navigasi' })).toBeInTheDocument();
  });

  it('filters visible menu items with the sidebar search field', () => {
    renderSidebar('/reports');

    fireEvent.change(screen.getByPlaceholderText('Cari menu...'), { target: { value: 'barber' } });

    expect(screen.getByRole('link', { name: 'Performa Kapster' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Performa Cabang' })).not.toBeInTheDocument();
  });

  it('keeps canonical command center and membership routes', () => {
    renderSidebar('/');

    expect(screen.getByRole('link', { name: 'Command Center' })).toHaveAttribute('href', '/');
    fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
    expect(screen.getByRole('link', { name: 'Membership' })).toHaveAttribute('href', '/reports/membership');
  });
});
