import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FingerprintImport } from '../FingerprintImport';

describe('FingerprintImport', () => {
  it('shows the DEMO badge', () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the last-import summary stats', () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });
    expect(screen.getByText('Records Diimport')).toBeInTheDocument();
    expect(screen.getByText('312')).toBeInTheDocument();
  });

  it('links the Exceptions card to Exception Review', () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: /Exceptions/i });
    expect(link.getAttribute('href')).toBe('/attendance/exceptions');
  });
});
