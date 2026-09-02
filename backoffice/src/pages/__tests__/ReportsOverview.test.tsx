import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportsOverview } from '../ReportsOverview';

describe('ReportsOverview', () => {
  it('renders links to Branch Performance, Barber Performance, Customer Report, and Membership Report', () => {
    render(<ReportsOverview />, { wrapper: MemoryRouter });
    expect(screen.getByRole('link', { name: /Branch Performance/i }).getAttribute('href')).toBe('/reports/branches');
    expect(screen.getByRole('link', { name: /Barber Performance/i }).getAttribute('href')).toBe('/reports/barbers');
    expect(screen.getByRole('link', { name: /Customer Report/i }).getAttribute('href')).toBe('/reports/customers');
    expect(screen.getByRole('link', { name: /Membership Report/i }).getAttribute('href')).toBe('/reports/membership');
  });

  it('renders links to the 3 newly added reports: Booking Performance, Attendance Report, Inventory Report', () => {
    render(<ReportsOverview />, { wrapper: MemoryRouter });
    expect(screen.getByRole('link', { name: /Booking Performance/i }).getAttribute('href')).toBe('/reports/bookings');
    expect(screen.getByRole('link', { name: /Attendance Report/i }).getAttribute('href')).toBe('/reports/attendance');
    expect(screen.getByRole('link', { name: /Inventory Report/i }).getAttribute('href')).toBe('/reports/inventory');
  });

  it('renders exactly 7 report cards', () => {
    render(<ReportsOverview />, { wrapper: MemoryRouter });
    expect(screen.getAllByRole('link').length).toBe(7);
  });

  it('no longer mentions "layanan selesai" on Barber Performance, since that column was removed from the report itself', () => {
    render(<ReportsOverview />, { wrapper: MemoryRouter });
    expect(screen.queryByText(/layanan selesai/i)).not.toBeInTheDocument();
  });

  it('renders a proper SVG icon on every card tile, not the title\'s first letter', () => {
    render(<ReportsOverview />, { wrapper: MemoryRouter });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(7);
    for (const link of links) {
      expect(link.querySelector('svg')).toBeTruthy();
    }
    // First-letter fallback text (e.g. a bare "B" or "C" tile) must be gone.
    expect(screen.queryByText('B', { selector: 'div' })).not.toBeInTheDocument();
    expect(screen.queryByText('C', { selector: 'div' })).not.toBeInTheDocument();
    expect(screen.queryByText('M', { selector: 'div' })).not.toBeInTheDocument();
    expect(screen.queryByText('I', { selector: 'div' })).not.toBeInTheDocument();
  });
});
