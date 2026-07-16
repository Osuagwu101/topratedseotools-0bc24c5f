import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Nexus AI" },
      { name: "description", content: "How Nexus AI collects, uses, and protects your data." },
    ],
  }),
  component: () => (
    <LegalPage title="Privacy Policy" updated="July 16, 2026">
      <p>
        This Privacy Policy describes how Nexus AI ("we", "us", or "our") collects, uses, and shares information when you use our service.
      </p>
      <h2>Information we collect</h2>
      <p>Account information you provide (name, email), authentication data, billing information processed via Stripe, and usage data such as which tools you access.</p>
      <h2>How we use information</h2>
      <ul>
        <li>To operate, maintain, and improve the service</li>
        <li>To process payments and manage subscriptions</li>
        <li>To communicate with you about your account</li>
        <li>To detect, prevent, and address abuse and fraud</li>
      </ul>
      <h2>Data retention</h2>
      <p>We retain account data for as long as your account is active. You may delete your account at any time.</p>
      <h2>Your rights</h2>
      <p>You have the right to access, correct, or delete your personal data. Contact us at privacy@nexusai.app.</p>
      <h2>Contact</h2>
      <p>For questions about this policy, email privacy@nexusai.app.</p>
    </LegalPage>
  ),
});
