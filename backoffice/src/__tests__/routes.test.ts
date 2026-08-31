import { describe, it, expect } from 'vitest';
import { COMMAND_CENTER_PATH, LOGIN_PATH, PLACEHOLDER_ROUTES } from '../routes';

describe('Backoffice route table', () => {
  it('uses / for Command Center and /login for Login', () => {
    expect(COMMAND_CENTER_PATH).toBe('/');
    expect(LOGIN_PATH).toBe('/login');
  });

  it('uses the pluralized Payroll Employee Detail path', () => {
    const route = PLACEHOLDER_ROUTES.find((r) => r.title === 'Payroll Employee Detail');
    expect(route?.path).toBe('/payroll/employees/:id');
  });

  it('nests Membership Report under /reports', () => {
    const route = PLACEHOLDER_ROUTES.find((r) => r.title === 'Membership Report');
    expect(route?.path).toBe('/reports/membership');
  });

  it('no longer defines a bare /membership route', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/membership');
  });

  it('no longer defines the singular /payroll/employee/:id route', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/payroll/employee/:id');
  });

  it('defines exactly the 21 remaining non-Command-Center, non-Login, non-Operations screens', () => {
    expect(PLACEHOLDER_ROUTES).toHaveLength(21);
  });

  it('no longer defines /operations as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/operations');
  });

  it('has no duplicate paths', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
