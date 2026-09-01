import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchSelector } from '../BranchSelector';

const BRANCHES = [
  { slug: 'csb', name: 'CSB' },
  { slug: 'bypass', name: 'Bypass' },
];

describe('BranchSelector', () => {
  it('always offers "Semua Cabang" as the first option', () => {
    render(<BranchSelector value="all" branches={BRANCHES} onChange={() => {}} />);

    const select = screen.getByLabelText('Cabang') as HTMLSelectElement;
    expect(select.options[0].value).toBe('all');
    expect(select.options[0].textContent).toBe('Semua Cabang');
  });

  it('calls onChange with the selected branch slug', async () => {
    const onChange = vi.fn();
    render(<BranchSelector value="all" branches={BRANCHES} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText('Cabang'), 'csb');

    expect(onChange).toHaveBeenCalledWith('csb');
  });
});
