import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../Sidebar';
import { AuthProvider } from '../../auth/AuthProvider';

function renderSidebar() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Sidebar />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  it('links Membership to /reports/membership, not the old /membership path', () => {
    renderSidebar();

    const link = screen.getByRole('link', { name: 'Membership' });

    expect(link).toHaveAttribute('href', '/reports/membership');
  });

  it('still links Command Center to /', () => {
    renderSidebar();

    const link = screen.getByRole('link', { name: 'Command Center' });

    expect(link).toHaveAttribute('href', '/');
  });
});
