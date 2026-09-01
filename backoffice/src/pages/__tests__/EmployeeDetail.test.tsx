import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EmployeeDetail } from '../EmployeeDetail';

describe('EmployeeDetail', () => {
  it('shows the DEMO badge', () => {
    render(
      <MemoryRouter initialEntries={['/hr/employees/RB-0098']}>
        <Routes><Route path="/hr/employees/:id" element={<EmployeeDetail />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders demo employee fields', () => {
    render(
      <MemoryRouter initialEntries={['/hr/employees/RB-0098']}>
        <Routes><Route path="/hr/employees/:id" element={<EmployeeDetail />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Dodi Iskandar')).toBeInTheDocument();
    expect(screen.getAllByText('CSB').length).toBeGreaterThan(0);
  });
});
