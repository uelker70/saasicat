/**
 * The canonical models a schema may leave out, each with the persistence
 * bundle members that need it.
 *
 * `saasicat schema check` lists every canonical model it does not find as not
 * adopted. Naming one of these in a bundle's `notAdopted` leaves its members
 * out of the bundle, so the platform decides at start what it can do without
 * them — and says so where it cannot — instead of the first request failing
 * against a table that is not there. Any other model the bundle needs: an
 * application that leaves it out brings its own adapter for it.
 */
export const OPTIONAL_CANONICAL_MODELS = {
    SuperAdminUser: ['core.superAdminProvisioning'],
    SuperAdminMfa: ['core.mfa'],
    AppliedSettings: ['core.appliedSettings'],
    SettingsChange: ['core.appliedSettings'],
    MaintenanceWindow: ['core.maintenanceWindows'],
    SubscriptionNotice: ['tenantBilling.subscriptionNotices'],
    VersionRetirement: ['tenantBilling.versionRetirements'],
    SubscriberLedgerEntry: ['entitlement.subscriberLedgerRepository'],
    PromoCodeHold: ['promo.holdRepository'],
} as const;

export type OptionalCanonicalModel = keyof typeof OPTIONAL_CANONICAL_MODELS;

/** A bundle member one of the optional models is needed by. */
export type OptionalBundleMember =
    (typeof OPTIONAL_CANONICAL_MODELS)[OptionalCanonicalModel][number];

/**
 * The bundle members a `notAdopted` list leaves out.
 *
 * A name that is not one of the optional models is refused rather than
 * ignored: a typo would otherwise leave a member in that fails at its first
 * request, and a model the bundle cannot run without needs the application's
 * own adapter, which only the application can supply.
 */
export function membersLeftOut(
    notAdopted: readonly string[] = [],
): ReadonlySet<OptionalBundleMember> {
    const unknown = notAdopted.filter((model) => !Object.hasOwn(OPTIONAL_CANONICAL_MODELS, model));
    if (unknown.length > 0) {
        throw new Error(
            `notAdopted names ${unknown.join(', ')}, which the persistence bundle cannot leave ` +
                `out. It can leave out ${Object.keys(OPTIONAL_CANONICAL_MODELS).join(', ')}; ` +
                'for any other model it needs, pass your own adapter for the port that model ' +
                'serves.',
        );
    }
    return new Set(
        notAdopted.flatMap((model) => OPTIONAL_CANONICAL_MODELS[model as OptionalCanonicalModel]),
    );
}
