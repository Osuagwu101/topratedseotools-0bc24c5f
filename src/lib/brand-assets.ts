export const BRAND_ASSET_VERSION = "20260818c";

/**
 * Canonical brand endpoints.
 *
 * Visible UI logos are bundled directly by Vite. Metadata and email clients use
 * a stable application endpoint that redirects to the current fingerprinted
 * build asset, avoiding fragile root /public paths on the custom domain.
 */
export const BRAND_LOGO_PATH = `/api/public/brand-logo?v=${BRAND_ASSET_VERSION}`;
export const BRAND_LOGO_URL = `https://topratedseotools.com/api/public/brand-logo?v=${BRAND_ASSET_VERSION}`;
export const BRAND_FAVICON_PNG_PATH = BRAND_LOGO_PATH;
export const BRAND_FAVICON_ICO_PATH = BRAND_LOGO_PATH;
export const BRAND_APPLE_TOUCH_ICON_PATH = BRAND_LOGO_PATH;
export const BRAND_MANIFEST_PATH = `/site.webmanifest?v=${BRAND_ASSET_VERSION}`;
