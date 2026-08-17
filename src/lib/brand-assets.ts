export const BRAND_ASSET_VERSION = "20260817b";

/**
 * Canonical brand assets.
 *
 * Keep customer-facing branding on stable files served from /public. Do not
 * point UI, metadata, or email HTML at Lovable's internal /__l5e/assets-v1
 * URLs: those are project-runtime asset paths rather than durable public brand
 * URLs for browsers and email clients.
 */
export const BRAND_LOGO_PATH = `/favicon.png?v=${BRAND_ASSET_VERSION}`;
export const BRAND_LOGO_URL = `https://topratedseotools.com/favicon.png?v=${BRAND_ASSET_VERSION}`;
export const BRAND_FAVICON_PNG_PATH = BRAND_LOGO_PATH;
export const BRAND_FAVICON_ICO_PATH = `/favicon.ico?v=${BRAND_ASSET_VERSION}`;
export const BRAND_APPLE_TOUCH_ICON_PATH = `/apple-touch-icon.png?v=${BRAND_ASSET_VERSION}`;
export const BRAND_MANIFEST_PATH = `/site.webmanifest?v=${BRAND_ASSET_VERSION}`;
