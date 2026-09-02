/**
 * Admin — Currency & International Surcharge settings.
 * Toggles switching + surcharge, shows cached rates, allows manual refresh.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { RefreshCw, Globe } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  getPublicCurrencyConfig,
  refreshExchangeRates,
  updateCurrencySettings,
  listExchangeRateLogs,
} from "@/lib/currency.functions";
import { CURRENCY_META, type SupportedCurrency } from "@/lib/currency-convert";

export const Route = createFileRoute("/admin/settings/currency")({
  head: () => ({
    meta: [{ title: "Currency & Surcharge — Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: CurrencySettingsPage,
});

const ALL: SupportedCurrency[] = ["NGN", "GHS", "KES", "ZAR", "USD"];

function CurrencySettingsPage() {
  const qc = useQueryClient();
  const fetchConfig = useServerFn(getPublicCurrencyConfig);
  const doRefresh = useServerFn(refreshExchangeRates);
  const doUpdate = useServerFn(updateCurrencySettings);
  const fetchLogs = useServerFn(listExchangeRateLogs);

  const { data: config } = useQuery({
    queryKey: ["currency-config"],
    queryFn: () => fetchConfig(),
  });
  const { data: logs } = useQuery({ queryKey: ["exchange-rate-logs"], queryFn: () => fetchLogs() });

  const [switching, setSwitching] = useState(true);
  const [surcharge, setSurcharge] = useState(true);
  const [pct, setPct] = useState(3);
  const [supported, setSupported] = useState<SupportedCurrency[]>(ALL);

  useEffect(() => {
    if (!config) return;
    setSwitching(config.switching_enabled);
    setSurcharge(config.surcharge_enabled);
    setPct(config.surcharge_percent);
    setSupported(config.supported_currencies);
  }, [config]);

  const refreshMut = useMutation({
    mutationFn: () => doRefresh(),
    onSuccess: (r) => {
      toast.success(`Rates updated (${r.updated} currencies)`);
      qc.invalidateQueries({ queryKey: ["currency-config"] });
      qc.invalidateQueries({ queryKey: ["exchange-rate-logs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Rate refresh failed"),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      doUpdate({
        data: {
          switching_enabled: switching,
          surcharge_enabled: surcharge,
          surcharge_percent: pct,
          supported_currencies: supported,
        },
      }),
    onSuccess: () => {
      toast.success("Currency settings saved");
      qc.invalidateQueries({ queryKey: ["currency-config"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  function toggle(code: SupportedCurrency) {
    if (code === "NGN") return; // NGN always supported
    setSupported((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-bold">Currency & Surcharge</h1>
          <p className="text-sm text-muted-foreground">
            Manage multi-currency checkout and the international payment surcharge.
          </p>
        </header>
        <section className="rounded-2xl border bg-card p-6 shadow-card">
          <h2 className="text-base font-semibold">Currency switching</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            When enabled, customers can pay in supported Paystack currencies. NGN customers are
            unaffected.
          </p>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={switching}
              onChange={(e) => setSwitching(e.target.checked)}
            />
            Enable currency switching for customers
          </label>

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Supported currencies
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {ALL.map((code) => {
                const on = supported.includes(code);
                return (
                  <button
                    type="button"
                    key={code}
                    onClick={() => toggle(code)}
                    disabled={code === "NGN"}
                    className={`rounded-md border px-3 py-1.5 text-xs ${on ? "bg-primary text-primary-foreground" : "bg-background"}`}
                  >
                    {code} · {CURRENCY_META[code].symbol}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-6 shadow-card">
          <h2 className="text-base font-semibold">International payment surcharge</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Applied on non-NGN payments to cover Paystack international processing charges. NGN
            payments never carry a surcharge.
          </p>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={surcharge}
              onChange={(e) => setSurcharge(e.target.checked)}
            />
            Add surcharge on international payments
          </label>
          <label className="mt-3 flex items-center gap-3 text-sm">
            <span>Surcharge percent</span>
            <input
              type="number"
              min={0}
              max={25}
              step={0.1}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
            />
            <span className="text-muted-foreground">% (default 3)</span>
          </label>
        </section>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saveMut.isPending ? "Saving…" : "Save settings"}
          </button>
        </div>

        <section className="rounded-2xl border bg-card p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Globe className="h-4 w-4" /> Exchange rates
            </h2>
            <button
              type="button"
              onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshMut.isPending ? "animate-spin" : ""}`} />{" "}
              Refresh rates now
            </button>
          </div>
          <div className="mt-3 overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Currency</th>
                  <th className="px-3 py-2 text-right">Rate (1 NGN)</th>
                  <th className="px-3 py-2 text-right">Fetched</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {config?.rates.map((r) => (
                  <tr key={r.currency} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.currency}</td>
                    <td className="px-3 py-2 text-right">
                      {r.currency === "NGN" ? "—" : r.rate || "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {r.fetched_at ? new Date(r.fetched_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {r.currency === "NGN" ? (
                        "base"
                      ) : r.stale ? (
                        <span className="text-warning">stale</span>
                      ) : (
                        "fresh"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-6 shadow-card">
          <h2 className="text-base font-semibold">Exchange rate logs</h2>
          <div className="mt-3 max-h-80 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Currency</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {(logs?.rows ?? []).map(
                  (row: {
                    id: string;
                    quote_currency: string;
                    rate: number;
                    source: string;
                    fetched_at: string;
                  }) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(row.fetched_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{row.quote_currency}</td>
                      <td className="px-3 py-2 text-right">{row.rate}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{row.source}</td>
                    </tr>
                  ),
                )}
                {(logs?.rows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No rate refreshes yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
