/** What a start that serves tenants needs of one bundle member. */
export interface TenantServingMember {
    /** The id of the start rule that refuses the start without it. */
    readonly refusedBy: string;
    /**
     * The module options any one of which, on, makes that rule ask for it:
     * `tenantBilling` always, and the others its rule also answers to.
     */
    readonly neededWith: readonly string[];
    /**
     * The option the rule accepts in its place, where it accepts one: the
     * application's own adapter for what the member does.
     */
    readonly orOption?: string;
    /** The canonical models the shipped bundles keep its records in. */
    readonly models: readonly string[];
}

/**
 * The persistence bundle members a start that serves tenants — `tenantBilling`
 * on — is refused without, each with the start rule that refuses it, the
 * options that rule answers to, the option it accepts instead where there is
 * one, and the canonical models the shipped bundles keep its records in.
 *
 * `saasicat schema check` reads the models: one of them missing from a schema
 * is not a fragment the application can do without wherever those options are
 * on, and the check names it apart from the ones it can, with the rule, the
 * options and the alternative. A model listed here may also be one
 * `OPTIONAL_CANONICAL_MODELS` names, because an application with none of those
 * options on can still leave it out.
 *
 * A member that keeps no records of its own, such as the transaction runner,
 * names no model: the check has nothing to report for it, and it is here so the
 * list answers for every member such a start needs.
 */
export const TENANT_SERVING_MEMBERS = {
    'core.transactionRunner': {
        refusedBy: 'entitlement.requires-adapters',
        neededWith: ['tenantBilling', 'entitlement', 'subscriptionBundles'],
        orOption: 'adapters.transactionRunner',
        models: [],
    },
    'entitlement.subscriptionRepository': {
        refusedBy: 'entitlement.requires-adapters',
        neededWith: ['tenantBilling', 'entitlement', 'subscriptionBundles'],
        orOption: 'adapters.subscriptionRepository',
        models: ['Subscription'],
    },
    'entitlement.planVersionRepository': {
        refusedBy: 'entitlement.requires-adapters',
        neededWith: ['tenantBilling', 'entitlement', 'subscriptionBundles'],
        orOption: 'adapters.planVersionRepository',
        models: ['PlanVersion'],
    },
    'core.tenantAccessHolds': {
        refusedBy: 'tenant-access.requires-holds-port',
        neededWith: ['tenantBilling', 'adminResources'],
        models: ['TenantAccessHold'],
    },
    'core.subscriptionEnds': {
        refusedBy: 'subscription-ends.requires-store',
        neededWith: ['tenantBilling'],
        orOption: 'tenantBilling.subscriptionEnds.store',
        models: ['SubscriptionEnd', 'SubscriptionEndAnnouncement', 'TenantExportDownload'],
    },
    'tenantBilling.subscriptionNotices': {
        refusedBy: 'subscription-notices.requires-record',
        neededWith: ['tenantBilling'],
        orOption: 'tenantBilling.notices.record',
        models: ['SubscriptionNotice'],
    },
} as const satisfies Readonly<Record<string, TenantServingMember>>;
