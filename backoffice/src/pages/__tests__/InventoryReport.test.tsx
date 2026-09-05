import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InventoryReport } from '../InventoryReport';

describe('InventoryReport', () => {
  it('shows an honest UNAVAILABLE state, not fabricated inventory numbers', () => {
    render(<InventoryReport />, { wrapper: MemoryRouter });
    expect(screen.getByText(/UNAVAILABLE/i)).toBeInTheDocument();
  });

  it('links to the real Stockist application', () => {
    render(<InventoryReport />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: /Open Stockist Application/i });
    expect(link.getAttribute('href')).toBe('https://stockist.redboxbarbershop.com');
  });

  it('links back to Reports', () => {
    render(<InventoryReport />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: /Reports/i });
    expect(link.getAttribute('href')).toBe('/reports');
  });
});
