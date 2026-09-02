import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Top Rated SEO Tools" },
      { name: "description", content: "The terms governing your use of Top Rated SEO Tools." },
    ],
  }),
  component: () => (
    <LegalPage title="Terms of Service" updated="July 16, 2026">
      <p>
        By using Top Rated SEO Tools, you agree to these Terms of Service. Please read them
        carefully.
      </p>
      <h2>Accounts</h2>
      <p>
        You must provide accurate information and are responsible for keeping your credentials
        secure.
      </p>
      <h2>Subscriptions & billing</h2>
      <p>
        Paid plans renew automatically. You may cancel at any time; cancellation takes effect at the
        end of the current billing period.
      </p>
      <h2>Acceptable use</h2>
      <ul>
        <li>No abuse, harassment, or illegal use of the service</li>
        <li>No attempts to disrupt or reverse-engineer the platform</li>
        <li>No generation of content that violates applicable laws</li>
      </ul>
      <h2>Termination</h2>
      <p>We may suspend or terminate accounts that violate these terms.</p>
      <h2>Disclaimer</h2>
      <p>The service is provided "as is" without warranty of any kind.</p>
    </LegalPage>
  ),
});
