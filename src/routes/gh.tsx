import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";

const title = "SEO & AI Tools in Ghana | Top Rated SEO Tools";
const description = "Explore available SEO, AI writing, research and productivity subscriptions for customers in Ghana. Top Rated SEO Tools also serves customers in other supported locations.";

export const Route = createFileRoute("/gh")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://topratedseotools.com/gh" },
    ],
    links: [{ rel: "canonical", href: "https://topratedseotools.com/gh" }],
  }),
  component: MarketPage,
});

function MarketPage() {
  return (
    <SiteLayout>
      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <p className="text-sm font-semibold text-primary">Top Rated SEO Tools · Ghana</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">SEO & AI Tool Subscriptions in Ghana</h1>
        <p className="mt-5 max-w-3xl text-lg text-muted-foreground">Compare individual subscriptions for writing, SEO, research and productivity. Find the tools you need without paying for an unnecessary bundle.</p>
        <section className="mt-10 rounded-2xl border bg-card p-6 shadow-card">
          <h2 className="text-xl font-semibold">Explore available subscriptions</h2>
          <p className="mt-3 text-muted-foreground">Check the current prices and access options for each product. Prices may be displayed in Ghanaian Cedis (GHS) where supported. Payment methods and eligibility are shown during checkout.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/pricing" className="rounded-md bg-gradient-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Compare prices</Link>
            <Link to="/tools" className="rounded-md border px-5 py-3 text-sm font-semibold">Browse all tools</Link>
            <Link to="/turnitin" className="rounded-md border px-5 py-3 text-sm font-semibold">Turnitin Checks</Link>
          </div>
        </section>
        <section className="mt-10">
          <h2 className="text-2xl font-bold">Popular categories</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border p-5"><h3 className="font-semibold">AI writing and editing</h3><p className="mt-2 text-sm text-muted-foreground">Explore subscriptions for drafting, rewriting and proofreading.</p><Link to="/tools" className="mt-3 inline-block text-sm font-semibold text-primary">Browse writing tools →</Link></div>
            <div className="rounded-xl border p-5"><h3 className="font-semibold">SEO and research</h3><p className="mt-2 text-sm text-muted-foreground">Discover keyword research, content and productivity tools.</p><Link to="/tools" className="mt-3 inline-block text-sm font-semibold text-primary">Browse SEO tools →</Link></div>
          </div>
        </section>
        <section className="mt-10">
          <h2 className="text-2xl font-bold">Frequently asked questions</h2>
          <h3 className="mt-5 font-semibold">Is Top Rated SEO Tools only available in Ghana?</h3>
          <p className="mt-2 text-muted-foreground">No. We welcome customers internationally where the selected products and payment methods are supported. Available currencies and payment methods can vary.</p>
          <h3 className="mt-5 font-semibold">Can I buy individual subscriptions?</h3>
          <p className="mt-2 text-muted-foreground">Yes. Select the product and available plan that fits your needs; you do not have to buy an entire software bundle.</p>
          <h3 className="mt-5 font-semibold">How do Turnitin Checks work?</h3>
          <p className="mt-2 text-muted-foreground">Turnitin Checks are self-service: purchase check credits, submit documents and download available reports from your account history.</p>
        </section>
      </main>
    </SiteLayout>
  );
}
