// Synthetic barrel for the CJS build — not a public entry point.
//
// esbuild only code-splits ESM, so building the 11 public entries as separate
// CJS bundles copies every shared module into each one. Each copy has its own
// class objects, and Nest matches providers by class reference: a service
// registered through `@saasicat/nest/platform` then fails to resolve when the
// app injects the class imported from `@saasicat/nest/admin`. That has caused
// a production outage and blocked consumers from composing `SaaSiCatModule`
// with the other platform modules.
//
// The fix: bundle everything ONCE from this file, then emit each public entry
// as a thin re-export of the matching namespace below (see
// `scripts/build-cjs-stubs.mjs`). All entries then hand out the same class
// objects, and the hazard disappears for consumers instead of being a rule
// they have to remember.
//
// Namespaces (not `export *`) keep the entries independent: two entries may
// legitimately export the same NAME for different things — e.g.
// `FEATURE_UI_REGISTRY_TOKEN` exists in both `billing` and `catalog` and means
// a different registry in each.

export * as adminNs from './admin/index.js';
export * as billingNs from './billing/index.js';
export * as catalogNs from './catalog/index.js';
export * as checkoutOfferNs from './checkout-offer/index.js';
export * as discoveryNs from './discovery/index.js';
export * as entitlementNs from './entitlement/index.js';
export * as platformNs from './platform/index.js';
export * as promoNs from './promo/index.js';
export * as registrationNs from './registration/index.js';
export * as rootNs from './index.js';
export * as subscriptionContractNs from './subscription-contract/index.js';
export * as testingNs from './testing/index.js';
