import { describe, it, expect } from 'vitest';
import { COMMAND_CENTER_PATH, LOGIN_PATH, PLACEHOLDER_ROUTES } from '../routes';

describe('Backoffice route table', () => {
  it('uses / for Command Center and /login for Login', () => {
    expect(COMMAND_CENTER_PATH).toBe('/');
    expect(LOGIN_PATH).toBe('/login');
  });

  it('no longer defines a bare /membership route', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/membership');
  });

  it('no longer defines the singular /payroll/employee/:id route', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/payroll/employee/:id');
  });

  it('defines exactly 1 remaining placeholder screen (system/settings, not part of the 23-screen scope)', () => {
    expect(PLACEHOLDER_ROUTES).toHaveLength(1);
    expect(PLACEHOLDER_ROUTES[0].path).toBe('/system/settings');
  });

  it('no longer defines /attendance as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/attendance');
  });

  it('no longer defines /hr as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/hr');
  });

  it('no longer defines /hr/employees/:id as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/hr/employees/:id');
  });

  it('no longer defines /stockist as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/stockist');
  });

  it('no longer defines /moka as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/moka');
  });

  it('no longer defines /reports as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/reports');
  });

  it('no longer defines /reports/branches as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/reports/branches');
  });

  it('no longer defines /reports/barbers as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/reports/barbers');
  });

  it('no longer defines /operations as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/operations');
  });

  it('no longer defines /crm as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/crm');
  });

  it('no longer defines /crm/customers/:id as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/crm/customers/:id');
  });

  it('no longer defines /reports/customers as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/reports/customers');
  });

  it('no longer defines /reports/membership as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/reports/membership');
  });

  it('has no duplicate paths', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
