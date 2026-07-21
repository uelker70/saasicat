// DI tokens for the SubscriptionBundlesService (SPEC_V2 §11.1 M6 Pack 2e,
// P11.7.3). Consumers register their Prisma adapter via this
// token in `SubscriptionBundleModule.forRoot({...})`.

export const SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform/SubscriptionBundleRepository',
);

/** Optional config token; default = 12 months minimum term. */
export const SUBSCRIPTION_BUNDLE_CONFIG_TOKEN = Symbol.for(
    'saas-platform/SubscriptionBundleConfig',
);
