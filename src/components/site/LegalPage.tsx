import type { ReactNode } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <SiteLayout>
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
        <div className="prose prose-neutral dark:prose-invert mt-8 max-w-none space-y-6 text-foreground/90 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_li]:text-sm [&_li]:text-muted-foreground [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </div>
    </SiteLayout>
  );
}
