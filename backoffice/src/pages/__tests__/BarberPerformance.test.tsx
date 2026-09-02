import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BarberPerformance } from '../BarberPerformance';

const RESULT = {
  barbers: [
    { barber_id: 'b1', name: 'Zaki', branch: 'tegal', customers_served: 20, completed_services: 25, repeat_rate: 18 },
    { barber_id: 'b2', name: 'Ubay', branch: 'csb', customers_served: 79, completed_services: 100, repeat_rate: 22 },
    { barber_id: 'b3', name: 'Aziz', branch: 'csb', customers_served: 20, completed_services: 22, repeat_rate: 10 },
    { barber_id: 'b4', name: 'Abdul', branch: 'bypass', customers_served: 30, completed_services: 33, repeat_rate: 10 },
  ],
};

describe('BarberPerformance', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('renders only Barber, Cabang, Customer, and Repeat columns', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<BarberPerformance />, { wrapper: MemoryRouter });
    await screen.findByText('Ubay');
    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.getByText('Repeat')).toBeInTheDocument();
    expect(screen.queryByText(/Layanan Selesai/i)).not.toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('sorts rows by branch order, then barber name alphabetically', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<BarberPerformance />, { wrapper: MemoryRouter });
    await waitFor(() => expect(screen.getByText('Abdul')).toBeInTheDocument());
    const names = screen.getAllByTestId('barber-name').map((el) => el.textContent);
    expect(names).toEqual(['Abdul', 'Aziz', 'Ubay', 'Zaki']);
  });
});
