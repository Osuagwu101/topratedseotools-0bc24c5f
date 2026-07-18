# Complete Blog System — Implementation Plan

The blog already has: posts CRUD, revisions, categories/tags, comments, AI article generation (OpenAI/Gemini/Anthropic), semantic keywords + FAQ, SEO metadata, CTAs, internal linking, keyword highlighting, scheduling fields, and public routes. Remaining gaps are **featured images**, **advanced search**, **performance**, and a **verification pass**.

## 1. Featured images — three sources, one workflow

Add a `featured_image_source` enum to `blog_posts` (`ai` | `stock` | `upload`) plus `featured_image_alt` (already present) and `featured_image_credit` (for Unsplash attribution). Create a storage bucket `blog-images` (public) for uploads and AI-generated images.

Admin settings (`blog_settings` gets `image_provider` = `ai` | `stock` | `manual`, `stock_provider` = `unsplash`, `ai_image_model`) so admin picks the default method.

New unified component `FeaturedImagePicker` in `src/components/blog/FeaturedImagePicker.tsx` with three tabs:
- **AI Generate** — calls new server fn `generateBlogImage` (Lovable AI Gateway, `openai/gpt-image-2`, streams to storage, returns public URL).
- **Search stock** — calls `searchStockImages` (Unsplash API via `UNSPLASH_ACCESS_KEY` secret). Grid of results, click to attach; stores photographer credit.
- **Upload** — direct file upload to `blog-images` bucket (validated: type, <5MB).

Alt text — new server fn `generateImageAlt` calls Gemini vision with the image URL + post title, auto-fills the alt field. Runs on selection/upload; admin can override.

Wire into `PostEditor.tsx` replacing the current URL text field. AI article generator also uses `generateBlogImage` when the post has no featured image on save.

## 2. Advanced blog search

Rewrite `/blog/search` route + `searchPosts` server fn to accept:
- `q` (keyword — full-text across title/excerpt/content)
- `category` (slug)
- `tag` (slug)
- `author` (id)
- `from` / `to` (published_at date range)

Add a Postgres GIN index on `to_tsvector('english', title || ' ' || coalesce(excerpt,'') || ' ' || content)` for keyword speed, and combined filters in one query. Search page gets a filter sidebar (category/tag dropdowns, author picker, date range) and a results list reusing `PostCard`. Header nav gets a search box that deep-links to `/blog/search?q=`.

## 3. Performance

- **Responsive images**: `<img srcset sizes>` in `PostCard` and article hero, using Unsplash's `?w=` params and stored uploads served through a `/img/$` route with `sharp` disabled (keep simple — rely on client-side `srcset` + CDN caching for now).
- **Lazy loading**: `loading="lazy"` + `decoding="async"` on all non-hero images; `fetchpriority="high"` + route-level `<link rel="preload">` on the article hero.
- **Caching**: public blog server fns set `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` via `setResponseHeaders`. Query client stale times bumped on list pages.
- **Mobile**: verify Tailwind responsive classes in `PostCard`, article layout, and search filters (collapse into a Sheet on `<md`).

## 4. Verification pass

After the code is in, run typecheck + Playwright script covering: create draft → schedule → publish → view public post → verify SEO tags, keyword highlights, CTA render, internal links, image alt, search filters, and admin flows (categories, tags, comments moderation, CTAs, AI generator, revisions restore).

## Files (new)
- `src/lib/blog-images.functions.ts` — `generateBlogImage`, `searchStockImages`, `generateImageAlt`, `uploadBlogImage`
- `src/components/blog/FeaturedImagePicker.tsx`
- `src/components/blog/BlogSearchFilters.tsx`

## Files (modified)
- migration: `blog_posts` cols, `blog_settings` cols, storage bucket + policies, GIN index
- `src/components/blog/PostEditor.tsx` — swap image input for picker
- `src/lib/blog.functions.ts` — new `searchPosts` signature, cache headers
- `src/routes/blog.search.tsx` — filters UI
- `src/components/blog/PostCard.tsx` + `src/routes/blog.$slug.tsx` — responsive + lazy images
- `src/components/site/Navbar.tsx` — blog search entry
- `src/lib/ai-article.functions.ts` — auto-generate featured image

## Secrets needed
`UNSPLASH_ACCESS_KEY` (I'll ask). Lovable AI key already present for AI images and alt-text.

## Approval
Approve to proceed. I'll ask for the Unsplash key at the start of implementation.
