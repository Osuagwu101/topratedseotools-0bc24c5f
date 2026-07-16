import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Cookie Policy — Top Rated SEO Tools" },
      { name: "description", content: "How Top Rated SEO Tools uses cookies and similar technologies." },
    ],
  }),
  component: () => (
    <LegalPage title="Cookie Policy" updated="July 16, 2026">
      <p>We use cookies and similar technologies to keep you signed in, remember preferences, and understand how the service is used.</p>
      <h2>Types of cookies</h2>
      <ul>
        <li><strong>Essential:</strong> Required for authentication and core functionality</li>
        <li><strong>Preference:</strong> Remember settings like theme and language</li>
        <li><strong>Analytics:</strong> Anonymized usage statistics to improve the product</li>
      </ul>
      <h2>Managing cookies</h2>
      <p>You can control cookies through your browser settings. Disabling essential cookies may break parts of the service.</p>
    </LegalPage>
  ),
});
