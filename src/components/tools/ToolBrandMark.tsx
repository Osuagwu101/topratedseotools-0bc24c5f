import sneakWriteLogo from "@/assets/sneakwrite-logo.png";
import type { Tool } from "@/lib/tools-data";
import { getToolLogo } from "@/lib/tools-data";
import { cn } from "@/lib/utils";

type ToolBrandMarkProps = {
  tool: Tool;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const frameSize = {
  sm: "h-10 w-10 rounded-lg",
  md: "h-11 w-11 rounded-xl",
  lg: "h-16 w-16 rounded-2xl",
};

const imageSize = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-12 w-12",
};

const iconSize = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-7 w-7",
};

export function ToolBrandMark({ tool, size = "md", className }: ToolBrandMarkProps) {
  const Icon = tool.icon;
  const hasDomain = Boolean(tool.domain);
  const isSneakWrite = tool.slug === "sneakwrite";
  const logoSrc = isSneakWrite ? sneakWriteLogo : hasDomain ? getToolLogo(tool.domain) : "";
  const hasLogo = Boolean(logoSrc);

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border bg-background shadow-sm",
        frameSize[size],
        className,
      )}
    >
      {hasLogo && (
        <img
          src={logoSrc}
          alt={`${tool.name} logo`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          // SneakWrite uses a bundled, tightly cropped square brand asset.
          className={cn("object-contain", isSneakWrite ? "h-full w-full" : imageSize[size])}
          onError={(event) => {
            event.currentTarget.style.display = "none";
            const fallback = event.currentTarget.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = "flex";
          }}
        />
      )}
      <span
        className={cn(
          "absolute inset-0 items-center justify-center bg-gradient-primary text-primary-foreground",
          hasLogo ? "hidden" : "flex",
        )}
        aria-hidden
      >
        <Icon className={iconSize[size]} />
      </span>
    </span>
  );
}
