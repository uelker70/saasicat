// @saasicat/core — barrel export of all TS interfaces.
// Required companion to @saasicat/spec.

export * from './active-plan-version-query.js';
export * from './bundle-draft-defaults.js';
export * from './admin-manifest.types.js';
export * from './audit-event.types.js';
export * from './bundle.types.js';
export * from './catalog-entry.types.js';
export * from './promotion.types.js';
export * from './checkout-offer.types.js';
export * from './marketing-settings.types.js';
export * from './public-marketing-catalog.types.js';
export * from './discovery.types.js';
export * from './entitlement-snapshot.types.js';
export * from './feature-ui-registry.types.js';
export { readQuotaRecord, readQuotaValue } from './quota-value.js';
export { classifyBundleVersionDiff, classifyPlanDiff } from './version-diff.js';
export type {
    BundleVersionFields,
    ChangeDirection,
    DiffResult,
    PlanVersionFields,
} from './version-diff.js';
export * from './onboarding.types.js';
export * from './plan-catalog.types.js';
export * from './plan-catalog-import.types.js';
export * from './plan-stem.types.js';
export * from './plan-version-lifecycle.types.js';
export * from './plan-version-row.types.js';
// The seven domain port barrels, listed here rather than behind one of their
// own: this package publishes `.` and nothing else, so a barrel between them
// and this file could only ever serve imports that its `exports` map refuses.
export * from './ports/core-ports.types.js';
export * from './ports/billing-ports.types.js';
export * from './ports/admin-ports.types.js';
export * from './ports/promo-ports.types.js';
export * from './ports/catalog-ports.types.js';
export * from './ports/checkout-ports.types.js';
export * from './ports/persistence-ports.types.js';
export * from './promo-code.types.js';
export * from './error-codes.js';
export * from './errors.js';
export * from './feature-requires.js';
export * from './upsell.types.js';
export * from './registration.types.js';
export * from './setup.types.js';
export * from './plan-mapping.js';
export * from './subscription-contract-mapping.js';
export * from './subscription-contract.types.js';
export * from './subscription.types.js';
export * from './version-editability.js';
export * from './error-messages.js';
export * from './error-messages-de.js';
