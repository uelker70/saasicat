// DI token for the FeatureGuard's optional UpsellOfferResolver (#36).
//
// `Symbol.for` (NOT `Symbol`) is mandatory: this package is bundled with tsup
// into multiple CJS entries — shared modules get duplicated per entry, so a
// plain `Symbol()` would be a different object per entry and the optional
// inject would come up empty (cf. DISCOVERY_SNAPSHOT_TOKEN,
// outage 2026-06-09). `Symbol.for` uses the process-wide registry.
//
// Without a provider under this token the FeatureGuard stays on today's
// plain 403 — no breaking change for existing consumers.

export const UPSELL_OFFER_RESOLVER_TOKEN = Symbol.for('saas-platform/UpsellOfferResolver');

/**
 * Optional currency for the offers of the `CatalogBundleUpsellResolver`
 * (ISO-4217 string, e.g. `'EUR'`). Without a provider: `'EUR'`.
 */
export const UPSELL_OFFER_CURRENCY_TOKEN = Symbol.for('saas-platform/UpsellOfferCurrency');
