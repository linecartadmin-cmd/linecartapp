// Role navigation: one source for the desktop sidebar, the tablet rail, the phone bottom bar and the
// More sheet. Page ids are the existing hash routes and permission keys; they must never be renamed.
// Visibility still goes through App.jsx isPageAllowed() (and the server enforces access on its own).
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Link2,
  Target,
  Package,
  ClipboardCheck,
  Tag,
  BarChart3,
  Map as MapIcon,
  MapPin,
  Truck,
  ScrollText,
  Settings,
  Store,
  Home,
  PlusCircle,
  FileText,
  UsersRound
} from 'lucide-react';

export const ROLE_KEYS = ['admin', 'manager', 'agent', 'delivery'];

// item: { pageId, label, short (bottom bar / rail), icon, perm (permission key passed to
// isPageAllowed, defaults to pageId), badge ('approvals' shows the live pending count),
// resetsPreselectedShop (agent order entry opens without a preselected shop, as before) }
export const NAV = {
  admin: {
    home: 'admin-dashboard',
    groups: [
      { label: null, items: [{ pageId: 'admin-dashboard', label: 'Overview', short: 'Overview', icon: LayoutDashboard }] },
      {
        label: 'Operations',
        items: [
          { pageId: 'orders', label: 'Orders', short: 'Orders', icon: Package },
          { pageId: 'price-requests', label: 'Price approvals', short: 'Approvals', icon: ClipboardCheck, badge: 'approvals' },
          { pageId: 'delivery', label: 'Delivery fleet', short: 'Delivery', icon: Truck },
          { pageId: 'field-visits', label: 'Field visits', short: 'Visits', icon: MapPin }
        ]
      },
      { label: 'Catalogue', items: [{ pageId: 'items', label: 'Items & daily prices', short: 'Items', icon: Tag }] },
      {
        label: 'People & territory',
        items: [
          { pageId: 'admin-users', label: 'Users', short: 'Users', icon: Users },
          { pageId: 'admin-assignments', label: 'Team assignments', short: 'Teams', icon: Link2 },
          { pageId: 'admin-targets', label: 'Targets', short: 'Targets', icon: Target },
          { pageId: 'map', label: 'Shop map', short: 'Map', icon: MapIcon }
        ]
      },
      { label: 'Insights', items: [{ pageId: 'reports', label: 'Reports', short: 'Reports', icon: BarChart3 }] },
      {
        label: 'System',
        items: [
          { pageId: 'admin-roles', label: 'Roles & permissions', short: 'Roles', icon: ShieldCheck },
          { pageId: 'admin-audit', label: 'Audit log', short: 'Audit', icon: ScrollText },
          { pageId: 'admin-settings', label: 'Settings', short: 'Settings', icon: Settings }
        ]
      }
    ],
    phone: ['admin-dashboard', 'orders', 'price-requests', 'items']
  },
  manager: {
    home: 'reports',
    groups: [
      {
        label: 'Team',
        items: [
          { pageId: 'reports', label: 'Reports & performance', short: 'Reports', icon: BarChart3 },
          { pageId: 'field-visits', label: 'Field visits', short: 'Visits', icon: MapPin },
          { pageId: 'team', label: 'My sales team', short: 'Team', icon: UsersRound }
        ]
      },
      {
        label: 'Orders',
        items: [
          { pageId: 'orders', label: 'Team orders', short: 'Orders', icon: Package },
          { pageId: 'price-requests', label: 'Price approvals', short: 'Approvals', icon: ClipboardCheck, perm: 'orders', badge: 'approvals' },
          { pageId: 'items', label: 'Items & daily prices', short: 'Pricing', icon: Tag }
        ]
      },
      {
        label: 'Shops',
        items: [
          { pageId: 'customers', label: 'Shops', short: 'Shops', icon: Store },
          { pageId: 'map', label: 'Shop map', short: 'Map', icon: MapIcon }
        ]
      }
    ],
    phone: ['reports', 'orders', 'price-requests', 'customers']
  },
  agent: {
    home: 'overview',
    groups: [
      {
        label: null,
        items: [
          { pageId: 'overview', label: 'Overview', short: 'Home', icon: Home },
          { pageId: 'orders', label: 'New order', short: 'Order', icon: PlusCircle, resetsPreselectedShop: true },
          { pageId: 'visits', label: 'My visits', short: 'Visits', icon: MapPin },
          { pageId: 'customers', label: 'Shops', short: 'Shops', icon: Store }
        ]
      },
      {
        label: 'Reports',
        items: [
          { pageId: 'reports', label: 'Reports', short: 'Reports', icon: BarChart3 },
          { pageId: 'summary', label: 'Summary report', short: 'Summary', icon: FileText }
        ]
      }
    ],
    phone: ['overview', 'customers', 'orders', 'visits']
  },
  delivery: {
    home: 'delivery',
    groups: [{ label: null, items: [{ pageId: 'delivery', label: 'Delivery route', short: 'Route', icon: Truck }] }],
    phone: ['delivery']
  }
};

// Top-bar titles. Labels changed for consistency; page ids are unchanged.
const TITLES = {
  'admin-dashboard': 'Overview',
  'admin-users': 'Users',
  'admin-roles': 'Roles & permissions',
  'admin-assignments': 'Team assignments',
  'admin-targets': 'Targets',
  'admin-audit': 'Audit log',
  'admin-settings': 'Settings',
  'admin-orders': 'Orders',
  'admin-reports': 'Reports',
  'price-requests': 'Price approvals',
  items: 'Items & daily prices',
  map: 'Shop map',
  'field-visits': 'Field visits',
  team: 'My sales team',
  customers: 'Shops',
  summary: 'Summary report',
  visits: 'My visits'
};
const ROLE_TITLES = {
  admin: { orders: 'Orders', reports: 'Reports', delivery: 'Delivery fleet', overview: 'Overview' },
  manager: { orders: 'Team orders', reports: 'Reports & performance', overview: 'Reports & performance' },
  agent: { orders: 'New order', reports: 'Reports', overview: 'Overview' },
  delivery: { delivery: 'Delivery route' }
};

export function roleKeyFor({ isAdmin, isManager, isDelivery }) {
  if (isAdmin) return 'admin';
  if (isManager) return 'manager';
  if (isDelivery) return 'delivery';
  return 'agent';
}

export function pageTitle(roleKey, pageId) {
  return ROLE_TITLES[roleKey]?.[pageId] || TITLES[pageId] || 'LineCart';
}

export const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Sales Manager',
  agent: 'Field Sales Agent',
  delivery: 'Delivery Agent'
};

// Filters the role's navigation with the app's own permission check.
export function visibleNav(roleKey, isPageAllowed) {
  const cfg = NAV[roleKey];
  const allowed = (item) => isPageAllowed(item.perm || item.pageId);
  const groups = cfg.groups
    .map((g) => ({ ...g, items: g.items.filter(allowed) }))
    .filter((g) => g.items.length > 0);
  const all = groups.flatMap((g) => g.items);
  const byId = new Map(all.map((i) => [i.pageId, i]));
  const phone = cfg.phone.map((id) => byId.get(id)).filter(Boolean).slice(0, 4);
  const phoneIds = new Set(phone.map((i) => i.pageId));
  const moreGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !phoneIds.has(i.pageId)) }))
    .filter((g) => g.items.length > 0);
  return { groups, phone, moreGroups, home: cfg.home };
}

// Every page id the navigation can open, per role (used by the consistency test).
export function navPageIds(roleKey) {
  return NAV[roleKey].groups.flatMap((g) => g.items.map((i) => i.pageId));
}
