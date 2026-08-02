/**
 * Loads the tool overrides once per shell and merges them into the catalogue,
 * which also registers admin-created tools for the synchronous `getTool()`
 * lookups used across dashboards, orders, receipts, and transactions.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { listToolOverrides } from "@/lib/tool-overrides.functions";
import { mergeToolCatalog, type CatalogTool } from "@/lib/tool-catalog";

export function useCatalogRegistration(): CatalogTool[] {
  const { data } = useQuery({
    queryKey: ["tool-overrides"],
    queryFn: () => listToolOverrides(),
    staleTime: 60_000,
  });
  return useMemo(() => mergeToolCatalog(data?.overrides ?? []), [data]);
}
