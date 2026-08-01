import { useEffect, useState } from "react";

/**
 * True once React has hydrated on the client. Use it to gate interactive
 * controls (e.g. auth submit buttons) so a click before hydration cannot
 * trigger a native browser form submission.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
