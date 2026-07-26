// Shared between `tsup.config.ts` (ESM + types) and `tsup.cjs.config.ts`
// (the single shared CommonJS bundle). Both passes must treat the same
// packages as external — a dependency bundled into one pass but not the other
// would give the two outputs different copies of it.
export const CJS_EXTERNAL = [
    '@saasicat/types',
    '@saasicat/spec',
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/schedule',
    'js-yaml',
    'ajv',
    'ajv-formats',
    'otplib',
    'rxjs',
    'class-validator',
    'class-transformer',
];

/**
 * Public entry point → namespace exported by `src/_all-entries.ts`.
 * Consumed by `scripts/build-cjs-stubs.mjs`; keep in sync with the `exports`
 * map in `package.json`.
 */
export const CJS_ENTRY_NAMESPACES: Record<string, string> = {
    'index': 'rootNs',
    'admin/index': 'adminNs',
    'billing/index': 'billingNs',
    'catalog/index': 'catalogNs',
    'checkout-offer/index': 'checkoutOfferNs',
    'discovery/index': 'discoveryNs',
    'entitlement/index': 'entitlementNs',
    'platform/index': 'platformNs',
    'promo/index': 'promoNs',
    'registration/index': 'registrationNs',
    'subscription-contract/index': 'subscriptionContractNs',
    'testing/index': 'testingNs',
};
