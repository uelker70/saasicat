// @saasicat/types — Barrel-Export aller TS-Interfaces.
// Pflicht-Begleiter zu @saasicat/spec.
// Spec: yada-services/handoff/superadmin/SPEC.md

export * from './active-plan-version-query.js';
export * from './admin-manifest.types.js';
export * from './audit-event.types.js';
export * from './bundle-business-type.types.js';
export * from './catalog-entry.types.js';
export * from './promotion.types.js';
export * from './checkout-offer.types.js';
export * from './marketing-settings.types.js';
export * from './public-marketing-catalog.types.js';
export * from './discovery.types.js';
export * from './entitlement-snapshot.types.js';
export * from './feature-ui-registry.types.js';
export {
    classifyBundleVersionDiff,
    classifyBusinessTypeVersionDiff,
    classifyPlanDiff,
} from './version-diff.js';
export type {
    BundleVersionFields,
    BusinessTypeVersionFields,
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
export * from './ports.types.js';
export * from './promo-code.types.js';
export * from './error-codes.js';
export * from './errors.js';
export * from './feature-requires.js';
export * from './upsell.types.js';
export * from './registration.types.js';
export * from './setup.types.js';
export * from './subscription-contract.types.js';
export * from './subscription.types.js';
export * from './version-editability.js';
