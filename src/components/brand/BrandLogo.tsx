import bundledLogoUrl from "@/assets/top-rated-seo-tools-logo.png";
import { APP_NAME } from "@/lib/site-config";
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
      src={bundledLogoUrl}
      alt={alt}
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      decoding="async"
    />
  );
}
