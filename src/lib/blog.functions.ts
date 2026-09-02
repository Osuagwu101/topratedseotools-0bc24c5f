/**
 * Blog server functions — public reads via publishable client (RLS as anon),
 * admin writes via requireSupabaseAuth (RLS as user; policies enforce admin).
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { slugify, estimateReadingTime } from "@/lib/blog-text";

function serverPublic() {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const url = process.env.SUPABASE_URL!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type PostStatus = "draft" | "scheduled" | "published" | "archived";

export interface PostSummary {
  id: string;
  title: string;
  subtitle: string | null;
  slug: string;
  excerpt: string | null;
  featured_image: string | null;
  featured_image_alt?: string | null;
  category_id: string | null;
  author_id: string | null;
  status: PostStatus;
  published_at: string | null;
  scheduled_for: string | null;
  is_featured: boolean;
  reading_time_minutes: number;
  view_count: number;
  created_at: string;
  updated_at: string;
  category?: { id: string; name: string; slug: string } | null;
  author?: { id: string; full_name: string | null; avatar_url: string | null } | null;
  tags?: { id: string; name: string; slug: string }[];
}

/** Public: list published posts with optional filters. */
export const listPublishedPosts = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z
      .object({
        categorySlug: z.string().optional(),
        tagSlug: z.string().optional(),
        authorId: z.string().uuid().optional(),
        search: z.string().optional(),
        featured: z.boolean().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(60).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const supabase = serverPublic();
    let query = supabase
      .from("blog_posts")
      .select(
        "id,title,subtitle,slug,excerpt,featured_image,featured_image_alt,category_id,author_id,status,published_at,scheduled_for,is_featured,reading_time_minutes,view_count,created_at,updated_at,category:blog_categories(id,name,slug)",
      )
      .eq("status", "published")
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false });

    if (data.featured) query = query.eq("is_featured", true);
    if (data.authorId) query = query.eq("author_id", data.authorId);
    if (data.dateFrom) query = query.gte("published_at", data.dateFrom);
    if (data.dateTo) query = query.lte("published_at", data.dateTo);
    if (data.search && data.search.trim()) {
      const like = `%${data.search.trim().replace(/[%_]/g, "")}%`;
      query = query.or(
        `title.ilike.${like},subtitle.ilike.${like},excerpt.ilike.${like},content.ilike.${like}`,
      );
    }
    if (data.categorySlug) {
      const { data: cat } = await supabase
        .from("blog_categories")
        .select("id")
        .eq("slug", data.categorySlug)
        .maybeSingle();
      if (!cat) return { posts: [] as PostSummary[], total: 0 };
      query = query.eq("category_id", cat.id);
    }
    if (data.tagSlug) {
      const { data: tag } = await supabase
        .from("blog_tags")
        .select("id")
        .eq("slug", data.tagSlug)
        .maybeSingle();
      if (!tag) return { posts: [] as PostSummary[], total: 0 };
      const { data: joins } = await supabase
        .from("blog_post_tags")
        .select("post_id")
        .eq("tag_id", tag.id);
      const ids = (joins ?? []).map((j) => j.post_id);
      if (ids.length === 0) return { posts: [] as PostSummary[], total: 0 };
      query = query.in("id", ids);
    }

    const limit = data.limit ?? 12;
    const offset = data.offset ?? 0;
    const { data: rows, error } = await query.range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    const posts = (rows ?? []) as unknown as PostSummary[];

    // Hydrate authors and tags
    const authorIds = Array.from(
      new Set(posts.map((p) => p.author_id).filter(Boolean)),
    ) as string[];
    if (authorIds.length) {
      const { data: authors } = await supabase
        .from("profiles")
        .select("id,full_name,avatar_url")
        .in("id", authorIds);
      const map = new Map((authors ?? []).map((a) => [a.id, a]));
      for (const p of posts) p.author = p.author_id ? (map.get(p.author_id) ?? null) : null;
    }
    const postIds = posts.map((p) => p.id);
    if (postIds.length) {
      const { data: tagJoins } = await supabase
        .from("blog_post_tags")
        .select("post_id,tag:blog_tags(id,name,slug)")
        .in("post_id", postIds);
      const grouped = new Map<string, { id: string; name: string; slug: string }[]>();
      for (const j of tagJoins ?? []) {
        const arr = grouped.get(j.post_id) ?? [];
        const t = j.tag as unknown as { id: string; name: string; slug: string } | null;
        if (t) arr.push(t);
        grouped.set(j.post_id, arr);
      }
      for (const p of posts) p.tags = grouped.get(p.id) ?? [];
    }

    return { posts, total: posts.length };
  });

/** Public: full post by slug + related posts. */
export const getPostBySlug = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ slug: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const supabase = serverPublic();
    const { data: post, error } = await supabase
      .from("blog_posts")
      .select(
        "id,title,subtitle,slug,excerpt,content,featured_image,featured_image_alt,featured_image_credit,featured_image_source,category_id,author_id,status,published_at,scheduled_for,is_featured,reading_time_minutes,view_count,seo_title,seo_description,canonical_url,og_title,og_description,twitter_title,twitter_description,semantic_keywords,faq,image_alts,cta_template_id,created_at,updated_at,category:blog_categories(id,name,slug),cta:blog_cta_templates(id,title,body,button_label,button_url)",
      )
      .eq("slug", data.slug)
      .eq("status", "published")
      .lte("published_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!post) return { post: null, related: [], prev: null, next: null, author: null, tags: [] };

    const [{ data: author }, { data: tagJoins }] = await Promise.all([
      post.author_id
        ? supabase
            .from("profiles")
            .select("id,full_name,avatar_url")
            .eq("id", post.author_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("blog_post_tags").select("tag:blog_tags(id,name,slug)").eq("post_id", post.id),
    ]);
    const tags = (tagJoins ?? [])
      .map((j) => j.tag as unknown as { id: string; name: string; slug: string } | null)
      .filter(Boolean) as { id: string; name: string; slug: string }[];

    // Related: same category, exclude self, latest 3
    let related: PostSummary[] = [];
    if (post.category_id) {
      const { data: rel } = await supabase
        .from("blog_posts")
        .select(
          "id,title,subtitle,slug,excerpt,featured_image,featured_image_alt,category_id,author_id,status,published_at,scheduled_for,is_featured,reading_time_minutes,view_count,created_at,updated_at",
        )
        .eq("status", "published")
        .lte("published_at", new Date().toISOString())
        .eq("category_id", post.category_id)
        .neq("id", post.id)
        .order("published_at", { ascending: false })
        .limit(3);
      related = (rel ?? []) as unknown as PostSummary[];
    }

    // Prev / next by published_at
    const { data: prevRow } = await supabase
      .from("blog_posts")
      .select("id,title,slug")
      .eq("status", "published")
      .lt("published_at", post.published_at!)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: nextRow } = await supabase
      .from("blog_posts")
      .select("id,title,slug")
      .eq("status", "published")
      .gt("published_at", post.published_at!)
      .order("published_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    return { post, author, tags, related, prev: prevRow, next: nextRow };
  });

/** Public: list categories with post counts. */
export const listCategories = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = serverPublic();
  const { data, error } = await supabase
    .from("blog_categories")
    .select("id,name,slug,description")
    .order("name");
  if (error) throw new Error(error.message);
  return { categories: data ?? [] };
});

/** Public: list tags. */
export const listTags = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = serverPublic();
  const { data, error } = await supabase.from("blog_tags").select("id,name,slug").order("name");
  if (error) throw new Error(error.message);
  return { tags: data ?? [] };
});

/** Public: approved comments for a post (via admin client — base table is not readable by anon to protect commenter emails). */
export const listApprovedComments = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ postId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("blog_comments")
      .select("id,author_name,content,created_at")
      .eq("post_id", data.postId)
      .eq("status", "approved")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { comments: rows ?? [] };
  });

/** Public: blog settings (singleton, latest row). */
export const getBlogSettings = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = serverPublic();
  const { data } = await supabase
    .from("blog_settings")
    .select(
      "id,comments_enabled,hero_title,hero_subtitle,posts_per_page,keyword_highlight_enabled,keyword_highlight_color",
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    settings: data ?? {
      id: "",
      comments_enabled: true,
      hero_title: "Insights & Guides",
      hero_subtitle: "The latest on SEO tools, tips, and strategy.",
      posts_per_page: 12,
      keyword_highlight_enabled: true,
      keyword_highlight_color: "#fde68a",
    },
  };
});

/** Public: submit a comment (pending). */
export const submitComment = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        author_name: z.string().trim().min(1).max(80),
        author_email: z.string().trim().email().max(255),
        content: z.string().trim().min(2).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = serverPublic();
    const { error } = await supabase.from("blog_comments").insert({
      post_id: data.postId,
      author_name: data.author_name,
      author_email: data.author_email,
      content: data.content,
      status: "pending",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Public author profile. */
export const getAuthor = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const supabase = serverPublic();
    const { data: author } = await supabase
      .from("profiles")
      .select("id,full_name,avatar_url")
      .eq("id", data.id)
      .maybeSingle();
    return { author };
  });

// ============================================================================
// ADMIN
// ============================================================================

async function assertAdmin(supabase: ReturnType<typeof serverPublic>, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

const postInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300).optional().nullable(),
  slug: z.string().trim().max(120).optional().nullable(),
  excerpt: z.string().trim().max(500).optional().nullable(),
  content: z.string().max(200_000).default(""),
  featured_image: z.string().url().optional().nullable().or(z.literal("")),
  featured_image_alt: z.string().max(300).optional().nullable(),
  featured_image_source: z.enum(["ai", "stock", "upload", "manual"]).optional().nullable(),
  featured_image_credit: z.string().max(300).optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  status: z.enum(["draft", "scheduled", "published", "archived"]),
  published_at: z.string().datetime().optional().nullable(),
  scheduled_for: z.string().datetime().optional().nullable(),
  is_featured: z.boolean().optional(),
  seo_title: z.string().max(200).optional().nullable(),
  seo_description: z.string().max(300).optional().nullable(),
  canonical_url: z.string().url().max(500).optional().nullable().or(z.literal("")),
  og_title: z.string().max(200).optional().nullable(),
  og_description: z.string().max(400).optional().nullable(),
  twitter_title: z.string().max(200).optional().nullable(),
  twitter_description: z.string().max(400).optional().nullable(),
  semantic_keywords: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  faq: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(300),
        answer: z.string().trim().min(1).max(2000),
      }),
    )
    .max(10)
    .optional(),
  image_alts: z.record(z.string(), z.string().max(300)).optional(),
  cta_template_id: z.string().uuid().nullable().optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
});

/** Admin: list all posts (any status). */
export const adminListPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("blog_posts")
      .select(
        "id,title,slug,status,published_at,scheduled_for,is_featured,updated_at,category:blog_categories(id,name,slug)",
      )
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { posts: rows ?? [] };
  });

/** Admin: get a single post with tags and revisions count. */
export const adminGetPost = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: post, error } = await context.supabase
      .from("blog_posts")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!post) throw new Error("Not found");
    const { data: tagJoins } = await context.supabase
      .from("blog_post_tags")
      .select("tag_id")
      .eq("post_id", post.id);
    return { post, tag_ids: (tagJoins ?? []).map((t) => t.tag_id) };
  });

/** Admin: create post. */
export const adminCreatePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => postInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const slug =
      (data.slug && data.slug.length > 0 ? data.slug : slugify(data.title)) || slugify(data.title);
    const readingTime = estimateReadingTime(data.content ?? "");
    const publishedAt =
      data.status === "published"
        ? (data.published_at ?? new Date().toISOString())
        : (data.published_at ?? null);
    const { data: inserted, error } = await context.supabase
      .from("blog_posts")
      .insert({
        title: data.title,
        subtitle: data.subtitle ?? null,
        slug,
        excerpt: data.excerpt ?? null,
        content: data.content ?? "",
        featured_image: data.featured_image || null,
        featured_image_alt: data.featured_image_alt ?? null,
        featured_image_source: data.featured_image_source ?? "manual",
        featured_image_credit: data.featured_image_credit ?? null,
        category_id: data.category_id ?? null,
        author_id: context.userId,
        status: data.status,
        published_at: publishedAt,
        scheduled_for: data.scheduled_for ?? null,
        is_featured: !!data.is_featured,
        reading_time_minutes: readingTime,
        seo_title: data.seo_title ?? null,
        seo_description: data.seo_description ?? null,
        canonical_url: data.canonical_url || null,
        og_title: data.og_title ?? null,
        og_description: data.og_description ?? null,
        twitter_title: data.twitter_title ?? null,
        twitter_description: data.twitter_description ?? null,
        semantic_keywords: data.semantic_keywords ?? [],
        faq: data.faq ?? [],
        image_alts: data.image_alts ?? {},
        cta_template_id: data.cta_template_id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (data.tag_ids && data.tag_ids.length) {
      await context.supabase
        .from("blog_post_tags")
        .insert(data.tag_ids.map((tid) => ({ post_id: inserted.id, tag_id: tid })));
    }
    return { id: inserted.id };
  });

/** Admin: update post + snapshot revision. */
export const adminUpdatePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    postInputSchema.extend({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Snapshot current
    const { data: current } = await context.supabase
      .from("blog_posts")
      .select("title,subtitle,excerpt,content,featured_image")
      .eq("id", data.id)
      .maybeSingle();
    if (current) {
      await context.supabase.from("blog_revisions").insert({
        post_id: data.id,
        title: current.title,
        subtitle: current.subtitle,
        excerpt: current.excerpt,
        content: current.content,
        featured_image: current.featured_image,
        edited_by: context.userId,
      });
    }

    const slug = data.slug && data.slug.length > 0 ? data.slug : slugify(data.title);
    const readingTime = estimateReadingTime(data.content ?? "");
    const publishedAt =
      data.status === "published"
        ? (data.published_at ?? new Date().toISOString())
        : (data.published_at ?? null);
    const { error } = await context.supabase
      .from("blog_posts")
      .update({
        title: data.title,
        subtitle: data.subtitle ?? null,
        slug,
        excerpt: data.excerpt ?? null,
        content: data.content ?? "",
        featured_image: data.featured_image || null,
        featured_image_alt: data.featured_image_alt ?? null,
        featured_image_source: data.featured_image_source ?? "manual",
        featured_image_credit: data.featured_image_credit ?? null,
        category_id: data.category_id ?? null,
        status: data.status,
        published_at: publishedAt,
        scheduled_for: data.scheduled_for ?? null,
        is_featured: !!data.is_featured,
        reading_time_minutes: readingTime,
        seo_title: data.seo_title ?? null,
        seo_description: data.seo_description ?? null,
        canonical_url: data.canonical_url || null,
        og_title: data.og_title ?? null,
        og_description: data.og_description ?? null,
        twitter_title: data.twitter_title ?? null,
        twitter_description: data.twitter_description ?? null,
        semantic_keywords: data.semantic_keywords ?? [],
        faq: data.faq ?? [],
        image_alts: data.image_alts ?? {},
        cta_template_id: data.cta_template_id ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // Reset tag joins
    await context.supabase.from("blog_post_tags").delete().eq("post_id", data.id);
    if (data.tag_ids && data.tag_ids.length) {
      await context.supabase
        .from("blog_post_tags")
        .insert(data.tag_ids.map((tid) => ({ post_id: data.id, tag_id: tid })));
    }
    return { ok: true };
  });

/** Admin: soft actions on a post — delete, archive, restore, duplicate. */
export const adminPostAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["delete", "archive", "restore", "duplicate", "publish"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.action === "delete") {
      const { error } = await context.supabase.from("blog_posts").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    if (data.action === "archive") {
      await context.supabase.from("blog_posts").update({ status: "archived" }).eq("id", data.id);
      return { ok: true };
    }
    if (data.action === "restore") {
      await context.supabase.from("blog_posts").update({ status: "draft" }).eq("id", data.id);
      return { ok: true };
    }
    if (data.action === "publish") {
      await context.supabase
        .from("blog_posts")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", data.id);
      return { ok: true };
    }
    // duplicate
    const { data: p } = await context.supabase
      .from("blog_posts")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!p) throw new Error("Not found");
    const newSlug = `${p.slug}-copy-${Math.random().toString(36).slice(2, 6)}`;
    const { data: created, error } = await context.supabase
      .from("blog_posts")
      .insert({
        title: `${p.title} (copy)`,
        subtitle: p.subtitle,
        slug: newSlug,
        excerpt: p.excerpt,
        content: p.content,
        featured_image: p.featured_image,
        category_id: p.category_id,
        author_id: context.userId,
        status: "draft",
        reading_time_minutes: p.reading_time_minutes,
        seo_title: p.seo_title,
        seo_description: p.seo_description,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: created.id };
  });

/** Admin: list revisions of a post. */
export const adminListRevisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ postId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("blog_revisions")
      .select("id,title,subtitle,excerpt,content,featured_image,edited_by,created_at")
      .eq("post_id", data.postId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { revisions: rows ?? [] };
  });

/** Admin: restore a revision (writes it back as current, snapshotting current first). */
export const adminRestoreRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ postId: z.string().uuid(), revisionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rev } = await context.supabase
      .from("blog_revisions")
      .select("title,subtitle,excerpt,content,featured_image")
      .eq("id", data.revisionId)
      .maybeSingle();
    if (!rev) throw new Error("Revision not found");
    const { data: current } = await context.supabase
      .from("blog_posts")
      .select("title,subtitle,excerpt,content,featured_image")
      .eq("id", data.postId)
      .maybeSingle();
    if (current) {
      await context.supabase.from("blog_revisions").insert({
        post_id: data.postId,
        title: current.title,
        subtitle: current.subtitle,
        excerpt: current.excerpt,
        content: current.content,
        featured_image: current.featured_image,
        edited_by: context.userId,
      });
    }
    const { error } = await context.supabase
      .from("blog_posts")
      .update({
        title: rev.title,
        subtitle: rev.subtitle,
        excerpt: rev.excerpt,
        content: rev.content,
        featured_image: rev.featured_image,
        reading_time_minutes: estimateReadingTime(rev.content ?? ""),
      })
      .eq("id", data.postId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Categories / tags CRUD
export const adminUpsertCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(80),
        slug: z.string().trim().max(120).optional(),
        description: z.string().trim().max(300).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const slug = data.slug && data.slug.length ? slugify(data.slug) : slugify(data.name);
    if (data.id) {
      const { error } = await context.supabase
        .from("blog_categories")
        .update({ name: data.name, slug, description: data.description ?? null })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("blog_categories")
      .insert({ name: data.name, slug, description: data.description ?? null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const adminDeleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("blog_categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminUpsertTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(60),
        slug: z.string().trim().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const slug = data.slug && data.slug.length ? slugify(data.slug) : slugify(data.name);
    if (data.id) {
      const { error } = await context.supabase
        .from("blog_tags")
        .update({ name: data.name, slug })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("blog_tags")
      .insert({ name: data.name, slug })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const adminDeleteTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("blog_tags").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Comments moderation
export const adminListComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("blog_comments")
      .select(
        "id,post_id,author_name,author_email,content,status,created_at,post:blog_posts(id,title,slug)",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { comments: data ?? [] };
  });

export const adminModerateComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["approve", "reject", "delete"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.action === "delete") {
      const { error } = await context.supabase.from("blog_comments").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const status = data.action === "approve" ? "approved" : "rejected";
    const { error } = await context.supabase
      .from("blog_comments")
      .update({ status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Blog settings
export const adminUpdateBlogSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        comments_enabled: z.boolean(),
        hero_title: z.string().trim().min(1).max(120),
        hero_subtitle: z.string().trim().min(1).max(240),
        posts_per_page: z.number().int().min(3).max(48),
        keyword_highlight_enabled: z.boolean().default(true),
        keyword_highlight_color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#fde68a"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("blog_settings")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const payload = {
      comments_enabled: data.comments_enabled,
      hero_title: data.hero_title,
      hero_subtitle: data.hero_subtitle,
      posts_per_page: data.posts_per_page,
      keyword_highlight_enabled: data.keyword_highlight_enabled,
      keyword_highlight_color: data.keyword_highlight_color,
    };
    if (existing) {
      const { error } = await context.supabase
        .from("blog_settings")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      await context.supabase.from("blog_settings").insert(payload);
    }
    return { ok: true };
  });
