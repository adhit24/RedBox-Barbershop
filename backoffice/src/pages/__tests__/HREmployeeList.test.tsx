import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HREmployeeList } from '../HREmployeeList';

const byBranch: Record<string, unknown> = {
  bypass: { barbers: [{ id: 'bypass-abdul-dul', name: 'Abdul', branch: 'bypass', attendance_status: null, today_count: 0 }] },
  csb: { barbers: [{ id: 'csb-ubay', name: 'Ubay', branch: 'csb', attendance_status: 'hadir', today_count: 3 }] },
  samadikun: { barbers: [{ id: 'samadikun-sofyan', name: 'Sofyan', branch: 'samadikun', attendance_status: null, today_count: 0 }] },
  sumber: { barbers: [{ id: 'sumber-bayu', name: 'Bayu', branch: 'sumber', attendance_status: null, today_count: 0 }] },
  tegal: { barbers: [{ id: 'tegal-ahmad', name: 'Ahmad', branch: 'tegal', attendance_status: null, today_count: 0 }] },
};

describe('HREmployeeList', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const branch = new URL(url, 'https://example.test').searchParams.get('branch') ?? '';
      return Promise.resolve(new Response(JSON.stringify(byBranch[branch]), { status: 200 }));
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders real barber roster from all five branch command-center sources', async () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    await waitFor(() => expect(screen.getByText('Abdul')).toBeInTheDocument());
    expect(screen.getByText('Ubay')).toBeInTheDocument();
    expect(screen.getByText('Sofyan')).toBeInTheDocument();
    expect(screen.getByText('Bayu')).toBeInTheDocument();
    expect(screen.getByText('Ahmad')).toBeInTheDocument();
    expect(screen.queryByText(/Ubay Santoso/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^DEMO/i)).not.toBeInTheDocument();
  });

  it('labels database barbers as Kapster and does not fabricate attendance', async () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    await screen.findByText('Abdul');
    expect(screen.getAllByText('Kapster').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Belum tersedia').length).toBeGreaterThan(0);
    expect(screen.getByText('Hadir')).toBeInTheDocument();
  });
});
