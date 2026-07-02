import { softwareConfig } from "@/lib/softwareConfig";

type BrandLogoProps = {
  className?: string;
  /** Always render for dark backgrounds (e.g. login). */
  variant?: "auto" | "on-dark" | "on-light";
  src?: string;
  alt?: string;
};

const variantClasses: Record<NonNullable<BrandLogoProps["variant"]>, string> = {
  auto: "brand-logo-auto",
  "on-dark": "brand-logo-on-dark",
  "on-light": "brand-logo-on-light",
};

export default function BrandLogo({
  className = "",
  variant = "auto",
  src,
  alt,
}: BrandLogoProps) {
  return (
    <img
      src={src ?? softwareConfig.logoUrl}
      alt={alt ?? "NorthOps"}
      className={`brand-logo ${variantClasses[variant]} ${className}`.trim()}
      decoding="async"
    />
  );
}
