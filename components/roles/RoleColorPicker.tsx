"use client";

import { useEffect, useMemo, useState } from "react";
import { HexColorPicker } from "react-colorful";
import RoleBadge from "@/components/roles/RoleBadge";
import {
  encodeHexColor,
  isColorTaken,
  normalizeHex,
  parseRoleBadgeColor,
  roleColorToHex,
  type RoleColorOwner,
} from "@/lib/roleBadgeColor";

type RoleColorPickerProps = {
  colorClass: string;
  onChange: (colorClass: string) => void;
  allRoles: RoleColorOwner[];
  excludeRoleKey?: string;
  disabled?: boolean;
  /** When set, renders the unified badge appearance panel (preview + picker + taken colors). */
  previewName?: string;
};

const PANEL_PICKER_HEIGHT = "100%";

export default function RoleColorPicker({
  colorClass,
  onChange,
  allRoles,
  excludeRoleKey,
  disabled = false,
  previewName,
}: RoleColorPickerProps) {
  const parsed = parseRoleBadgeColor(colorClass);
  const [hexInput, setHexInput] = useState(parsed.hex);

  useEffect(() => {
    setHexInput(parseRoleBadgeColor(colorClass).hex);
  }, [colorClass]);

  const takenColors = useMemo(
    () =>
      allRoles
        .filter((role) => role.key !== excludeRoleKey)
        .map((role) => ({
          hex: roleColorToHex(role.colorClass),
          key: role.key,
          name: role.name,
        })),
    [allRoles, excludeRoleKey],
  );

  const collision = isColorTaken(hexInput, allRoles, excludeRoleKey);

  const applyHex = (nextHex: string) => {
    const normalized = normalizeHex(nextHex);
    if (!normalized) return;
    setHexInput(normalized);
    onChange(encodeHexColor(normalized));
  };

  const handleHexInputBlur = () => {
    const normalized = normalizeHex(hexInput);
    if (normalized) {
      applyHex(normalized);
    } else {
      setHexInput(parsed.hex);
    }
  };

  const disabledClass = disabled ? "pointer-events-none opacity-60" : "";

  if (previewName !== undefined) {
    return (
      <div
        className={`overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50 dark:border-slate-700/50 dark:bg-slate-900/20 ${disabledClass}`}
      >
        <div className="grid gap-3 p-3 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:items-stretch sm:gap-4 sm:p-4">
          <div className="flex flex-col">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
              Preview
            </p>
            <div className="flex min-h-[5.5rem] flex-1 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-2 py-3 dark:border-slate-600 dark:bg-slate-950/40 sm:min-h-[6rem] lg:min-h-[6.5rem]">
              <RoleBadge
                name={previewName.trim() || "Role name"}
                colorClass={colorClass}
                size="md"
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
              Pick color
            </p>
            <div className="flex min-h-[5.5rem] w-full flex-1 flex-col rounded-lg border border-slate-200 bg-white p-1.5 dark:border-slate-700/50 dark:bg-slate-950/40 sm:min-h-[6rem] sm:p-2 lg:min-h-[6.5rem] [&_.react-colorful]:h-full [&_.react-colorful]:w-full">
              <HexColorPicker
                color={parsed.hex}
                onChange={applyHex}
                style={{ width: "100%", height: PANEL_PICKER_HEIGHT }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/60 px-3 py-2 dark:border-slate-700/50 dark:bg-slate-950/20 sm:gap-3 sm:px-4 sm:py-2.5">
          <span className="w-14 shrink-0 text-xs font-semibold text-slate-500">Hex code</span>
          <input
            type="text"
            value={hexInput}
            disabled={disabled}
            onChange={(event) => setHexInput(event.target.value.toUpperCase())}
            onBlur={handleHexInputBlur}
            placeholder="#RRGGBB"
            className="w-[6.75rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span
            className="h-8 w-8 shrink-0 rounded-lg border border-slate-300 shadow-sm dark:border-slate-600"
            style={{ backgroundColor: parsed.hex }}
            title={parsed.hex}
          />
          {collision.taken ? (
            <p className="min-w-0 flex-1 text-xs font-semibold text-red-600 dark:text-red-400">
              Used by {collision.owner?.name}
            </p>
          ) : (
            <p className="min-w-0 flex-1 text-xs text-slate-500">Must be unique across all roles</p>
          )}
        </div>

        {takenColors.length > 0 ? (
          <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-700/50 sm:px-4 sm:py-2.5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
              Colors already in use
            </p>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {takenColors.map((entry) => (
                <span
                  key={`${entry.key}-${entry.hex}`}
                  title={`Used by ${entry.name}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300"
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-slate-300/80 dark:border-slate-600"
                    style={{ backgroundColor: entry.hex }}
                  />
                  {entry.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-300">
          Badge color
        </label>
        <div
          className={`rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700/50 dark:bg-slate-900/40 ${disabledClass}`}
        >
          <HexColorPicker
            color={parsed.hex}
            onChange={applyHex}
            style={{ width: "100%", height: 180 }}
          />
          <div className="mt-4 flex items-center gap-3">
            <span
              className="h-10 w-10 shrink-0 rounded-xl border border-slate-300 dark:border-slate-600"
              style={{ backgroundColor: parsed.hex }}
            />
            <input
              type="text"
              value={hexInput}
              disabled={disabled}
              onChange={(event) => setHexInput(event.target.value.toUpperCase())}
              onBlur={handleHexInputBlur}
              placeholder="#RRGGBB"
              className="w-[6.75rem] rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-mono text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>
      </div>

      {collision.taken ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          This color is already used by {collision.owner?.name}. Pick a different color.
        </p>
      ) : null}
    </div>
  );
}

export function isRoleColorValidForSave(
  colorClass: string,
  allRoles: RoleColorOwner[],
  excludeRoleKey?: string,
): boolean {
  const hex = roleColorToHex(colorClass);
  return !isColorTaken(hex, allRoles, excludeRoleKey).taken;
}
