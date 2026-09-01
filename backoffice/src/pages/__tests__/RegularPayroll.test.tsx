import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegularPayroll } from '../RegularPayroll';

describe('RegularPayroll', () => {
  it('shows the DEMO badge', () => {
    render(<RegularPayroll />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the payroll roster with net salary and status', () => {
    render(<RegularPayroll />, { wrapper: MemoryRouter });
    expect(screen.getByText('Nadia Kusuma')).toBeInTheDocument();
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
  });
});
