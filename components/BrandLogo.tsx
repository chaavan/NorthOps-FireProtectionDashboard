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
  // A full-colour mark opts out of the tone-flattening filters entirely —
  // brightness(0) invert(1) would turn a two-colour logo into a white blob.
  const treatment = softwareConfig.logoPreserveColor
    ? "brand-logo-preserve"
    : variantClasses[variant];

  return (
    <img
      src={src ?? softwareConfig.logoUrl}
      alt={alt ?? softwareConfig.name}
      className={`brand-logo ${treatment} ${className}`.trim()}
      decoding="async"
    />
  );
}
