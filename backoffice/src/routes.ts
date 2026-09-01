export interface PlaceholderRouteDef {
  path: string;
  title: string;
}

export const COMMAND_CENTER_PATH = '/';
export const LOGIN_PATH = '/login';

/**
 * Screens not yet implemented (spec §8, workstreams B–I) — each renders the
 * shared ComingSoon placeholder until its workstream replaces the entry with
 * a real <Route> in App.tsx. Remove an entry here the same commit a real
 * page for it ships.
 */
export const PLACEHOLDER_ROUTES: PlaceholderRouteDef[] = [
  { path: '/hr', title: 'HR & People' },
  { path: '/hr/employees/:id', title: 'Employee Detail' },
  { path: '/attendance', title: 'Attendance Overview' },
  { path: '/attendance/import', title: 'Fingerprint Import' },
  { path: '/attendance/exceptions', title: 'Exception Review' },
  { path: '/payroll', title: 'Payroll Overview' },
  { path: '/payroll/regular', title: 'Regular Payroll' },
  { path: '/payroll/barber', title: 'Barber Payroll' },
  { path: '/payroll/employees/:id', title: 'Payroll Employee Detail' },
  { path: '/system/roles', title: 'Peran & Izin' },
  { path: '/system/packages', title: 'Akses Paket' },
  { path: '/system/settings', title: 'Pengaturan' },
];
