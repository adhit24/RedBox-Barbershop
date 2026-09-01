import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PayrollEmployeeDetail } from '../PayrollEmployeeDetail';

describe('PayrollEmployeeDetail', () => {
  it('shows the DEMO badge', () => {
    render(
      <MemoryRouter initialEntries={['/payroll/employees/RB-0098']}>
        <Routes><Route path="/payroll/employees/:id" element={<PayrollEmployeeDetail />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the demo pay breakdown and final pay', () => {
    render(
      <MemoryRouter initialEntries={['/payroll/employees/RB-0098']}>
        <Routes><Route path="/payroll/employees/:id" element={<PayrollEmployeeDetail />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Service Commission')).toBeInTheDocument();
    expect(screen.getByText('Final Pay')).toBeInTheDocument();
  });
});
