import type { RoleKey } from "@/lib/roleTypes";

export const PERMISSION_GROUPS = [
  {
    id: "calendar",
    label: "Calendar",
    permissions: [
      ["calendar.view", "View calendar"],
      ["calendar.create", "Create events"],
      ["calendar.edit", "Edit events"],
      ["calendar.delete", "Delete events"],
    ],
  },
  {
    id: "jobs",
    label: "Jobs",
    permissions: [
      ["jobs.view", "View jobs"],
      ["jobs.view_contract_jobs", "View contract jobs"],
      ["jobs.view_service_jobs", "View service jobs (off = contract jobs only)"],
      ["jobs.import", "Import jobs"],
      ["jobs.create", "Create jobs"],
      ["jobs.edit_metadata", "Edit job metadata"],
      ["jobs.delete", "Delete jobs"],
      ["jobs.manage_hydratec_watchers", "Manage HydraTec watchers"],
    ],
  },
  {
    id: "job_import",
    label: "Job Import",
    permissions: [
      ["job_import.view", "View job import"],
      ["job_import.upload", "Upload new drafts"],
      ["job_import.drafts.view_own", "View and edit drafts"],
      ["job_import.drafts.view_all", "View all drafts"],
      ["job_import.drafts.edit_others", "Edit other people's drafts"],
      ["job_import.commit", "Commit drafts as jobs"],
      ["job_import.hydratec_watchers.view_own", "View own HydraTec watchers"],
      ["job_import.hydratec_watchers.view_all", "View all HydraTec watchers"],
      ["job_import.hydratec_watchers.add", "Add HydraTec watchers"],
      ["job_import.hydratec_watchers.revoke", "Revoke HydraTec watchers"],
      ["job_import.hydratec_watchers.regenerate_own", "Regenerate own HydraTec watchers"],
    ],
  },
  {
    id: "job_detail",
    label: "Job Detail",
    permissions: [
      ["job.puller.view", "View puller tab"],
      ["job.puller.pull_from_shop", "Pull from shop"],
      ["job.puller.order", "Order line items"],
      ["job.puller.edit_line", "Edit line items"],
      ["job.puller.add_line", "Add line items"],
      ["job.puller.delete_line", "Delete line items"],
      ["job.puller.import_update_pdf", "Upload picksheets for empty jobs"],
      ["job.delivery.view", "View delivery tab"],
      ["job.delivery.edit", "Edit delivery tab"],
      ["job.delivery.mark_delivered", "Mark delivered"],
      ["job.delivery.mark_pickup", "Mark pickup"],
      ["job.delivery.partial_delivery", "Record partial delivery"],
      ["job.preorder.view", "View preorders"],
      ["job.preorder.edit", "Edit preorders"],
      ["job.preorder.receive", "Receive preorders"],
      ["job.preorder.undo_receive", "Undo preorder receiving"],
      ["job.stock_back.view", "View stock in"],
      ["job.stock_back.create", "Create stock in"],
      ["job.stock_back.undo", "Undo stock in"],
      ["job.purchase_order.view", "View purchase order tab"],
      ["job.purchase_order.edit_unit_cost", "Edit unit cost"],
      ["job.notes.view", "View notes"],
      ["job.notes.add", "Add/edit notes"],
      ["job.notes.edit", "Edit notes"],
      ["job.notes.delete", "Delete notes"],
      ["job.notes.upload_packing_slips", "Upload packing slips"],
      ["job.access.view", "View job access"],
      ["job.access.manage", "Manage job access"],
      ["job.access.auto_add_all_jobs", "Auto add to All Jobs"],
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    permissions: [
      ["inventory.view", "View inventory"],
      ["inventory.add_part", "Add parts"],
      ["inventory.edit_part", "Edit parts"],
      ["inventory.delete_part", "Delete parts"],
      ["inventory.adjust_quantity", "Adjust quantity"],
      ["inventory.logs.view", "View logs"],
      ["inventory.cost_history.view", "View cost/profile history"],
      ["inventory.vendor_prices.import", "View vendor price imports"],
      ["inventory.vendor_prices.review", "Review and import vendor prices"],
      ["inventory.vendor_prices.commit", "Commit vendor imports"],
      ["inventory.vendor_prices.discard", "Discard vendor imports"],
    ],
  },
  {
    id: "vendor_orders",
    label: "Vendor Orders",
    permissions: [
      ["orders.view", "View vendor orders"],
      ["orders.to_order.view", "View to-order queue"],
      ["orders.to_order.edit", "Edit to-order rows"],
      ["orders.generate_send", "Review and send purchase orders"],
      ["orders.pending.view", "View pending order updates"],
      ["orders.cancel", "Cancel pending orders"],
      ["orders.mark_received", "Mark received"],
      ["orders.revert_received", "Revert received"],
      ["orders.mark_pickup", "Mark pickup"],
      ["orders.mark_jobsite_delivery", "Mark jobsite delivery"],
      ["orders.clear_delivery_status", "Clear delivery status"],
      ["orders.history.view", "View order history"],
      ["orders.history.delete", "Delete order history"],
      ["orders.suppliers.manage", "Manage supplier directory"],
    ],
  },
  {
    id: "estimates",
    label: "Estimates",
    permissions: [
      ["estimates.view", "View estimates"],
      ["estimates.create", "Create estimates"],
      ["estimates.edit_info", "Edit estimate info"],
      ["estimates.pricing_controls.edit", "Edit pricing controls"],
      ["estimates.edit", "Edit workbook"],
      ["estimates.archive", "Archive/unarchive estimates"],
      ["estimates.change_status", "Change status"],
      ["estimates.pdf.generate", "Generate PDFs"],
      ["estimates.variants.manage", "Manage variants"],
    ],
  },
  {
    id: "users",
    label: "Manage Users",
    permissions: [
      ["users.view", "View users"],
      ["users.add", "Add users"],
      ["users.change_role", "Change roles"],
      ["users.reset_password", "Reset passwords"],
      ["users.terminate", "Terminate access"],
      ["users.password_resets.manage", "Approve/reject password resets"],
      ["users.permissions.edit", "Edit permissions"],
      ["users.super_admin.assign", "Assign Super Admin"],
      ["users.permissions.audit.view", "View permission audit"],
    ],
  },
  {
    id: "dev",
    label: "Survey / Dev Tools",
    permissions: [
      ["dev.survey.view", "View survey admin"],
      ["dev.survey.create", "Create surveys"],
      ["dev.survey.edit", "Edit surveys"],
      ["dev.survey.launch_close", "Launch/close surveys"],
      ["dev.survey.results.view", "View survey results"],
      ["dev.survey.pdf.export", "Export survey PDFs"],
    ],
  },
] as const;

export type PermissionKey =
  (typeof PERMISSION_GROUPS)[number]["permissions"][number][0];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map(([key]) => key),
) as PermissionKey[];

export const LEGACY_PERMISSION_KEYS = new Set<PermissionKey>([
  "jobs.import",
  "jobs.manage_hydratec_watchers",
]);

/** Granted automatically by another toggle; not shown as its own control in the UI. */
export const IMPLIED_PERMISSION_KEYS = new Set<PermissionKey>([
  "job.notes.edit",
  "inventory.cost_history.view",
]);

export type PermissionDangerLevel = "normal" | "high";

export type PermissionNode = {
  key: PermissionKey;
  label: string;
  help: string;
  dangerLevel?: PermissionDangerLevel;
  requires?: PermissionKey[];
  children?: PermissionNode[];
};

export type PermissionHierarchyGroup = {
  id: (typeof PERMISSION_GROUPS)[number]["id"];
  label: string;
  help: string;
  nodes: PermissionNode[];
};

export const PERMISSION_HIERARCHY = [
  {
    id: "calendar",
    label: "Calendar",
    help: "Calendar visibility and event management.",
    nodes: [
      {
        key: "calendar.view",
        label: "Calendar Access",
        help: "View the shared calendar.",
        children: [
          { key: "calendar.create", label: "Create Events", help: "Add new calendar events." },
          { key: "calendar.edit", label: "Edit Events", help: "Change event details." },
          {
            key: "calendar.delete",
            label: "Delete Events",
            help: "Remove events from the calendar.",
            dangerLevel: "high",
          },
        ],
      },
    ],
  },
  {
    id: "jobs",
    label: "Jobs",
    help: "Job visibility, job records, and job detail workflows.",
    nodes: [
      {
        key: "jobs.view",
        label: "Job Visibility",
        help: "Control which jobs this user can see.",
        children: [
          {
            key: "jobs.view_contract_jobs",
            label: "Contract Jobs",
            help: "Include contract jobs in the Jobs list.",
          },
          {
            key: "jobs.view_service_jobs",
            label: "Service Jobs",
            help: "Include service jobs in the Jobs list.",
          },
        ],
      },
      {
        key: "job.puller.view",
        label: "Overview Tab",
        help: "Open the overview and material list inside a job.",
        requires: ["jobs.view"],
        children: [
          {
            key: "jobs.edit_metadata",
            label: "Edit Job Info",
            help: "Edit job metadata, dates, names, and overview fields.",
          },
          {
            key: "job.puller.pull_from_shop",
            label: "Pull From Shop",
            help: "Pull material from shop inventory and use Pull All.",
          },
          {
            key: "job.puller.order",
            label: "Order Line Items",
            help: "Order individual material rows and use Order All.",
          },
          {
            key: "job.puller.edit_line",
            label: "Edit Line Items",
            help: "Edit material row details like Needed, FAB, descriptions, and suppliers.",
          },
          { key: "job.puller.add_line", label: "Add Line Items", help: "Add material rows." },
          {
            key: "job.puller.delete_line",
            label: "Delete Line Items",
            help: "Delete material rows.",
            dangerLevel: "high",
          },
          {
            key: "job.puller.import_update_pdf",
            label: "Upload Picksheets For Empty Jobs",
            help: "Upload picksheet PDFs when a job has no material rows.",
          },
          {
            key: "jobs.delete",
            label: "Delete Jobs",
            help: "Remove jobs from the dashboard.",
            dangerLevel: "high",
          },
        ],
      },
      {
        key: "job.delivery.view",
        label: "Delivery Tab",
        help: "Open delivery details inside a job.",
        requires: ["jobs.view"],
        children: [
          { key: "job.delivery.edit", label: "Edit Delivery Details", help: "Edit delivery form fields." },
          { key: "job.delivery.mark_delivered", label: "Mark Delivered", help: "Mark a job/list delivered." },
          { key: "job.delivery.mark_pickup", label: "Mark Pickup", help: "Mark supplier pickup status." },
          {
            key: "job.delivery.partial_delivery",
            label: "Record Partial Delivery",
            help: "Enter partial delivery details.",
          },
        ],
      },
      {
        key: "job.preorder.view",
        label: "Preorders",
        help: "View job preorder lines.",
        requires: ["jobs.view"],
        children: [
          { key: "job.preorder.edit", label: "Edit Preorders", help: "Add or edit preorder lines." },
          {
            key: "job.preorder.receive",
            label: "Receive Preorders",
            help: "Receive preorder quantities.",
          },
          {
            key: "job.preorder.undo_receive",
            label: "Undo Preorder Receiving",
            help: "Reverse received preorder quantities.",
            dangerLevel: "high",
          },
        ],
      },
      {
        key: "job.stock_back.view",
        label: "Stock In",
        help: "View the stock-in workflow.",
        requires: ["jobs.view"],
        children: [
          {
            key: "job.stock_back.create",
            label: "Create Stock In",
            help: "Return pulled material to stock.",
          },
          {
            key: "job.stock_back.undo",
            label: "Undo Stock In",
            help: "Reverse a stock-in action.",
            dangerLevel: "high",
          },
        ],
      },
      {
        key: "job.purchase_order.view",
        label: "Job Purchase Order",
        help: "View the job purchase order tab.",
        requires: ["jobs.view"],
        children: [
          {
            key: "job.purchase_order.edit_unit_cost",
            label: "Edit Unit Cost",
            help: "Change purchase order unit cost overrides.",
          },
        ],
      },
      {
        key: "job.notes.view",
        label: "Job Notes",
        help: "View job notes.",
        requires: ["jobs.view"],
        children: [
          {
            key: "job.notes.add",
            label: "Add/Edit Notes",
            help: "Create, reply to, and edit notes.",
          },
          {
            key: "job.notes.delete",
            label: "Delete Notes",
            help: "Delete notes and comments.",
            dangerLevel: "high",
          },
          {
            key: "job.notes.upload_packing_slips",
            label: "Upload Packing Slips",
            help: "Attach packing slips.",
          },
        ],
      },
      {
        key: "job.access.view",
        label: "Job Access",
        help: "View who has access to the job.",
        requires: ["jobs.view"],
        children: [
          {
            key: "job.access.manage",
            label: "Manage Job Access",
            help: "Add, remove, or change job-level access.",
            dangerLevel: "high",
          },
          {
            key: "job.access.auto_add_all_jobs",
            label: "Auto Add To All Jobs",
            help: "Automatically add this user to future eligible jobs based on their contract/service visibility.",
          },
        ],
      },
    ],
  },
  {
    id: "job_import",
    label: "Job Import",
    help: "Upload picksheet PDFs, manage import drafts, commit jobs, and control HydraTec watchers.",
    nodes: [
      {
        key: "job_import.view",
        label: "Job Import Access",
        help: "Open the Job Import page.",
        children: [
          {
            key: "job_import.upload",
            label: "Upload New",
            help: "Upload picksheet PDFs and create new import drafts.",
          },
          {
            key: "jobs.create",
            label: "Create Manual Job",
            help: "Open manual entry and create jobs without importing a picksheet.",
          },
          {
            key: "job_import.commit",
            label: "Commit As A Job",
            help: "Create a real job from a reviewed import draft.",
          },
        ],
      },
      {
        key: "job_import.drafts.view_own",
        label: "Drafts",
        help: "View, edit, retry, and discard drafts created by this user. Included automatically with Job Import Access.",
        requires: ["job_import.view"],
        children: [
          {
            key: "job_import.drafts.view_all",
            label: "View All Drafts",
            help: "See drafts created by everyone.",
          },
          {
            key: "job_import.drafts.edit_others",
            label: "Edit Others' Drafts",
            help: "Edit, retry, or discard drafts created by another user.",
            requires: ["job_import.drafts.view_all"],
            dangerLevel: "high",
          },
        ],
      },
      {
        key: "job_import.hydratec_watchers.view_own",
        label: "HydraTec Watchers",
        help: "View watcher keys created by this user.",
        requires: ["job_import.view"],
        children: [
          {
            key: "job_import.hydratec_watchers.view_all",
            label: "View All Watchers",
            help: "See watcher keys created by everyone.",
          },
          {
            key: "job_import.hydratec_watchers.add",
            label: "Add Watchers",
            help: "Create a new watcher key and setup files.",
          },
          {
            key: "job_import.hydratec_watchers.revoke",
            label: "Revoke Watchers",
            help: "Disable watcher keys so they can no longer upload.",
            dangerLevel: "high",
          },
          {
            key: "job_import.hydratec_watchers.regenerate_own",
            label: "Regenerate Own Watchers",
            help: "Reconnect watcher keys created by this user.",
            dangerLevel: "high",
          },
        ],
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    help: "Inventory visibility, part editing, logs, and vendor price controls.",
    nodes: [
      {
        key: "inventory.view",
        label: "Inventory Access",
        help: "View inventory page and part list.",
        children: [
          { key: "inventory.add_part", label: "Add Parts", help: "Create new parts." },
          { key: "inventory.edit_part", label: "Edit Parts", help: "Edit part profile fields." },
          {
            key: "inventory.delete_part",
            label: "Delete Parts",
            help: "Delete part records.",
            dangerLevel: "high",
          },
          {
            key: "inventory.adjust_quantity",
            label: "Adjust Quantity",
            help: "Change inventory quantities.",
            dangerLevel: "high",
          },
          {
            key: "inventory.logs.view",
            label: "Inventory Logs",
            help: "View movement, audit, cost, and profile change history.",
          },
        ],
      },
      {
        key: "inventory.vendor_prices.import",
        label: "Vendor Price Imports",
        help: "View vendor price import drafts and overviews.",
        requires: ["inventory.view"],
        children: [
          {
            key: "inventory.vendor_prices.review",
            label: "Review And Import",
            help: "Upload vendor price sheets and edit import reviews.",
          },
          {
            key: "inventory.vendor_prices.commit",
            label: "Commit Vendor Imports",
            help: "Apply price changes.",
            requires: ["inventory.vendor_prices.review"],
            dangerLevel: "high",
          },
          {
            key: "inventory.vendor_prices.discard",
            label: "Discard Vendor Imports",
            help: "Discard import batches.",
            requires: ["inventory.vendor_prices.review"],
            dangerLevel: "high",
          },
        ],
      },
    ],
  },
  {
    id: "vendor_orders",
    label: "Vendor Orders",
    help: "Purchase order creation, pending order updates, history, and suppliers.",
    nodes: [
      {
        key: "orders.view",
        label: "Vendor Orders Access",
        help: "View the vendor orders page.",
        children: [],
      },
      {
        key: "orders.to_order.view",
        label: "To Order",
        help: "View the to-order queue and prepare purchase orders.",
        requires: ["orders.view"],
        children: [
          {
            key: "orders.to_order.edit",
            label: "Edit Rows",
            help: "Select items, change quantities, choose vendors, and cancel order lines.",
          },
          {
            key: "orders.generate_send",
            label: "Review And Send",
            help: "Review pending purchase orders and send them to suppliers.",
          },
        ],
      },
      {
        key: "orders.pending.view",
        label: "Pending Order Updates",
        help: "View pending order updates.",
        requires: ["orders.view"],
        children: [
          {
            key: "orders.mark_received",
            label: "Mark Received",
            help: "Mark ordered items received.",
          },
          {
            key: "orders.revert_received",
            label: "Revert Received",
            help: "Undo received status for selected items.",
            dangerLevel: "high",
          },
          { key: "orders.mark_pickup", label: "Mark Pickup", help: "Set supplier pickup." },
          {
            key: "orders.mark_jobsite_delivery",
            label: "Mark Jobsite Delivery",
            help: "Set jobsite delivery.",
          },
          {
            key: "orders.clear_delivery_status",
            label: "Clear Delivery Status",
            help: "Remove pickup or delivery status.",
          },
          {
            key: "orders.cancel",
            label: "Cancel Pending Orders",
            help: "Cancel pending orders.",
            dangerLevel: "high",
          },
        ],
      },
      {
        key: "orders.history.view",
        label: "Order History",
        help: "View sent and completed order history.",
        requires: ["orders.view"],
        children: [
          {
            key: "orders.history.delete",
            label: "Delete Order History",
            help: "Delete historical order records.",
            dangerLevel: "high",
          },
        ],
      },
      {
        key: "orders.suppliers.manage",
        label: "Supplier Directory",
        help: "Add and edit supplier email directory records.",
        requires: ["orders.view"],
        children: [],
      },
    ],
  },
  {
    id: "estimates",
    label: "Estimates",
    help: "Estimate dashboard, estimate actions, catalog access, and setup.",
    nodes: [
      {
        key: "estimates.view",
        label: "Estimates Access",
        help: "View active and archived estimates and open sheets read-only.",
        children: [
          { key: "estimates.create", label: "Create Estimates", help: "Create new estimates." },
          {
            key: "estimates.edit_info",
            label: "Edit Info",
            help: "Edit estimate title, project info, location, dates, estimator, and metadata.",
          },
          {
            key: "estimates.pricing_controls.edit",
            label: "Edit Pricing Controls",
            help: "Edit labor rates, fees, overhead, profit, tax, and pricing controls.",
          },
          {
            key: "estimates.edit",
            label: "Edit Workbook",
            help: "Edit workbook quantities, materials, manual costs, custom parts, and sheet inputs.",
          },
          {
            key: "estimates.archive",
            label: "Archive/Restore/Delete Estimates",
            help: "Archive, restore, or delete estimates.",
            dangerLevel: "high",
          },
          { key: "estimates.change_status", label: "Edit Status", help: "Update bid/status fields." },
          { key: "estimates.pdf.generate", label: "Export PDF", help: "Export estimate PDFs." },
          {
            key: "estimates.variants.manage",
            label: "Manage Sheets",
            help: "Add, rename, or delete estimate sheets.",
          },
        ],
      },
    ],
  },
  {
    id: "users",
    label: "Manage Users",
    help: "User accounts, roles, permission editing, and audits.",
    nodes: [
      {
        key: "users.view",
        label: "User Management Access",
        help: "View Manage Users.",
        children: [
          { key: "users.add", label: "Add Users", help: "Create user accounts." },
          { key: "users.change_role", label: "Change Roles", help: "Assign roles to users." },
          { key: "users.reset_password", label: "Reset Passwords", help: "Reset user passwords." },
          {
            key: "users.terminate",
            label: "Terminate Access",
            help: "Deactivate user access.",
            dangerLevel: "high",
          },
          {
            key: "users.password_resets.manage",
            label: "Manage Password Reset Requests",
            help: "Approve or reject reset requests.",
          },
        ],
      },
      {
        key: "users.permissions.edit",
        label: "Permission Management",
        help: "Open and edit user and role permissions.",
        requires: ["users.view"],
        children: [
          {
            key: "users.super_admin.assign",
            label: "Assign Super Admin",
            help: "Toggle chosen Super Admin users.",
            dangerLevel: "high",
          },
          {
            key: "users.permissions.audit.view",
            label: "View Permission Audit",
            help: "View user and role permission audit history.",
          },
        ],
      },
    ],
  },
  {
    id: "dev",
    label: "Survey / Dev Tools",
    help: "Developer-only survey admin and system tools.",
    nodes: [
      {
        key: "dev.survey.view",
        label: "Survey Admin",
        help: "View the developer survey admin area.",
        children: [
          { key: "dev.survey.create", label: "Create Surveys", help: "Create survey rounds." },
          { key: "dev.survey.edit", label: "Edit Surveys", help: "Edit draft survey rounds." },
          {
            key: "dev.survey.launch_close",
            label: "Launch/Close Surveys",
            help: "Launch active rounds or close survey rounds.",
          },
          { key: "dev.survey.results.view", label: "View Survey Results", help: "View survey results." },
          { key: "dev.survey.pdf.export", label: "Export Survey PDFs", help: "Download survey PDF exports." },
        ],
      },
    ],
  },
] as const satisfies readonly PermissionHierarchyGroup[];

function collectNodeKeys(nodes: readonly PermissionNode[]): PermissionKey[] {
  return nodes.flatMap((node) => [
    node.key,
    ...collectNodeKeys(node.children ?? []),
  ]);
}

function collectNodeMetadata(
  nodes: readonly PermissionNode[],
  parentKey?: PermissionKey,
  entries: Array<[PermissionKey, { node: PermissionNode; parentKey?: PermissionKey }]> = [],
) {
  for (const node of nodes) {
    entries.push([node.key, { node, parentKey }]);
    collectNodeMetadata(node.children ?? [], node.key, entries);
  }
  return entries;
}

export const PERMISSION_NODE_BY_KEY = Object.fromEntries(
  PERMISSION_HIERARCHY.flatMap((group) => collectNodeMetadata(group.nodes)),
) as Record<PermissionKey, { node: PermissionNode; parentKey?: PermissionKey }>;

export const PERMISSION_PARENT_BY_KEY = Object.fromEntries(
  Object.entries(PERMISSION_NODE_BY_KEY)
    .filter((entry): entry is [PermissionKey, { node: PermissionNode; parentKey: PermissionKey }] =>
      Boolean(entry[1].parentKey),
    )
    .map(([key, metadata]) => [key, metadata.parentKey]),
) as Partial<Record<PermissionKey, PermissionKey>>;

export function getPermissionLabel(key: PermissionKey): string {
  return PERMISSION_NODE_BY_KEY[key]?.node.label ?? key;
}

export function getPermissionHelp(key: PermissionKey): string {
  return PERMISSION_NODE_BY_KEY[key]?.node.help ?? "";
}

export function getPermissionRequirements(key: PermissionKey): PermissionKey[] {
  const requirements: PermissionKey[] = [...(PERMISSION_NODE_BY_KEY[key]?.node.requires ?? [])];
  let current = PERMISSION_PARENT_BY_KEY[key];
  while (current) {
    requirements.push(current);
    for (const requiredKey of PERMISSION_NODE_BY_KEY[current]?.node.requires ?? []) {
      requirements.push(requiredKey);
    }
    current = PERMISSION_PARENT_BY_KEY[current];
  }
  return Array.from(new Set(requirements));
}

export const AUTO_ADD_JOB_ACCESS_KEY = "job.access.auto_add_all_jobs" as const;

export const JOB_DETAIL_TAB_ACCESS_KEYS = [
  "job.puller.view",
  "job.delivery.view",
  "job.preorder.view",
  "job.stock_back.view",
  "job.purchase_order.view",
  "job.notes.view",
] as const satisfies readonly PermissionKey[];

export function canUseAutoAddJobAccess(
  permissions: Partial<Record<PermissionKey, boolean>>,
): boolean {
  return (
    canAccessJobDirectory(permissions) &&
    permissions["job.access.view"] === true &&
    JOB_DETAIL_TAB_ACCESS_KEYS.some((key) => permissions[key] === true)
  );
}

export function canAutoAddJobAccessForJobType(
  permissions: Partial<Record<PermissionKey, boolean>>,
  isServiceJob: boolean,
): boolean {
  if (permissions[AUTO_ADD_JOB_ACCESS_KEY] !== true) return false;
  if (!canUseAutoAddJobAccess(permissions)) return false;
  return isServiceJob
    ? permissions["jobs.view_service_jobs"] === true
    : permissions["jobs.view_contract_jobs"] === true;
}

export function getHierarchyGroupKeys(groupId: PermissionHierarchyGroup["id"]): PermissionKey[] {
  const group = PERMISSION_HIERARCHY.find((entry) => entry.id === groupId);
  return group ? collectNodeKeys(group.nodes) : [];
}

export function isDeveloperOnlyPermission(key: PermissionKey): boolean {
  return key.startsWith("dev.");
}

const WRITE_OR_ADMIN_ONLY_KEYS = new Set<PermissionKey>([
  "jobs.manage_hydratec_watchers",
  "jobs.delete",
  "job_import.drafts.view_all",
  "job_import.drafts.edit_others",
  "job_import.hydratec_watchers.view_own",
  "job_import.hydratec_watchers.view_all",
  "job_import.hydratec_watchers.add",
  "job_import.hydratec_watchers.revoke",
  "job_import.hydratec_watchers.regenerate_own",
  "job.puller.delete_line",
  "job.purchase_order.edit_unit_cost",
  "job.access.manage",
  "inventory.add_part",
  "inventory.edit_part",
  "inventory.delete_part",
  "inventory.adjust_quantity",
  "inventory.logs.view",
  "inventory.cost_history.view",
  "inventory.vendor_prices.import",
  "inventory.vendor_prices.review",
  "inventory.vendor_prices.commit",
  "inventory.vendor_prices.discard",
  "orders.view",
  "orders.to_order.view",
  "orders.to_order.edit",
  "orders.generate_send",
  "orders.pending.view",
  "orders.cancel",
  "orders.mark_received",
  "orders.revert_received",
  "orders.mark_pickup",
  "orders.mark_jobsite_delivery",
  "orders.clear_delivery_status",
  "orders.history.view",
  "orders.history.delete",
  "orders.suppliers.manage",
  "users.view",
  "users.add",
  "users.change_role",
  "users.reset_password",
  "users.terminate",
  "users.password_resets.manage",
  "users.permissions.edit",
  "users.super_admin.assign",
  "users.permissions.audit.view",
  "dev.survey.view",
  "dev.survey.create",
  "dev.survey.edit",
  "dev.survey.launch_close",
  "dev.survey.results.view",
  "dev.survey.pdf.export",
]);

const ESTIMATE_KEYS = new Set<PermissionKey>(
  ALL_PERMISSION_KEYS.filter((key) => key.startsWith("estimates.")),
);

const EVERYONE_VIEW_KEYS = new Set<PermissionKey>([
  "calendar.view",
  "jobs.view",
  "jobs.view_contract_jobs",
  "job.puller.view",
  "job.delivery.view",
  "job.notes.view",
  "job.access.view",
  "inventory.view",
]);

const EDITOR_JOB_KEYS = new Set<PermissionKey>([
  "calendar.create",
  "calendar.edit",
  "calendar.delete",
  "jobs.import",
  "job_import.view",
  "job_import.upload",
  "job_import.drafts.view_own",
  "job_import.commit",
  "jobs.create",
  "jobs.edit_metadata",
  "job.puller.pull_from_shop",
  "job.puller.order",
  "job.puller.edit_line",
  "job.puller.add_line",
  "job.puller.import_update_pdf",
  "job.delivery.edit",
  "job.delivery.mark_delivered",
  "job.delivery.mark_pickup",
  "job.delivery.partial_delivery",
  "job.preorder.view",
  "job.preorder.edit",
  "job.preorder.receive",
  "job.preorder.undo_receive",
  "job.stock_back.view",
  "job.stock_back.create",
  "job.stock_back.undo",
  "job.notes.add",
  "job.notes.edit",
  "job.notes.delete",
  "job.notes.upload_packing_slips",
]);

export function defaultRoleAllows(role?: RoleKey | null): Set<PermissionKey> {
  const allowed = new Set<PermissionKey>();

  for (const key of EVERYONE_VIEW_KEYS) allowed.add(key);
  for (const key of EDITOR_JOB_KEYS) {
    if (
      role === "ADMIN" ||
      role === "PROJECT_MANAGER" ||
      role === "DESIGNER" ||
      role === "SALES" ||
      role === "EDITOR"
    ) {
      allowed.add(key);
    }
  }

  if (role === "ADMIN" || role === "PROJECT_MANAGER") {
    allowed.add("job.stock_back.view");
    allowed.add("job.stock_back.create");
    allowed.add("job.stock_back.undo");
    allowed.add("inventory.view");
  }

  if (role === "ADMIN" || role === "SALES") {
    for (const key of ESTIMATE_KEYS) allowed.add(key);
  }

  if (role === "ADMIN") {
    for (const key of WRITE_OR_ADMIN_ONLY_KEYS) allowed.add(key);
    allowed.add("job.purchase_order.view");
    allowed.add("job.access.manage");
  }

  if (role) {
    allowed.add("jobs.view_contract_jobs");
    allowed.add("jobs.view_service_jobs");
  }

  return allowed;
}

export const ROLE_TEMPLATE_SEED = ([
  "ADMIN",
  "PROJECT_MANAGER",
  "DESIGNER",
  "SALES",
  "EDITOR",
  "VIEWER",
] as const).flatMap((role) => {
  const allowed = defaultRoleAllows(role);
  return ALL_PERMISSION_KEYS.map((permissionKey) => ({
    role,
    permissionKey,
    effect: allowed.has(permissionKey) ? "ALLOW" : "DENY",
  }));
});

export const ROLE_LOCKED_ALLOW_KEYS = new Set<PermissionKey>([
  "calendar.view",
  "calendar.create",
  "calendar.edit",
  "calendar.delete",
]);

export const ROLE_PERMISSION_HIDDEN_GROUP_IDS = new Set<string>(["calendar", "dev"]);

export function isRolePermissionGroupHidden(groupId: string): boolean {
  return ROLE_PERMISSION_HIDDEN_GROUP_IDS.has(groupId);
}

export function isRoleLockedPermission(key: PermissionKey): boolean {
  return ROLE_LOCKED_ALLOW_KEYS.has(key);
}

/** Implied permissions are always on while their parent toggle is enabled. */
export function isPermissionToggleLocked(
  key: PermissionKey,
  permissions: Partial<Record<PermissionKey, boolean>>,
): boolean {
  return (
    (key === "job_import.drafts.view_own" && permissions["job_import.view"] === true) ||
    (key === "job.notes.edit" && permissions["job.notes.add"] === true) ||
    (key === "inventory.cost_history.view" && permissions["inventory.logs.view"] === true)
  );
}

function formatRequirementList(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function getAutoAddJobAccessDisabledReason(
  permissions: Partial<Record<PermissionKey, boolean>>,
): string {
  if (!canAccessJobDirectory(permissions)) {
    return "Requires Job Visibility with Contract or Service scope enabled.";
  }
  if (permissions["job.access.view"] !== true) {
    return "Requires Job Access to be enabled first.";
  }
  return "Requires at least one job tab permission (Overview, Delivery, Preorder, Stock In, Purchase Order, or Notes).";
}

/** Human-readable explanation for why a permission toggle is locked or disabled. */
export function getPermissionLockReason(
  key: PermissionKey,
  permissions: Partial<Record<PermissionKey, boolean>>,
): string | null {
  if (isRoleLockedPermission(key)) {
    return "This permission is always enabled for every role.";
  }

  if (isPermissionToggleLocked(key, permissions)) {
    if (key === "job_import.drafts.view_own") {
      return "Always on while Job Import Access is enabled.";
    }
    if (key === "job.notes.edit") {
      return "Always on while Add/Edit Notes is enabled.";
    }
    if (key === "inventory.cost_history.view") {
      return "Always on while Inventory Logs is enabled.";
    }
    return "Automatically enabled by another permission.";
  }

  if (key === AUTO_ADD_JOB_ACCESS_KEY && !canUseAutoAddJobAccess(permissions)) {
    return getAutoAddJobAccessDisabledReason(permissions);
  }

  const unmetRequirements = getPermissionRequirements(key).filter(
    (requiredKey) => permissions[requiredKey] !== true,
  );
  if (unmetRequirements.length > 0) {
    const labels = unmetRequirements.map((requiredKey) => getPermissionLabel(requiredKey));
    return `Requires ${formatRequirementList(labels)} to be enabled first.`;
  }

  return null;
}

export function hasJobTypeVisibility(
  permissions: Partial<Record<PermissionKey, boolean>>,
): boolean {
  return (
    permissions["jobs.view_contract_jobs"] === true ||
    permissions["jobs.view_service_jobs"] === true
  );
}

/** True when the user can open All Jobs / calendar job lists. */
export function canAccessJobDirectory(
  permissions: Partial<Record<PermissionKey, boolean>>,
): boolean {
  return (
    permissions["jobs.view"] === true ||
    permissions["jobs.view_contract_jobs"] === true ||
    permissions["jobs.view_service_jobs"] === true
  ) && hasJobTypeVisibility(permissions);
}

export type AppRouteContext = {
  permissions: Partial<Record<PermissionKey, boolean>>;
  isDeveloper?: boolean;
  isSuperAdmin?: boolean;
};

function hasElevatedAppAccess(ctx: AppRouteContext): boolean {
  return ctx.isDeveloper === true || ctx.isSuperAdmin === true;
}

function hasPermissionInContext(
  ctx: AppRouteContext,
  key: PermissionKey,
): boolean {
  if (hasElevatedAppAccess(ctx)) return true;
  return ctx.permissions[key] === true;
}

/** Calendar requires both calendar access and at least one visible job type. */
export function canAccessCalendar(ctx: AppRouteContext): boolean {
  if (hasElevatedAppAccess(ctx)) return true;
  return (
    ctx.permissions["calendar.view"] === true &&
    canAccessJobDirectory(ctx.permissions)
  );
}

const APP_ROUTE_PRIORITY: Array<{
  path: string;
  canAccess: (ctx: AppRouteContext) => boolean;
}> = [
  { path: "/", canAccess: canAccessCalendar },
  {
    path: "/jobs",
    canAccess: (ctx) => hasPermissionInContext(ctx, "job_import.view"),
  },
  {
    path: "/parts",
    canAccess: (ctx) => hasPermissionInContext(ctx, "inventory.view"),
  },
  {
    path: "/admin/jobs",
    canAccess: (ctx) =>
      hasElevatedAppAccess(ctx) || canAccessJobDirectory(ctx.permissions),
  },
  {
    path: "/admin/orders",
    canAccess: (ctx) => hasPermissionInContext(ctx, "orders.view"),
  },
  {
    path: "/estimates",
    canAccess: (ctx) => hasPermissionInContext(ctx, "estimates.view"),
  },
  {
    path: "/admin/users",
    canAccess: (ctx) => hasPermissionInContext(ctx, "users.view"),
  },
  {
    path: "/dev/survey",
    canAccess: (ctx) => ctx.isDeveloper === true,
  },
];

/** First sidebar destination this user can open; null when nothing is allowed. */
export function getFirstAccessibleAppRoute(ctx: AppRouteContext): string | null {
  for (const route of APP_ROUTE_PRIORITY) {
    if (route.canAccess(ctx)) return route.path;
  }
  return null;
}

export function applyImpliedPermissions(
  permissions: Record<PermissionKey, boolean>,
): Record<PermissionKey, boolean> {
  const next = { ...permissions };
  if (next["job_import.view"] === true) {
    next["job_import.drafts.view_own"] = true;
  }
  if (next["job.notes.add"] === true) {
    next["job.notes.edit"] = true;
  } else {
    next["job.notes.edit"] = false;
  }
  if (next["inventory.logs.view"] === true) {
    next["inventory.cost_history.view"] = true;
  } else {
    next["inventory.cost_history.view"] = false;
  }
  if (next["orders.to_order.edit"] || next["orders.generate_send"]) {
    next["orders.to_order.view"] = true;
  }
  if (next["orders.to_order.view"] !== true) {
    next["orders.to_order.edit"] = false;
    next["orders.generate_send"] = false;
  }
  if (next["jobs.view_contract_jobs"] || next["jobs.view_service_jobs"]) {
    next["jobs.view"] = true;
  }
  if (next["jobs.view"] !== true) {
    next["jobs.view_contract_jobs"] = false;
    next["jobs.view_service_jobs"] = false;
  } else if (!next["jobs.view_contract_jobs"] && !next["jobs.view_service_jobs"]) {
    next["jobs.view_contract_jobs"] = true;
    next["jobs.view_service_jobs"] = true;
  }
  return next;
}

export function applyRoleLockedPermissions(
  permissions: Record<PermissionKey, boolean>,
): Record<PermissionKey, boolean> {
  const next = { ...permissions };
  for (const key of ROLE_LOCKED_ALLOW_KEYS) {
    next[key] = true;
  }
  return applyImpliedPermissions(next);
}

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSION_KEYS as readonly string[]).includes(value);
}
