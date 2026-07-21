/**
 * Browser consent store. localStorage-backed, event-driven so scripts and
 * hooks re-check without a page reload. Default state is "undecided", which
 * means no marketing tracking loads until the visitor clicks Accept.
 */
export type ConsentChoice = {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  decided_at: string | null;
};

const KEY = "mkt_consent";
const EVENT = "mkt-consent-change";

export function readConsent(): ConsentChoice {
  if (typeof window === "undefined") {
    return { essential: true, analytics: false, marketing: false, decided_at: null };
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { essential: true, analytics: false, marketing: false, decided_at: null };
    const parsed = JSON.parse(raw) as Partial<ConsentChoice>;
    return {
      essential: true,
      analytics: !!parsed.analytics,
      marketing: !!parsed.marketing,
      decided_at: parsed.decided_at ?? null,
    };
  } catch {
    return { essential: true, analytics: false, marketing: false, decided_at: null };
  }
}

export function writeConsent(next: Omit<ConsentChoice, "essential" | "decided_at">) {
  if (typeof window === "undefined") return;
  const value: ConsentChoice = {
    essential: true,
    analytics: next.analytics,
    marketing: next.marketing,
    decided_at: new Date().toISOString(),
  };
  window.localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
}

export function hasDecidedConsent(): boolean {
  return readConsent().decided_at !== null;
}

export function onConsentChange(cb: (c: ConsentChoice) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb(readConsent());
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
