import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { apiClient } from '../../lib/apiClient';
import { SystemEventLog } from '../SystemEventLog';

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}));

describe('SystemEventLog', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it('renders the event table once data loads', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: [{
        id: '1', created_at: new Date().toISOString(), severity: 'ERROR', module: 'booking',
        event_name: 'booking_insert_failed', status: 'failed', entity_type: 'booking',
        entity_id: 'b1', message: 'insert failed', correlation_id: 'corr-1',
      }],
    });

    render(<SystemEventLog />);

    await waitFor(() => expect(screen.getByText('booking_insert_failed')).toBeTruthy());
    expect(screen.getByText('System Event Log')).toBeTruthy();
  });

  it('shows an empty state when there are no events', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
    render(<SystemEventLog />);
    await waitFor(() => expect(screen.getByText(/no events/i)).toBeTruthy());
  });

  it('loads the timeline and shows detail fields when a row is clicked', async () => {
    vi.mocked(apiClient.get).mockImplementation((url: string) => {
      if (url.includes('/timeline/')) {
        return Promise.resolve({
          data: [
            {
              id: '1', created_at: new Date().toISOString(), severity: 'ERROR', module: 'booking',
              event_name: 'booking_insert_failed', status: 'failed', entity_type: 'booking',
              entity_id: 'b1', message: 'insert failed', correlation_id: 'corr-1',
              request_id: 'req-1',
            },
            {
              id: '2', created_at: new Date().toISOString(), severity: 'INFO', module: 'booking',
              event_name: 'booking_retry', status: 'ok', entity_type: 'booking',
              entity_id: 'b1', message: 'retried', correlation_id: 'corr-1',
              request_id: 'req-1',
            },
          ],
        });
      }
      return Promise.resolve({
        data: [{
          id: '1', created_at: new Date().toISOString(), severity: 'ERROR', module: 'booking',
          event_name: 'booking_insert_failed', status: 'failed', entity_type: 'booking',
          entity_id: 'b1', message: 'insert failed', correlation_id: 'corr-1',
          request_id: 'req-1',
        }],
      });
    });

    render(<SystemEventLog />);

    await waitFor(() => expect(screen.getByText('booking_insert_failed')).toBeTruthy());

    fireEvent.click(screen.getByText('booking_insert_failed'));

    await waitFor(() => expect(screen.getByText('corr-1')).toBeTruthy());
    expect(screen.getByText('req-1')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('booking_retry (ok)')).toBeTruthy());
    expect(screen.getByText('booking_insert_failed (failed)')).toBeTruthy();

    expect(apiClient.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/system-event-logs/timeline/corr-1'),
    );
  });
});
