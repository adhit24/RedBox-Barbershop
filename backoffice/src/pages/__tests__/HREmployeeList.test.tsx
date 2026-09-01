import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HREmployeeList } from '../HREmployeeList';

describe('HREmployeeList', () => {
  it('shows the DEMO badge', () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the employee roster with names, positions, and branches', () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
    expect(screen.getByText('Senior Barber')).toBeInTheDocument();
  });

  it('links each employee row to Employee Detail', () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: /Ubay Santoso/i });
    expect(link.getAttribute('href')).toBe('/hr/employees/RB-0142');
  });
});
