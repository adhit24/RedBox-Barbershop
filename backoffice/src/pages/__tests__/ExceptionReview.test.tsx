import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExceptionReview } from '../ExceptionReview';

describe('ExceptionReview', () => {
  it('does NOT render DemoBadge or fake exception records', () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });

    // Verify NO DemoBadge
    expect(screen.queryByText(/DEMO/i)).toBeNull();

    // Verify NO fake person tickets
    expect(screen.queryByText('Rizky Pratama')).toBeNull();
    expect(screen.queryByText('Andra Wijaya')).toBeNull();
    expect(screen.queryByText('Bagus Setiawan')).toBeNull();
    expect(screen.queryByText(/Exception Menunggu/i)).toBeNull();
  });

  it('renders honest empty state stating module is not connected', () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });

    expect(screen.getByText('Exception Review')).toBeInTheDocument();
    expect(screen.getByText('Belum tersedia')).toBeInTheDocument();
    expect(
      screen.getByText('Belum ada data exception yang terhubung')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Modul exception attendance belum terhubung ke database operasional/i
      )
    ).toBeInTheDocument();
  });
});
