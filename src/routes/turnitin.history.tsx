import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/turnitin/history")({
  // Keep old bookmarks functional without maintaining a duplicate History page.
  beforeLoad: () => {
    throw redirect({ to: "/turnitin", replace: true });
  },
});
