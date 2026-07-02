export const HEX_COLOR_PREFIX = "hex:";

export const TAILWIND_COLOR_HEX_MAP: Record<string, string> = {
  "bg-red-600 text-white": "#DC2626",
  "bg-blue-600 text-white": "#2563EB",
  "bg-purple-600 text-white": "#9333EA",
  "bg-green-600 text-white": "#16A34A",
  "bg-amber-600 text-white": "#D97706",
  "bg-slate-600 text-white": "#475569",
  "bg-rose-600 text-white": "#E11D48",
  "bg-indigo-600 text-white": "#4F46E5",
};

export const DEFAULT_ROLE_BADGE_CLASS = "bg-slate-600 text-white";
export const DEFAULT_ROLE_BADGE_HEX = "#475569";

const ROLE_COLOR_CANDIDATES = [
  "#0EA5E9",
  "#14B8A6",
  "#F97316",
  "#EC4899",
  "#8B5CF6",
  "#84CC16",
  "#06B6D4",
  "#F43F5E",
  "#6366F1",
  "#10B981",
  "#EAB308",
  "#78716C",
  "#0284C7",
  "#7C3AED",
  "#BE123C",
];

export type ParsedRoleBadgeColor =
  | { mode: "tailwind"; className: string; hex: string }
  | { mode: "hex"; backgroundColor: string; textColor: string; hex: string };

export function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  return `#${match[1].toUpperCase()}`;
}

export function encodeHexColor(hex: string): string {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    throw new Error("Invalid hex color.");
  }
  return `${HEX_COLOR_PREFIX}${normalized}`;
}

export function getContrastTextColor(hex: string): string {
  const normalized = normalizeHex(hex);
  if (!normalized) return "#FFFFFF";
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#0F172A" : "#FFFFFF";
}

export function parseRoleBadgeColor(colorClass: string | null | undefined): ParsedRoleBadgeColor {
  const value = colorClass?.trim();
  if (!value) {
    return {
      mode: "tailwind",
      className: DEFAULT_ROLE_BADGE_CLASS,
      hex: DEFAULT_ROLE_BADGE_HEX,
    };
  }

  if (value.startsWith(HEX_COLOR_PREFIX)) {
    const hex = normalizeHex(value.slice(HEX_COLOR_PREFIX.length)) ?? DEFAULT_ROLE_BADGE_HEX;
    return {
      mode: "hex",
      backgroundColor: hex,
      textColor: getContrastTextColor(hex),
      hex,
    };
  }

  const hex = TAILWIND_COLOR_HEX_MAP[value] ?? DEFAULT_ROLE_BADGE_HEX;
  return {
    mode: "tailwind",
    className: value,
    hex,
  };
}

export function roleColorToHex(colorClass: string | null | undefined): string {
  return parseRoleBadgeColor(colorClass).hex;
}

export type RoleColorOwner = {
  key: string;
  name: string;
  colorClass: string | null;
};

export function getTakenRoleColors(
  roles: RoleColorOwner[],
  excludeRoleKey?: string,
): Map<string, { key: string; name: string }> {
  const taken = new Map<string, { key: string; name: string }>();
  for (const role of roles) {
    if (excludeRoleKey && role.key === excludeRoleKey) continue;
    const hex = roleColorToHex(role.colorClass);
    if (!taken.has(hex)) {
      taken.set(hex, { key: role.key, name: role.name });
    }
  }
  return taken;
}

export function isColorTaken(
  hex: string,
  roles: RoleColorOwner[],
  excludeRoleKey?: string,
): { taken: boolean; owner?: { key: string; name: string } } {
  const normalized = normalizeHex(hex);
  if (!normalized) return { taken: false };
  const taken = getTakenRoleColors(roles, excludeRoleKey);
  const owner = taken.get(normalized);
  return owner ? { taken: true, owner } : { taken: false };
}

export function findFirstAvailableRoleColor(roles: RoleColorOwner[]): string {
  for (const hex of ROLE_COLOR_CANDIDATES) {
    if (!isColorTaken(hex, roles).taken) {
      return encodeHexColor(hex);
    }
  }
  return encodeHexColor("#64748B");
}

export function isValidRoleBadgeColor(colorClass: string | null | undefined): boolean {
  if (!colorClass?.trim()) return true;
  const value = colorClass.trim();
  if (value.startsWith(HEX_COLOR_PREFIX)) {
    return normalizeHex(value.slice(HEX_COLOR_PREFIX.length)) !== null;
  }
  return value.includes("bg-");
}
