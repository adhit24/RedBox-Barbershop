import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RolesPermissions } from '../RolesPermissions';

describe('RolesPermissions', () => {
  it('shows the DEMO badge and a target-architecture disclosure', () => {
    render(<RolesPermissions />);
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
    expect(screen.getByText(/belum diterapkan di backend/i)).toBeInTheDocument();
  });

  it('renders the role cards and the module access matrix', () => {
    render(<RolesPermissions />);
    expect(screen.getByText('Owner / Super Admin')).toBeInTheDocument();
    expect(screen.getByText('Command Center')).toBeInTheDocument();
  });
});
