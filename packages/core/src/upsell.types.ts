// Upsell response of the FeatureGuard (#36) — wire format + resolver port.
//
// When the FeatureGuard throws due to a missing entitlement, the frontend
// should be able to turn that into a purchase offer instead of just showing
// "access denied". For that the guard returns a structured 403 body
// (`FeatureNotLicensedBody`); the offers come from an optionally
// registered `UpsellOfferResolver`.
//
// Status-code decision: **403 with a `code` field**, NOT 402.
// - 402 "Payment Required" is reserved/experimental in the HTTP standard;
//   proxies, HTTP clients and error interceptors handle it
//   inconsistently.
// - 403 matches the semantics exactly: authenticated, but not authorized
//   (license missing). SPA interceptors that only auto-logout on 401
//   are unaffected (cf. the DMS 401 trap) — consumer interceptors
//   must never interpret a 403 as an auth error.
// - The machine distinction runs via `code === 'FEATURE_NOT_LICENSED'`,
//   not via the status code.

/** Error code of the structured FeatureGuard 403 (#36). */
export const FEATURE_NOT_LICENSED = 'FEATURE_NOT_LICENSED' as const;

/**
 * A purchase offer that would cover the missing feature — typically
 * a published catalog BundleVersion that contains the feature key.
 */
export interface UpsellOffer {
    bundleKey: string;
    /** Live BundleVersion ID — for the `add` request of the tenant self-service. */
    bundleVersionId?: string;
    /** Net monthly price; `null` = price only context-dependent (pricing override). */
    priceMonthlyNet: number | null;
    /** ISO 4217, e.g. `EUR`. */
    currency: string;
    label?: string;
}

/**
 * 403 body of the FeatureGuard on a missing entitlement — emitted in this
 * complete shape by every guard, `FeatureGuard` and `StaticFeatureGuard`
 * alike. Without a registered `UpsellOfferResolver` (or when the resolver
 * fails) `offers` is an empty array, never absent, so a consumer that matched
 * on `code === 'FEATURE_NOT_LICENSED'` may read `offers`/`featureKey` without
 * a presence check.
 */
export interface FeatureNotLicensedBody {
    code: typeof FEATURE_NOT_LICENSED;
    /** First required key — convenience for single-feature guards (issue shape). */
    featureKey: string;
    /** All required keys (`@RequireFeature` is a logical OR). */
    featureKeys: string[];
    offers: UpsellOffer[];
    /** Human-readable message (fallback display). */
    message: string;
}

/**
 * Port (#36): resolves missing feature keys into purchase offers. Consumers
 * register an implementation under `UPSELL_OFFER_RESOLVER_TOKEN`
 * (@saasicat/nest) — e.g. the bundled
 * `CatalogBundleUpsellResolver` against the published catalog bundles.
 *
 * `tenantId` allows tenant-specific offers (e.g. taking plan compatibility
 * or already-booked dependencies into account); the
 * default implementation does not use it.
 */
export interface UpsellOfferResolver {
    resolveOffers(featureKeys: string[], tenantId: string): Promise<UpsellOffer[]>;
}
