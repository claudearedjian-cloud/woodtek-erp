// ============================================================================
// App version shown in the left menu, e.g. "WOODTEK-ERP V1.1".
//
// The number lives in version.json. scripts/build-prod.cjs raises the minor
// number on every production build (every update pack), and next.config.ts
// copies it into NEXT_PUBLIC_WOODTEK_VERSION for the browser bundle.
// ============================================================================

export const APP_PRODUCT = "WOODTEK-ERP";

/** Falls back to 1.0 only in code paths that run without next.config (tests). */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_WOODTEK_VERSION || "1.0";

export const APP_VERSION_LABEL = `${APP_PRODUCT} V${APP_VERSION}`;
