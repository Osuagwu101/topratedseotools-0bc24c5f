import type { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { useCatalogRegistration } from "@/hooks/use-catalog-registration";

export function SiteLayout({ children }: { children: ReactNode }) {
  // Makes admin-created tools resolvable across every customer page.
  useCatalogRegistration();
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
