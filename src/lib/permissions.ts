// Shared role capability matrix.
// Safe to import from BOTH client components and server routes — no node-only imports here.
// The server is the enforcement point; the client uses this only to hide controls.

export type Action =
  | "orders:read"
  | "orders:write"
  | "orders:delete"
  | "orders:edit"  // edit metadata (title, value, dates, etc.) - new
  | "operations:write"  // full operations management (manager only)
  | "operations:update-status"  // mark own operations ready/in-progress/completed - new
  | "operations:create"  // add new operation steps - new (manager only)
  | "operations:delete"  // remove operation steps - new (manager only)
  | "machines:read"
  | "machines:write"
  | "customers:read"
  | "customers:write"
  | "customers:delete"
  | "inventory:read"
  | "inventory:write"
  | "materials:write"  // allocate/consume materials on orders - new
  | "cmms:read"
  | "cmms:write"
  | "cmms:configure"
  | "reports:read"
  | "reports:write"
  | "shifts:read"
  | "shifts:write"
  | "attendance:read"
  | "attendance:write"
  | "quality:read"
  | "quality:write"
  | "downtime:read"
  | "downtime:write"
  | "wip:read"
  | "recipes:read"
  | "recipes:write"
  | "pims:read"
  | "pims:write"
  | "users:read"
  | "users:manage"
  | "admin:seed";

export const ROLES = ["Manager", "Sales Coordinator", "Machine Operator", "QA & Dispatch", "Technician"] as const;
export type Role = (typeof ROLES)[number];

/** Everything a signed-in user may do regardless of role. */
const BASE_READ: Action[] = [
  "orders:read",
  "machines:read",
  "customers:read",
  "inventory:read",
  "cmms:read",
];

const MATRIX: Record<string, Action[]> = {
  Manager: [
    ...BASE_READ,
    "reports:read",
    "orders:write", "orders:delete", "orders:edit",
    "operations:write", "operations:update-status", "operations:create", "operations:delete",
    "machines:write",
    "customers:write", "customers:delete",
    "inventory:write", "materials:write",
    "cmms:write", "cmms:configure",
    "reports:write",
    "shifts:read", "shifts:write",
    "attendance:read", "attendance:write",
    "quality:read", "quality:write",
    "downtime:read", "downtime:write",
    "wip:read",
    "recipes:read", "recipes:write",
    "pims:read", "pims:write",
    "users:read", "users:manage",
    "admin:seed",
  ],
  "Sales Coordinator": [
    ...BASE_READ,
    "reports:read",
    "orders:write", "orders:edit",
    "customers:write",
    "materials:write",  // Sales can allocate materials when creating orders
    "reports:write",
    "wip:read",         // Sales can watch their orders move through the shop floor board
  ],
  "Machine Operator": [
    ...BASE_READ,
    "operations:update-status",  // can ONLY mark own operations as ready/in-progress/completed
    "inventory:write",  // can adjust stock they consume
    "shifts:read", "attendance:read", "attendance:write",  // see own shift plan + clock in/out
    "quality:read", "quality:write",  // log scrap & rework at the station
    "downtime:read", "downtime:write",  // report a machine down / running again
    "wip:read",
  ],
  "QA & Dispatch": [
    ...BASE_READ,
    "operations:update-status",  // can mark QA steps completed
    "inventory:write",
    "cmms:write",
    "reports:write",
    "shifts:read", "attendance:read", "attendance:write",
    "quality:read", "quality:write",  // QA owns defect disposition
    "downtime:read",
    "wip:read",
  ],
  Technician: [
    ...BASE_READ,
    "machines:write",
    "operations:update-status",  // techs updating CMMS-related operation status
    "cmms:write", "cmms:configure",
    "shifts:read", "attendance:read", "attendance:write",
    "reports:write",
    "quality:read",
    "downtime:read", "downtime:write",  // technicians resolve machine downtime
    "wip:read",
  ],
};

export function can(role: string | null | undefined, action: Action): boolean {
  if (!role) return false;
  // Back-compat: "operations:write" used to be the gate for everything;
  // now it's manager-only and "operations:update-status" is the broader one.
  // If someone asks for "operations:write", they really need the full set,
  // so we keep that as a strict check.
  return (MATRIX[role] ?? []).includes(action);
}

const LABELS: Record<Action, string> = {
  "orders:read": "view production orders",
  "orders:write": "create new production orders",
  "orders:delete": "delete production orders",
  "orders:edit": "edit production order details",
  "operations:write": "fully manage workflow operations",
  "operations:update-status": "update the status of operations you are working on",
  "operations:create": "add new operation steps to orders",
  "operations:delete": "remove operation steps from orders",
  "machines:read": "view machines",
  "machines:write": "manage machine records",
  "customers:read": "view clients",
  "customers:write": "manage client accounts",
  "customers:delete": "delete client accounts",
  "inventory:read": "view stock",
  "inventory:write": "adjust material stock",
  "materials:write": "allocate or remove materials on orders",
  "cmms:read": "view plant assets",
  "cmms:write": "record maintenance",
  "cmms:configure": "change CMMS configuration",
  "reports:read": "view reports",
  "reports:write": "generate reports",
  "shifts:read": "view shifts and the production calendar",
  "shifts:write": "manage shift definitions and assignments",
  "attendance:read": "view time and attendance records",
  "attendance:write": "clock in and out",
  "quality:read": "view scrap and rework records",
  "quality:write": "record or resolve scrap and rework events",
  "downtime:read": "view machine downtime records",
  "downtime:write": "record or end machine downtime",
  "wip:read": "view the live work-in-progress board",
  "recipes:read": "view routing recipes",
  "recipes:write": "create or edit routing recipes",
  "pims:read": "view the PIMS import log and settings",
  "pims:write": "import PIMS invoices or change PIMS settings",
  "users:read": "view staff accounts",
  "users:manage": "manage staff accounts",
  "admin:seed": "reset demo data",
};

export function deniedMessage(role: string | null | undefined, action: Action): string {
  return `Your role (${role ?? "guest"}) is not permitted to ${LABELS[action]}.`;
}
