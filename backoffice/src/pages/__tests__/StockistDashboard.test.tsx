import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockistDashboard } from '../StockistDashboard';

describe('StockistDashboard', () => {
  it('shows an honest UNAVAILABLE state, not fabricated inventory numbers', () => {
    render(<StockistDashboard />);
    expect(screen.getByText(/UNAVAILABLE/i)).toBeInTheDocument();
  });

  it('links to the real Stockist application', () => {
    render(<StockistDashboard />);
    const link = screen.getByRole('link', { name: /Open Stockist Application/i });
    expect(link.getAttribute('href')).toBe('https://stockist.redboxbarbershop.com');
  });
});
