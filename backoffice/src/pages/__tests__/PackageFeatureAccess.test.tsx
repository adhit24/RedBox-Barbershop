import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackageFeatureAccess } from '../PackageFeatureAccess';

describe('PackageFeatureAccess', () => {
  it('accurately describes Full Feature Review Mode as the real current state', () => {
    render(<PackageFeatureAccess />);
    expect(screen.getByText('Full Feature Review Mode')).toBeInTheDocument();
    expect(screen.getByText(/Semua modul dibuka sementara/i)).toBeInTheDocument();
  });

  it('discloses the commercial package plan as not yet enforced', () => {
    render(<PackageFeatureAccess />);
    expect(screen.getByText(/belum diberlakukan/i)).toBeInTheDocument();
    expect(screen.getByText('Redbox Business Suite')).toBeInTheDocument();
  });
});
