import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

interface NavItem {
  to: string;
  label: string;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [{ to: '/', label: 'Command Center' }] },
  {
    label: 'HR & People',
    items: [
      { to: '/hr', label: 'HR & People' },
      { to: '/attendance', label: 'Attendance' },
      { to: '/payroll', label: 'Payroll' },
    ],
  },
  {
    label: 'Operations & Growth',
    items: [
      { to: '/operations', label: 'Operations' },
      { to: '/crm', label: 'CRM & Customer' },
      { to: '/membership', label: 'Membership' },
      { to: '/stockist', label: 'Stockist & Inventory' },
      { to: '/moka', label: 'Moka POS Integration' },
      { to: '/reports', label: 'Reports' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/system/roles', label: 'Peran & Izin' },
      { to: '/system/packages', label: 'Akses Paket' },
      { to: '/system/settings', label: 'Pengaturan' },
    ],
  },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { currentUser, logout } = useAuth();

  return (
    <aside
      className={`flex h-screen flex-col border-r border-rb-border bg-rb-surface transition-[width] duration-150 ${
        collapsed ? 'w-[68px]' : 'w-[234px]'
      }`}
    >
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-rb-red font-serif text-base font-semibold text-white">
          R
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-semibold text-rb-text">Redbox</div>
            <div className="text-[11px] text-rb-text-muted">Backoffice</div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {NAV_GROUPS.map((group, i) => (
          <div key={i} className="mb-4">
            {group.label && !collapsed && (
              <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-rb-text-muted">
                {group.label}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `rounded-[10px] px-2.5 py-2 text-sm font-medium transition ${
                      isActive
                        ? 'bg-rb-red-tint-bg font-semibold text-rb-red'
                        : 'text-rb-text-secondary hover:bg-rb-divider'
                    } ${collapsed ? 'text-center' : ''}`
                  }
                >
                  {collapsed ? item.label.charAt(0) : item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="px-3">
          <span className="inline-flex w-full items-center justify-center rounded-rb-pill bg-rb-orange-tint-bg px-2.5 py-1.5 text-center text-[10.5px] font-semibold text-[#8a5a16]">
            Full Feature Review Mode
          </span>
        </div>
      )}

      <div className="border-t border-rb-border p-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="mb-3 w-full rounded-[10px] px-2.5 py-1.5 text-left text-xs font-medium text-rb-text-muted hover:bg-rb-divider"
        >
          {collapsed ? '»' : 'Sembunyikan'}
        </button>
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rb-purple-tint-bg text-[11px] font-semibold text-rb-purple-tint-fg">
            GS
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-xs font-semibold text-rb-text">
                {currentUser?.label ?? 'Owner'}
              </div>
              <button
                type="button"
                onClick={logout}
                className="text-[11px] text-rb-text-muted hover:text-rb-red"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
