import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodSelector } from '../PeriodSelector';

describe('PeriodSelector', () => {
  it('calls onChange with the selected period', async () => {
    const onChange = vi.fn();
    render(<PeriodSelector value="month" onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText('Periode'), 'today');

    expect(onChange).toHaveBeenCalledWith('today');
  });

  it('shows the current value as selected', () => {
    render(<PeriodSelector value="7d" onChange={() => {}} />);

    expect(screen.getByLabelText('Periode')).toHaveValue('7d');
  });
});
