// DI tokens for the SubscriptionBundlesService (
// P11.7.3). Consumers register their Prisma adapter via this
// token in `SubscriptionBundleModule.forRoot({...})`.

export const SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/SubscriptionBundleRepository',
);

/** Optional config token; without it a booking commits the tenant to nothing. */
export const SUBSCRIPTION_BUNDLE_CONFIG_TOKEN = Symbol.for(
    'saasicat/nest/SubscriptionBundleConfig',
);
