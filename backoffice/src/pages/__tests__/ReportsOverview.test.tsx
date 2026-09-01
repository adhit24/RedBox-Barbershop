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
});
