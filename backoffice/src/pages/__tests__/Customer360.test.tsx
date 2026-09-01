import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Customer360 } from '../Customer360';

const FOUND_RESULT = {
  identity: { customer_found: true, customer_id: 'c1', resolution: 'direct_id_match' },
  customer: { customer_id: 'c1', name: 'Bima Aditya', wa_number: '6281234567890', phone_e164: '+6281234567890', birthday: null, registration_status: 'registered_member', is_registered_member: true, member_since: '2026-01-01', created_at: '2025-06-01' },
  membership: { status: 'ACTIVE', tier: 'gold', activated_at: '2026-01-01', expires_at: null },
  loyalty: { points_balance: 120, last_activity: '2026-08-01' },
  activity: { first_visit: '2025-06-01', last_visit: '2026-08-26', last_visit_branch: 'csb', last_visit_barber: 'Ubay Santoso', last_visit_service: 'Haircut + Beard', days_since_last_visit: 6, completed_booking_count: 10, cancelled_booking_count: 0, pending_booking_count: 0, completed_transaction_count: 4, repeat_customer: true },
  spending: { transaction_count: 4, total_spend_idr: 400000, average_transaction_value_idr: 100000 },
  preferences: { favorite_branch: { value: 'csb' }, favorite_barber: { value: 'Ubay Santoso' }, favorite_service: { value: 'Haircut + Beard' } },
};

const NOT_FOUND_RESULT = {
  identity: { customer_found: false, customer_id: null, resolution: 'not_found' },
  customer: null, membership: null, loyalty: null, activity: null, spending: null, preferences: null,
};

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/crm/customers/${id}`]}>
      <Routes>
        <Route path="/crm/customers/:id" element={<Customer360 />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Customer360', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the resolved customer profile fields', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(FOUND_RESULT), { status: 200 }));
    renderAt('phone%3A6281234567890');
    await waitFor(() => {
      expect(screen.getAllByText('Bima Aditya').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
  });

  it('shows an honest not-found state when identity resolution fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(NOT_FOUND_RESULT), { status: 200 }));
    renderAt('phone%3A0000');
    await waitFor(() => {
      expect(screen.getByText(/tidak ditemukan/i)).toBeInTheDocument();
    });
  });
});
