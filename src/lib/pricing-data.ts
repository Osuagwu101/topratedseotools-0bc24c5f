export interface PricingPlan {
  id: "free" | "pro" | "team";
  name: string;
  tagline: string;
  monthly: number;
  yearly: number;
  featured?: boolean;
  features: string[];
  cta: string;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: "Starter",
    tagline: "Try the platform, no card required.",
    monthly: 0,
    yearly: 0,
    features: [
      "Access to 8 free tools",
      "50 generations / month",
      "Community support",
      "Standard response speed",
    ],
    cta: "Get started",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Everything you need to ship.",
    monthly: 19,
    yearly: 15,
    featured: true,
    features: [
      "All 20+ premium tools",
      "Unlimited generations",
      "Priority AI models",
      "7-day free trial",
      "Email support",
      "Export & API access",
    ],
    cta: "Start free trial",
  },
  {
    id: "team",
    name: "Team",
    tagline: "Collaboration & admin controls.",
    monthly: 49,
    yearly: 39,
    features: [
      "Everything in Pro",
      "Up to 10 seats",
      "Shared workspaces",
      "SSO & audit logs",
      "Dedicated support",
    ],
    cta: "Start free trial",
  },
];
