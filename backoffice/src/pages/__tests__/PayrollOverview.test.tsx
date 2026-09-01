import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PayrollOverview } from '../PayrollOverview';

describe('PayrollOverview', () => {
  it('shows the DEMO badge', () => {
    render(<PayrollOverview />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('links to Regular Payroll and Barber Payroll', () => {
    render(<PayrollOverview />, { wrapper: MemoryRouter });
    expect(screen.getAllByRole('link', { name: /Regular Payroll/i })[0].getAttribute('href')).toBe('/payroll/regular');
    expect(screen.getAllByRole('link', { name: /Barber Payroll/i })[0].getAttribute('href')).toBe('/payroll/barber');
  });
});
