import { APP_NAME } from "@/lib/site-config";
import { BRAND_LOGO_PATH } from "@/lib/brand-assets";
import { cn } from "@/lib/utils";

export function BrandLogo({
  size = 36,
  className,
  alt = `${APP_NAME} logo`,
}: {
  size?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={BRAND_LOGO_PATH}
      alt={alt}
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      decoding="async"
    />
  );
}
