// DI-Token für den optionalen UpsellOfferResolver des FeatureGuard (#36).
//
// `Symbol.for` (NICHT `Symbol`) ist zwingend: dieses Paket wird mit tsup
// in mehrere CJS-Entries gebündelt — geteilte Module werden dabei je Entry
// dupliziert, ein plain `Symbol()` wäre pro Entry ein anderes Objekt und
// der Optional-Inject liefe ins Leere (vgl. DISCOVERY_SNAPSHOT_TOKEN,
// Outage 2026-06-09). `Symbol.for` nutzt die prozessweite Registry.
//
// Ohne Provider unter diesem Token bleibt der FeatureGuard beim heutigen
// plain-403 — kein Breaking Change für Bestandskonsumenten.

export const UPSELL_OFFER_RESOLVER_TOKEN = Symbol.for('saas-platform/UpsellOfferResolver');

/**
 * Optionale Währung für die Offers des `CatalogBundleUpsellResolver`
 * (ISO-4217-String, z. B. `'EUR'`). Ohne Provider: `'EUR'`.
 */
export const UPSELL_OFFER_CURRENCY_TOKEN = Symbol.for('saas-platform/UpsellOfferCurrency');
