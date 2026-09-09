import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HREmployeeList } from '../HREmployeeList';

const responses = {
  all: {
    source: 'database', filter: 'all',
    kpis: { active_barbers: 28, regular_employees: 39, barber_branches: 5, active_business_units: 2 },
    people: [
      { id: 'barber:bypass-abdul', source: 'barbers', source_record_id: 'bypass-abdul', name: 'Abdul', nickname: null, business_unit: 'Redbox', position: 'Kapster', branch: 'bypass', branch_name: 'bypass', employment_type: 'commission-based', payroll_type: null, attendance_status: null, is_active: true },
      { id: 'employee:1', source: 'employees', source_record_id: '1', name: 'Ayu Redbox', nickname: 'Ayu', business_unit: 'Redbox', position: 'Admin', branch: 'bypass', branch_name: 'Bypass', employment_type: 'regular', payroll_type: 'salary', attendance_status: null, is_active: true },
      { id: 'employee:2', source: 'employees', source_record_id: '2', name: 'Sari Sundaze', nickname: 'Sari', business_unit: 'Sundaze', position: 'Barista', branch: 'bypass', branch_name: 'Bypass', employment_type: 'regular', payroll_type: 'salary', attendance_status: null, is_active: true },
    ],
    attendance: { available: false, label: 'Belum tersedia' },
  },
  redbox: null,
  sundaze: null,
} as const;

describe('HREmployeeList', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const filter = new URL(String(input), 'https://example.test').searchParams.get('filter') as 'all' | 'redbox' | 'sundaze';
      const base = responses.all;
      if (filter === 'sundaze') return Promise.resolve(new Response(JSON.stringify({ ...base, filter, kpis: { active_barbers: 0, regular_employees: 23, barber_branches: 0, active_business_units: 1 }, people: [base.people[2]] }), { status: 200 }));
      if (filter === 'redbox') return Promise.resolve(new Response(JSON.stringify({ ...base, filter, kpis: { active_barbers: 28, regular_employees: 16, barber_branches: 5, active_business_units: 1 }, people: base.people.slice(0, 2) }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify(base), { status: 200 }));
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders database-driven HR KPIs and the unified barber plus employee directory', async () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    await screen.findByText('Abdul');
    expect(screen.getByText('Ayu Redbox')).toBeInTheDocument();
    expect(screen.getByText('Sari Sundaze')).toBeInTheDocument();
    for (const [label, value] of [['Kapster Aktif', '28'], ['Karyawan Reguler', '39'], ['Cabang dengan Kapster', '5'], ['Unit Bisnis Live', '2']]) {
      const card = screen.getByText(label).closest<HTMLElement>('.rounded-rb-card');
      expect(card && within(card).getByText(value)).toBeInTheDocument();
    }
  });

  it('recalculates counts and directory for Sundaze without inventing barber rows', async () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    await screen.findByText('Abdul');
    fireEvent.click(screen.getByRole('button', { name: 'Sundaze' }));
    await waitFor(() => expect(screen.queryByText('Abdul')).not.toBeInTheDocument());
    expect(screen.getByText('Sari Sundaze')).toBeInTheDocument();
    expect(screen.queryByTestId('barber-reconciliation-note')).not.toBeInTheDocument();
    const barberCard = screen.getByText('Kapster Aktif').closest<HTMLElement>('.rounded-rb-card');
    expect(barberCard && within(barberCard).getByText('0')).toBeInTheDocument();
  });

  it('keeps attendance unavailable and discloses the unresolved reconciliation note without comparing against 27', async () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    await screen.findByText('Abdul');
    expect(screen.getAllByText('Belum tersedia')).toHaveLength(3);
    const note = screen.getByTestId('barber-reconciliation-note');
    expect(note).toHaveTextContent('Database mencatat 28 kapster aktif. Beberapa record ID/cabang masih menunggu rekonsiliasi owner dan tidak diubah dalam PR ini.');
    expect(note).not.toHaveTextContent('27');
    expect(note).not.toHaveTextContent('satu record');
    expect(screen.queryByText(/^DEMO/i)).not.toBeInTheDocument();
  });
});
