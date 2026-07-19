// DI-Tokens für den SubscriptionBundlesService (SPEC_V2 §11.1 M6 Pack 2e,
// P11.7.3). Konsumenten registrieren ihren Prisma-Adapter über diesen
// Token in `SubscriptionBundleModule.forRoot({...})`.

export const SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform/SubscriptionBundleRepository',
);

/** Optionaler Konfig-Token; Default = 12 Monate Mindestlaufzeit. */
export const SUBSCRIPTION_BUNDLE_CONFIG_TOKEN = Symbol.for(
    'saas-platform/SubscriptionBundleConfig',
);
