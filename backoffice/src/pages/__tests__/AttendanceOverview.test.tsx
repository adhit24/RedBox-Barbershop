import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AttendanceOverview } from '../AttendanceOverview';

describe('AttendanceOverview', () => {
  it('shows the DEMO badge', () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the attendance roster with check-in/out and status', () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });
    expect(screen.getByText('Dodi Iskandar')).toBeInTheDocument();
    expect(screen.getByText('Missing Check-out')).toBeInTheDocument();
  });

  it('links Exception Belum Selesai to Exception Review', () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: /Exception Belum Selesai/i });
    expect(link.getAttribute('href')).toBe('/attendance/exceptions');
  });
});
