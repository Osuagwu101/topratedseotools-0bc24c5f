/**
 * Public review block for tool pages.
 * Renders aggregate rating, breakdown, approved reviews and — when the
 * current viewer is an eligible customer — the submit / update form.
 *
 * JSON-LD structured data is emitted ONLY when at least one approved review
 * exists; the counts and average shown to Google exactly match what's on
 * screen.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, ShieldCheck, Lock, MessageSquare, PencilLine } from "lucide-react";
import { toast } from "sonner";
import type { Tool } from "@/lib/tools-data";
import { listPublicReviews, getReviewEligibility, submitReview } from "@/lib/reviews.functions";
import { checkReviewSafety } from "@/lib/reviews-safety";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Props {
  tool: Tool;
  isAuthenticated: boolean;
}

export function ReviewSection({ tool, isAuthenticated }: Props) {
  const qc = useQueryClient();
  const { data: pub } = useQuery({
    queryKey: ["public-reviews", tool.slug],
    queryFn: () => listPublicReviews({ data: { tool_slug: tool.slug, limit: 50 } }),
    staleTime: 60_000,
  });

  const { data: elig } = useQuery({
    queryKey: ["review-eligibility", tool.slug],
    queryFn: () => getReviewEligibility({ data: { tool_slug: tool.slug } }),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const reviews = pub?.reviews ?? [];
  const agg = pub?.aggregate ?? {
    average: 0,
    total: 0,
    breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };

  const jsonLd = useMemo(() => {
    if (agg.total === 0) return null;
    return {
      "@context": "https://schema.org",
      "@type": "Product",
      name: tool.name,
      description: tool.description,
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: agg.average,
        reviewCount: agg.total,
        bestRating: 5,
        worstRating: 1,
      },
      review: reviews.slice(0, 10).map((r) => ({
        "@type": "Review",
        reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
        author: { "@type": "Person", name: r.display_name || "Verified customer" },
        name: r.title,
        reviewBody: r.body,
        datePublished: r.submitted_at,
      })),
    };
  }, [agg, reviews, tool.name, tool.description]);

  return (
    <section id="reviews" className="mt-10 rounded-2xl border bg-card p-6 shadow-card">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Customer reviews</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Only verified purchases can leave a review.
          </p>
        </div>
        <RatingSummary aggregate={agg} />
      </div>

      {isAuthenticated && elig ? (
        <ReviewFormOrStatus
          tool={tool}
          elig={elig}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["review-eligibility", tool.slug] });
            qc.invalidateQueries({ queryKey: ["public-reviews", tool.slug] });
          }}
        />
      ) : null}

      <div className="mt-6 space-y-4">
        {reviews.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No customer reviews yet
          </div>
        ) : (
          reviews.map((r) => (
            <article key={r.id} className="rounded-xl border p-4">
              <header className="flex flex-wrap items-center gap-2 text-xs">
                <Stars rating={r.rating} />
                <span className="font-semibold text-sm">{r.title}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3 w-3" /> Verified Purchase
                </span>
                {r.access_type === "private" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                    <Lock className="h-3 w-3" /> Private
                  </span>
                ) : r.access_type === "shared" ? (
                  <span className="rounded-full bg-muted px-2 py-0.5">Shared</span>
                ) : null}
              </header>
              <p className="mt-2 whitespace-pre-line text-sm text-foreground/90">{r.body}</p>
              <footer className="mt-2 text-[11px] text-muted-foreground">
                {r.display_name ? (
                  <span className="font-medium text-foreground/70">{r.display_name}</span>
                ) : (
                  "Anonymous customer"
                )}{" "}
                · {new Date(r.submitted_at).toLocaleDateString()}
              </footer>
            </article>
          ))
        )}
      </div>

      {jsonLd ? (
        <script
          type="application/ld+json"
          // Fine here — content is the serialized aggregate; no user HTML.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      ) : null}
    </section>
  );
}

function RatingSummary({
  aggregate,
}: {
  aggregate: { average: number; total: number; breakdown: Record<1 | 2 | 3 | 4 | 5, number> };
}) {
  if (aggregate.total === 0) {
    return <div className="text-xs text-muted-foreground">No ratings yet</div>;
  }
  return (
    <div className="min-w-[220px]">
      <div className="flex items-center gap-2">
        <div className="text-2xl font-bold">{aggregate.average.toFixed(1)}</div>
        <Stars rating={Math.round(aggregate.average)} />
        <span className="text-xs text-muted-foreground">
          {aggregate.total} review{aggregate.total === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-2 space-y-0.5">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = aggregate.breakdown[n as 1 | 2 | 3 | 4 | 5] ?? 0;
          const pct = aggregate.total ? (count / aggregate.total) * 100 : 0;
          return (
            <div key={n} className="flex items-center gap-2 text-[11px]">
              <span className="w-4 tabular-nums">{n}</span>
              <div className="h-1.5 flex-1 rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-6 tabular-nums text-muted-foreground">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-4 w-4 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
        />
      ))}
    </span>
  );
}

function ReviewFormOrStatus({
  tool,
  elig,
  onSaved,
}: {
  tool: Tool;
  elig: Awaited<ReturnType<typeof getReviewEligibility>>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (!elig.canReview && !elig.canEdit) {
    if (elig.review) {
      return (
        <div className="mt-4 rounded-xl border bg-background/40 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <MessageSquare className="h-4 w-4 text-primary" /> Review Submitted
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Status: <span className="font-medium capitalize">{elig.review.status}</span>. Purchase{" "}
            {tool.name} again to unlock a review update.
          </p>
        </div>
      );
    }
    if (elig.reason) {
      return (
        <div className="mt-4 rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
          {elig.reason}
        </div>
      );
    }
    return null;
  }

  if (!open) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border bg-background/40 p-4 text-sm">
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
        <span>
          {elig.canEdit
            ? "You have one review update available."
            : "You are eligible to leave a review."}
        </span>
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>
          {elig.canEdit ? (
            <>
              <PencilLine className="mr-1 h-3.5 w-3.5" /> Update Your Review
            </>
          ) : (
            "Write a Review"
          )}
        </Button>
      </div>
    );
  }

  return (
    <ReviewForm
      tool={tool}
      elig={elig}
      onSaved={() => {
        setOpen(false);
        onSaved();
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

function ReviewForm({
  tool,
  elig,
  onSaved,
  onCancel,
}: {
  tool: Tool;
  elig: Awaited<ReturnType<typeof getReviewEligibility>>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState<number>(elig.review?.rating ?? 5);
  const [title, setTitle] = useState<string>(elig.review?.title ?? "");
  const [body, setBody] = useState<string>(elig.review?.body ?? "");
  const [displayName, setDisplayName] = useState<string>(elig.review?.display_name ?? "");
  const [warning, setWarning] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      submitReview({
        data: {
          tool_slug: tool.slug,
          rating,
          title: title.trim(),
          body: body.trim(),
          display_name: displayName.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Review submitted for moderation");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const check = checkReviewSafety({
      title: title.trim(),
      body: body.trim(),
      display_name: displayName.trim() || null,
    });
    if (!check.ok) {
      setWarning(check.reason ?? "Please revise your review.");
      return;
    }
    setWarning(null);
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3 rounded-xl border p-4">
      <div>
        <Label className="text-xs">Your rating</Label>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} stars`}
              className="p-0.5"
            >
              <Star
                className={`h-6 w-6 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
              />
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-xs">Title</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder={`My experience with ${tool.name}`}
          required
        />
      </div>
      <div>
        <Label className="text-xs">Review</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={5}
          placeholder="What worked well? What could be better?"
          required
        />
      </div>
      <div>
        <Label className="text-xs">Public display name (optional)</Label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          placeholder="Shown with your review; your email is never shown."
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Never include emails, phone numbers, links, or payment/login details.
        </p>
      </div>

      {warning ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          {warning}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Submitting…" : elig.canEdit ? "Save update" : "Submit review"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Reviews are moderated before they appear publicly. Once submitted, your review is locked
        until your next successful purchase of {tool.name}.
      </p>
    </form>
  );
}
