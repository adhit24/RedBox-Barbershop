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
  { path: '/system/settings', title: 'Pengaturan' },
];
