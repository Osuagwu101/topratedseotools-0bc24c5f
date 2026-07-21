/**
 * Admin — customer review moderation.
 * View, filter, moderate; add private notes; browse revision history.
 * Admins cannot rewrite a customer's rating/title/body from this UI.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Star, ShieldCheck, ChevronDown, ChevronUp, Eye, EyeOff, Check, X, Clock } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  adminListReviews,
  adminModerateReview,
  adminListReviewVersions,
  type AdminReview,
  type ReviewStatus,
} from "@/lib/reviews.functions";
import { TOOLS } from "@/lib/tools-data";

export const Route = createFileRoute("/admin/reviews")({
  head: () => ({ meta: [{ title: "Reviews — Admin" }] }),
  component: () => (
    <AdminShell>
      <ReviewsPage />
    </AdminShell>
  ),
});

const STATUSES: ReviewStatus[] = ["pending", "approved", "rejected", "hidden"];

function ReviewsPage() {
  const [status, setStatus] = useState<ReviewStatus | "all">("pending");
  const [toolSlug, setToolSlug] = useState<string>("");
  const [minRating, setMinRating] = useState<number>(0);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-reviews", status, toolSlug, minRating],
    queryFn: () =>
      adminListReviews({
        data: {
          status: status === "all" ? undefined : status,
          tool_slug: toolSlug || undefined,
          min_rating: minRating || undefined,
        },
      }),
  });

  const reviews = data?.reviews ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Approve, reject or hide customer reviews. Only approved reviews appear publicly.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-4 text-sm">
          <label>
            <div className="text-xs text-muted-foreground">Status</div>
            <select
              className="rounded-md border bg-background px-2 py-1.5"
              value={status}
              onChange={(e) => setStatus(e.target.value as ReviewStatus | "all")}
            >
              <option value="all">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            <div className="text-xs text-muted-foreground">Tool</div>
            <select
              className="rounded-md border bg-background px-2 py-1.5"
              value={toolSlug}
              onChange={(e) => setToolSlug(e.target.value)}
            >
              <option value="">All tools</option>
              {TOOLS.map((t) => (
                <option key={t.slug} value={t.slug}>{t.name}</option>
              ))}
            </select>
          </label>
          <label>
            <div className="text-xs text-muted-foreground">Min rating</div>
            <select
              className="rounded-md border bg-background px-2 py-1.5"
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value))}
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n === 0 ? "Any" : `${n}+`}</option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No reviews match these filters.
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <ReviewRow key={r.id} review={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewRow({ review }: { review: AdminReview }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(review.moderation_note ?? "");
  const [showHistory, setShowHistory] = useState(false);
  const tool = useMemo(() => TOOLS.find((t) => t.slug === review.tool_slug), [review.tool_slug]);

  const moderate = useMutation({
    mutationFn: (status: ReviewStatus) =>
      adminModerateReview({ data: { id: review.id, status, moderation_note: note || null } }),
    onSuccess: () => {
      toast.success("Review updated");
      qc.invalidateQueries({ queryKey: ["admin-reviews"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const versions = useQuery({
    queryKey: ["admin-review-versions", review.id],
    queryFn: () => adminListReviewVersions({ data: { review_id: review.id } }),
    enabled: showHistory,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Stars rating={review.rating} />
          <CardTitle className="text-sm">{review.title}</CardTitle>
          <StatusBadge status={review.status} />
          <Badge variant="outline" className="text-[10px]">
            <ShieldCheck className="mr-1 h-3 w-3" /> {review.verified_source}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            v{review.version_no} · {new Date(review.submitted_at).toLocaleString()}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {tool?.name ?? review.tool_slug} · {review.customer_name || "Customer"} · <span className="font-mono">{review.customer_email}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <p className="whitespace-pre-line text-sm">{review.body}</p>
        {review.display_name ? (
          <p className="text-xs text-muted-foreground">Public display name: {review.display_name}</p>
        ) : null}

        <div>
          <Textarea
            placeholder="Private moderation note (never shown to the customer)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => moderate.mutate("approved")} disabled={moderate.isPending}>
            <Check className="mr-1 h-3.5 w-3.5" /> Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => moderate.mutate("rejected")} disabled={moderate.isPending}>
            <X className="mr-1 h-3.5 w-3.5" /> Reject
          </Button>
          <Button size="sm" variant="outline" onClick={() => moderate.mutate("hidden")} disabled={moderate.isPending}>
            <EyeOff className="mr-1 h-3.5 w-3.5" /> Hide
          </Button>
          <Button size="sm" variant="outline" onClick={() => moderate.mutate("pending")} disabled={moderate.isPending}>
            <Clock className="mr-1 h-3.5 w-3.5" /> Return to pending
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />} History
          </Button>
        </div>

        {showHistory ? (
          <div className="rounded-md border bg-background/40 p-3 text-xs">
            {versions.isLoading ? (
              <div className="text-muted-foreground">Loading history…</div>
            ) : (versions.data?.versions ?? []).length === 0 ? (
              <div className="text-muted-foreground">No previous versions.</div>
            ) : (
              <ul className="space-y-2">
                {(versions.data?.versions ?? []).map((v: { id: string; version_no: number; rating: number; title: string; body: string; submitted_at: string }) => (
                  <li key={v.id} className="border-b pb-2 last:border-b-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">v{v.version_no}</Badge>
                      <Stars rating={v.rating} />
                      <span className="font-medium">{v.title}</span>
                      <span className="ml-auto text-muted-foreground">{new Date(v.submitted_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-foreground/80">{v.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`h-3.5 w-3.5 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
      ))}
    </span>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  const map: Record<ReviewStatus, string> = {
    pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    rejected: "bg-destructive/15 text-destructive",
    hidden: "bg-muted text-muted-foreground",
  };
  return <Badge className={map[status]}>{status === "approved" ? <><Eye className="mr-1 h-3 w-3" /> Approved</> : status}</Badge>;
}
