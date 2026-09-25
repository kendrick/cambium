/**
 * The longest brand URL a record stores. It lives apart from `core/brand-record.ts` because the
 * landing form caps its input with it, and that module imports zod, which the landing route loads
 * lazily to stay inside the bundle budget.
 */
export const BRAND_URL_MAX_LENGTH = 2048;
