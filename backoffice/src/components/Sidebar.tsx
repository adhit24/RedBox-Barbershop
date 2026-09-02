import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

const softSpringEasing = 'cubic-bezier(0.25, 1.1, 0.4, 1)';

type CategoryId =
  | 'command'
  | 'people'
  | 'operations'
  | 'customer'
  | 'inventory'
  | 'reports'
  | 'integrations'
  | 'system';

interface SidebarItem {
  to: string;
  label: string;
  children?: SidebarItem[];
}

interface SidebarCategory {
  id: CategoryId;
  label: string;
  icon: ReactNode;
  match: (pathname: string) => boolean;
  sections: Array<{
    title: string | null;
    items: SidebarItem[];
  }>;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
    >
      {children}
    </svg>
  );
}

const icons = {
  command: (
    <Icon>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  ),
  people: (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M17 11a4 4 0 0 1 4 4v2" />
      <path d="M16 3.3a4 4 0 0 1 0 7.4" />
    </Icon>
  ),
  operations: (
    <Icon>
      <path d="M14.5 4.5 19.5 9.5" />
      <path d="m4 20 6.5-6.5" />
      <path d="m14 10 6-6" />
      <path d="m4 4 16 16" />
    </Icon>
  ),
  customer: (
    <Icon>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
    </Icon>
  ),
  inventory: (
    <Icon>
      <path d="m21 8-9 5-9-5" />
      <path d="m3 8 9-5 9 5v8l-9 5-9-5Z" />
      <path d="M12 13v8" />
    </Icon>
  ),
  reports: (
    <Icon>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20V7" />
    </Icon>
  ),
  integrations: (
    <Icon>
      <path d="M8 12h8" />
      <path d="M12 8v8" />
      <path d="M18 8a4 4 0 0 0-4-4h-1" />
      <path d="M6 16a4 4 0 0 0 4 4h1" />
      <circle cx="6" cy="8" r="2" />
      <circle cx="18" cy="16" r="2" />
    </Icon>
  ),
  system: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.35.3.57.68.6 1.1V10h1v4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Icon>
  ),
  chevron: (
    <Icon>
      <path d="m8 10 4 4 4-4" />
    </Icon>
  ),
  search: (
    <Icon>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </Icon>
  ),
  logout: (
    <Icon>
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M21 3v18h-6" />
    </Icon>
  ),
};

const CATEGORIES: SidebarCategory[] = [
  {
    id: 'command',
    label: 'Command Center',
    icon: icons.command,
    match: (pathname) => pathname === '/',
    sections: [{ title: null, items: [{ to: '/', label: 'Command Center' }] }],
  },
  {
    id: 'people',
    label: 'People',
    icon: icons.people,
    match: (pathname) => pathname.startsWith('/hr') || pathname.startsWith('/attendance') || pathname.startsWith('/payroll'),
    sections: [
      {
        title: 'People & Payroll',
        items: [
          { to: '/hr', label: 'HR & People' },
          {
            to: '/attendance',
            label: 'Attendance',
            children: [
              { to: '/attendance/import', label: 'Import Fingerprint' },
              { to: '/attendance/exceptions', label: 'Exception Review' },
            ],
          },
          {
            to: '/payroll',
            label: 'Payroll',
            children: [
              { to: '/payroll/regular', label: 'Payroll Karyawan' },
              { to: '/payroll/barber', label: 'Payroll Kapster' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: icons.operations,
    match: (pathname) => pathname.startsWith('/operations'),
    sections: [{ title: 'Operasional Harian', items: [{ to: '/operations', label: 'Operations' }] }],
  },
  {
    id: 'customer',
    label: 'Customer',
    icon: icons.customer,
    match: (pathname) => pathname.startsWith('/crm') || pathname === '/reports/membership' || pathname === '/reports/customers',
    sections: [
      {
        title: 'Customer & Loyalty',
        items: [
          { to: '/crm', label: 'CRM & Customer' },
          { to: '/reports/membership', label: 'Membership' },
          { to: '/reports/customers', label: 'Customer Report' },
        ],
      },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: icons.inventory,
    match: (pathname) => pathname.startsWith('/stockist'),
    sections: [{ title: 'Stock & Inventory', items: [{ to: '/stockist', label: 'Stockist & Inventory' }] }],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: icons.reports,
    match: (pathname) => pathname.startsWith('/reports') && !['/reports/membership', '/reports/customers'].includes(pathname),
    sections: [
      {
        title: 'Performance',
        items: [
          {
            to: '/reports',
            label: 'Reports Overview',
            children: [
              { to: '/reports/branches', label: 'Performa Cabang' },
              { to: '/reports/barbers', label: 'Performa Kapster' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: icons.integrations,
    match: (pathname) => pathname.startsWith('/moka'),
    sections: [{ title: 'Integrasi', items: [{ to: '/moka', label: 'Moka POS Integration' }] }],
  },
  {
    id: 'system',
    label: 'System',
    icon: icons.system,
    match: (pathname) => pathname.startsWith('/system'),
    sections: [
      {
        title: 'System',
        items: [
          { to: '/system/roles', label: 'Peran & Izin' },
          { to: '/system/packages', label: 'Akses Paket' },
          { to: '/system/settings', label: 'Pengaturan' },
        ],
      },
    ],
  },
];

function categoryForPath(pathname: string): CategoryId {
  return CATEGORIES.find((category) => category.match(pathname))?.id ?? 'command';
}

function routeIsActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

function RailButton({
  category,
  active,
  onClick,
}: {
  category: SidebarCategory;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={category.label}
      aria-pressed={active}
      title={category.label}
      onClick={onClick}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] transition-all duration-500 ${
        active
          ? 'bg-rb-red text-white shadow-[0_8px_20px_rgba(199,40,32,0.20)]'
          : 'text-rb-text-muted hover:bg-rb-divider hover:text-rb-text'
      }`}
      style={{ transitionTimingFunction: softSpringEasing }}
    >
      {category.icon}
    </button>
  );
}

function DetailItem({
  item,
  pathname,
  expanded,
  onToggle,
  searchActive,
}: {
  item: SidebarItem;
  pathname: string;
  expanded: boolean;
  onToggle: () => void;
  searchActive: boolean;
}) {
  const active = routeIsActive(pathname, item.to);
  const hasChildren = Boolean(item.children?.length);
  const showChildren = hasChildren && (expanded || active || searchActive);

  return (
    <div className="w-full">
      <div className="group flex w-full items-center gap-1">
        <NavLink
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `flex h-10 min-w-0 flex-1 items-center rounded-[10px] px-3 text-sm font-medium transition-all duration-500 ${
              isActive || active
                ? 'bg-rb-red-tint-bg font-semibold text-rb-red'
                : 'text-rb-text-secondary hover:bg-rb-divider hover:text-rb-text'
            }`
          }
          style={{ transitionTimingFunction: softSpringEasing }}
        >
          <span className="truncate">{item.label}</span>
        </NavLink>
        {hasChildren && (
          <button
            type="button"
            aria-label={`${showChildren ? 'Tutup' : 'Buka'} ${item.label}`}
            aria-expanded={showChildren}
            onClick={onToggle}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-rb-text-muted transition-all duration-500 hover:bg-rb-divider hover:text-rb-text"
            style={{ transitionTimingFunction: softSpringEasing }}
          >
            <span
              className="block transition-transform duration-500"
              style={{
                transitionTimingFunction: softSpringEasing,
                transform: showChildren ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            >
              {icons.chevron}
            </span>
          </button>
        )}
      </div>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-500"
        style={{
          transitionTimingFunction: softSpringEasing,
          gridTemplateRows: showChildren ? '1fr' : '0fr',
          opacity: showChildren ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="ml-3 mt-1 border-l border-rb-border pl-3">
            {item.children?.map((child) => (
              <NavLink
                key={child.to}
                to={child.to}
                className={({ isActive }) =>
                  `flex min-h-9 items-center rounded-[9px] px-3 py-2 text-[13px] transition-all duration-500 ${
                    isActive
                      ? 'bg-rb-red-tint-bg font-semibold text-rb-red'
                      : 'text-rb-text-muted hover:bg-rb-divider hover:text-rb-text-secondary'
                  }`
                }
                style={{ transitionTimingFunction: softSpringEasing }}
              >
                {child.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const location = useLocation();
  const { currentUser, logout } = useAuth();
  const [activeCategory, setActiveCategory] = useState<CategoryId>(() => categoryForPath(location.pathname));
  const [panelOpen, setPanelOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    setActiveCategory(categoryForPath(location.pathname));
  }, [location.pathname]);

  const category = CATEGORIES.find((item) => item.id === activeCategory) ?? CATEGORIES[0];
  const normalizedSearch = search.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!normalizedSearch) return category.sections;

    return category.sections
      .map((section) => ({
        ...section,
        items: section.items
          .map((item) => {
            const parentMatches = item.label.toLowerCase().includes(normalizedSearch);
            const matchingChildren = item.children?.filter((child) =>
              child.label.toLowerCase().includes(normalizedSearch)
            );

            if (parentMatches) return item;
            if (matchingChildren?.length) return { ...item, children: matchingChildren };
            return null;
          })
          .filter((item): item is SidebarItem => Boolean(item)),
      }))
      .filter((section) => section.items.length > 0);
  }, [category, normalizedSearch]);

  const toggleExpanded = (key: string) => {
    setExpandedItems((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const initials = (currentUser?.label ?? 'Owner')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <aside className="sticky top-0 flex h-screen shrink-0 border-r border-rb-border bg-rb-surface">
      <div className="flex w-16 shrink-0 flex-col items-center border-r border-rb-border bg-rb-surface px-3 py-4">
        <div className="mb-4 flex h-10 w-10 items-center justify-center">
          <img
            src="/Brand_assets/logo_hitam_trnsparan.png"
            alt="Redbox Barbershop"
            className="h-8 w-8 object-contain"
          />
        </div>

        <nav aria-label="Navigasi utama" className="flex w-full flex-col items-center gap-2">
          {CATEGORIES.map((item) => (
            <RailButton
              key={item.id}
              category={item}
              active={activeCategory === item.id}
              onClick={() => {
                setActiveCategory(item.id);
                setPanelOpen(true);
                setSearch('');
              }}
            />
          ))}
        </nav>

        <div className="flex-1" />

        {!panelOpen && (
          <button
            type="button"
            aria-label="Buka panel navigasi"
            onClick={() => setPanelOpen(true)}
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] text-rb-text-muted transition-all duration-500 hover:bg-rb-divider hover:text-rb-text"
            style={{ transitionTimingFunction: softSpringEasing }}
          >
            <span className="-rotate-90">{icons.chevron}</span>
          </button>
        )}

        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-rb-purple-tint-bg text-[11px] font-semibold text-rb-purple-tint-fg"
          title={currentUser?.label ?? 'Owner'}
        >
          {initials || 'RB'}
        </div>
      </div>

      <div
        aria-label="Detail navigation"
        className="flex min-w-0 flex-col overflow-hidden bg-rb-surface transition-[width,opacity] duration-500"
        style={{
          transitionTimingFunction: softSpringEasing,
          width: panelOpen ? 238 : 0,
          opacity: panelOpen ? 1 : 0,
        }}
      >
        <div className="flex h-full w-[238px] flex-col p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-rb-text-faint">
                Redbox Backoffice
              </div>
              <h2 className="mt-1 truncate font-serif text-[19px] font-semibold text-rb-text">{category.label}</h2>
            </div>
            <button
              type="button"
              aria-label="Tutup panel navigasi"
              onClick={() => setPanelOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-rb-text-muted transition-all duration-500 hover:bg-rb-divider hover:text-rb-text"
              style={{ transitionTimingFunction: softSpringEasing }}
            >
              <span className="rotate-90">{icons.chevron}</span>
            </button>
          </div>

          <div className="relative mb-4">
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-rb-text-faint">
              {icons.search}
            </div>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari menu..."
              className="h-10 w-full rounded-[10px] border border-rb-border bg-rb-bg pl-10 pr-3 text-sm text-rb-text outline-none transition-all duration-500 placeholder:text-rb-text-faint focus:border-rb-red/40 focus:bg-rb-surface focus:ring-2 focus:ring-rb-red/10"
              style={{ transitionTimingFunction: softSpringEasing }}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {filteredSections.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-rb-border px-3 py-5 text-center text-xs text-rb-text-muted">
                Menu tidak ditemukan.
              </div>
            ) : (
              filteredSections.map((section, sectionIndex) => (
                <section key={`${category.id}-${sectionIndex}`} className="mb-5">
                  {section.title && (
                    <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-rb-text-faint">
                      {section.title}
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    {section.items.map((item) => {
                      const key = `${category.id}:${item.to}`;
                      return (
                        <DetailItem
                          key={key}
                          item={item}
                          pathname={location.pathname}
                          expanded={expandedItems.has(key)}
                          onToggle={() => toggleExpanded(key)}
                          searchActive={Boolean(normalizedSearch)}
                        />
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>

          <div className="mt-3 border-t border-rb-border pt-3">
            <div className="mb-3 flex items-center gap-2.5 rounded-[10px] px-2 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rb-purple-tint-bg text-[10px] font-semibold text-rb-purple-tint-fg">
                {initials || 'RB'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-rb-text">{currentUser?.label ?? 'Owner'}</div>
                <div className="text-[10.5px] text-rb-text-muted">Owner Access</div>
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-left text-xs font-medium text-rb-text-muted transition-all duration-500 hover:bg-rb-red-tint-bg hover:text-rb-red"
              style={{ transitionTimingFunction: softSpringEasing }}
            >
              {icons.logout}
              Logout
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
