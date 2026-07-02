"use client";

import { parseRoleBadgeColor } from "@/lib/roleBadgeColor";

type RoleBadgeProps = {
  name: string;
  colorClass?: string | null;
  className?: string;
  size?: "xs" | "sm" | "md";
};

const sizeClasses = {
  xs: "rounded-lg px-3 py-1 text-xs font-semibold",
  sm: "rounded-lg px-3 py-1.5 text-sm font-semibold",
  md: "rounded-xl px-4 py-2 text-sm font-semibold",
};

export default function RoleBadge({
  name,
  colorClass,
  className = "",
  size = "xs",
}: RoleBadgeProps) {
  const parsed = parseRoleBadgeColor(colorClass);
  const sizeClass = sizeClasses[size];

  if (parsed.mode === "hex") {
    return (
      <span
        className={`inline-block ${sizeClass} ${className}`}
        style={{ backgroundColor: parsed.backgroundColor, color: parsed.textColor }}
      >
        {name}
      </span>
    );
  }

  return (
    <span className={`inline-block ${sizeClass} ${parsed.className} ${className}`}>{name}</span>
  );
}
