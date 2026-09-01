import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExceptionReview } from '../ExceptionReview';

describe('ExceptionReview', () => {
  it('shows the DEMO badge', () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('selects the first exception by default', () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });
    expect(screen.getAllByText('Terlambat 22 menit').length).toBeGreaterThan(0);
  });

  it('switches the detail panel when another exception is clicked', () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByText('Andra Wijaya'));
    expect(screen.getAllByText('Missing check-out').length).toBeGreaterThan(0);
  });
});
