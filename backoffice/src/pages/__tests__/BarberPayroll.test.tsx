import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BarberPayroll } from '../BarberPayroll';

describe('BarberPayroll', () => {
  it('shows the DEMO badge', () => {
    render(<BarberPayroll />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the barber payroll roster with estimated pay', () => {
    render(<BarberPayroll />, { wrapper: MemoryRouter });
    expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
    expect(screen.getByText('Rp 5.640.000')).toBeInTheDocument();
  });
});
