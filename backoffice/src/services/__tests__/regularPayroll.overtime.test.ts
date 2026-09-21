import { describe, it, expect } from 'vitest';
import { defaultApprovedOvertimeMinutes } from '../regularPayroll';

describe('defaultApprovedOvertimeMinutes', () => {
  it('PENDING candidate with approved=0 starts from the raw detected minutes', () => {
    expect(defaultApprovedOvertimeMinutes({ status: 'PENDING', raw_overtime_minutes: 120, approved_overtime_minutes: 0 })).toBe(120);
  });

  it('a recorded approved value wins over raw', () => {
    expect(defaultApprovedOvertimeMinutes({ status: 'PENDING', raw_overtime_minutes: 120, approved_overtime_minutes: 90 })).toBe(90);
    expect(defaultApprovedOvertimeMinutes({ status: 'APPROVED', raw_overtime_minutes: 120, approved_overtime_minutes: 90 })).toBe(90);
  });

  it('decided REJECTED keeps 0 (a human decision is not silently replaced by raw)', () => {
    expect(defaultApprovedOvertimeMinutes({ status: 'REJECTED', raw_overtime_minutes: 120, approved_overtime_minutes: 0 })).toBe(0);
  });

  it('tolerates missing values', () => {
    expect(
      defaultApprovedOvertimeMinutes({ status: 'PENDING', raw_overtime_minutes: 60 } as never)
    ).toBe(60);
  });
});
