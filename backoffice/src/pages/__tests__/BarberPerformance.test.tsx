import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BarberPerformance } from '../BarberPerformance';

const RESULT = {
  barbers: [
    { barber_id: 'b1', name: 'Ubay Santoso', branch: 'samadikun', customers_served: 612, completed_services: 584, repeat_rate: 58 },
    { barber_id: 'b2', name: 'Dodi Iskandar', branch: 'csb', customers_served: 540, completed_services: 512, repeat_rate: 52 },
  ],
};

describe('BarberPerformance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the leaderboard with real customers-served and repeat-rate figures', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<BarberPerformance />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
    });
    expect(screen.getByText('612')).toBeInTheDocument();
    expect(screen.getByText('58%')).toBeInTheDocument();
  });

  it('never renders a commission or attendance figure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    render(<BarberPerformance />, { wrapper: MemoryRouter });
    await waitFor(() => {
      expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
    });
    expect(screen.queryByText(/komisi/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/attendance/i)).not.toBeInTheDocument();
  });
});
