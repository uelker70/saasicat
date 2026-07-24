import type { PrismaModelDelegateLike } from './prisma-client-token.js';

/**
 * How `PlanVersion.planId` is persisted.
 *
 * - `legacy-plan-key`: SaaSiCat 0.6 behavior. `planId` stores the semantic
 *   `Plan.planKey` directly and no lookup is performed.
 * - `normalized-plan-id`: `planId` stores the database `Plan.id` foreign key.
 *   Adapter ports still accept and return semantic plan keys.
 */
export type PrismaPlanBindingMode = 'legacy-plan-key' | 'normalized-plan-id';

export type PrismaPlanBindingOptions =
    | {
          mode?: 'legacy-plan-key';
          projectKey?: string;
      }
    | {
          mode: 'normalized-plan-id';
          projectKey: string;
      };

/**
 * Prisma delegate names used by the two independent plan-version slices.
 * Both default to `planVersion`, preserving the 0.6 canonical schema.
 */
export interface PrismaPlanDelegateOptions {
    catalogPlanVersion?: string;
    entitlementPlanVersion?: string;
}

export interface PrismaPlanVersionFieldCapabilities {
    /** The delegate carries `validFrom` and `validUntil` columns. */
    validityWindows?: boolean;
    /** The delegate carries the optional, precise `endsAt` timestamp. */
    endsAt?: boolean;
}

/**
 * Shared field defaults plus optional per-slice overrides. A consumer with
 * one plan-version model can set the top-level flags; split schemas can
 * configure catalog and entitlement independently.
 */
export interface PrismaPlanVersionFieldOptions extends PrismaPlanVersionFieldCapabilities {
    catalog?: PrismaPlanVersionFieldCapabilities;
    entitlement?: PrismaPlanVersionFieldCapabilities;
}

export interface PrismaTenantSubscriptionOptions {
    /**
     * Prisma model delegate used for every Subscription ORM operation.
     * Locked reads still address the canonical physical `subscriptions`
     * table, so a differently named model must use `@@map("subscriptions")`.
     */
    delegate?: string;
    /**
     * Optional SubscriptionBundle delegate used for BundleVersion booking
     * counts. `false` keeps the capability absent for schemas without the
     * junction table.
     */
    subscriptionBundleDelegate?: string | false;
    synchronizePlanVersion?: boolean;
    /** Expose the optional atomic onboarding + promo callback capability. */
    atomicOnboardingSelection?: boolean;
    activeVersionSelection?: 'latest-live' | 'validity-window';
    withEndsAt?: boolean;
}

/** Schema differences understood by the plan-related Prisma adapters. */
export interface PrismaSchemaOptions {
    planBinding?: PrismaPlanBindingOptions;
    delegates?: PrismaPlanDelegateOptions;
    planVersionFields?: PrismaPlanVersionFieldOptions;
    tenantSubscription?: PrismaTenantSubscriptionOptions;
}

export interface ResolvedPrismaSchemaOptions {
    planBinding: {
        mode: PrismaPlanBindingMode;
        projectKey?: string;
    };
    delegates: {
        catalogPlanVersion: string;
        entitlementPlanVersion: string;
    };
    planVersionFields: {
        catalog: Required<PrismaPlanVersionFieldCapabilities>;
        entitlement: Required<PrismaPlanVersionFieldCapabilities>;
    };
    tenantSubscription: Required<PrismaTenantSubscriptionOptions>;
}

/**
 * Optional DI token for direct Nest registration of individual adapters.
 * `prismaPersistence()` passes the options to constructors itself.
 */
export const PRISMA_SCHEMA_OPTIONS_TOKEN = Symbol.for(
    'saasicat/adapter-prisma/PrismaSchemaOptions',
);

interface PlanIdentityRow {
    id: string;
    projectKey: string;
    planKey: string;
}

interface PlanIdentityClient {
    plan: PrismaModelDelegateLike<PlanIdentityRow>;
}

export interface PrismaPlanBindingResolver {
    readonly mode: PrismaPlanBindingMode;
    readonly projectKey?: string;
    toStoragePlanId(client: unknown, planKey: string, projectKey?: string): Promise<string>;
    toPlanKey(client: unknown, storedPlanId: string, projectKey?: string): Promise<string>;
}

const DEFAULT_SCHEMA_OPTIONS: ResolvedPrismaSchemaOptions = {
    planBinding: { mode: 'legacy-plan-key' },
    delegates: {
        catalogPlanVersion: 'planVersion',
        entitlementPlanVersion: 'planVersion',
    },
    planVersionFields: {
        catalog: { validityWindows: false, endsAt: false },
        entitlement: { validityWindows: false, endsAt: false },
    },
    tenantSubscription: {
        delegate: 'subscription',
        subscriptionBundleDelegate: false,
        synchronizePlanVersion: false,
        atomicOnboardingSelection: false,
        activeVersionSelection: 'latest-live',
        withEndsAt: false,
    },
};

export function resolvePrismaSchemaOptions(
    options?: PrismaSchemaOptions,
): ResolvedPrismaSchemaOptions {
    const mode = options?.planBinding?.mode ?? 'legacy-plan-key';
    const projectKey = options?.planBinding?.projectKey;
    if (mode === 'normalized-plan-id' && !projectKey?.trim()) {
        throw new Error(
            "Prisma plan binding mode 'normalized-plan-id' requires a non-empty projectKey.",
        );
    }
    const sharedFields = options?.planVersionFields;
    const catalogFields = sharedFields?.catalog;
    const entitlementFields = sharedFields?.entitlement;

    return {
        planBinding: {
            mode,
            ...(projectKey ? { projectKey } : {}),
        },
        delegates: {
            catalogPlanVersion:
                options?.delegates?.catalogPlanVersion ??
                DEFAULT_SCHEMA_OPTIONS.delegates.catalogPlanVersion,
            entitlementPlanVersion:
                options?.delegates?.entitlementPlanVersion ??
                DEFAULT_SCHEMA_OPTIONS.delegates.entitlementPlanVersion,
        },
        planVersionFields: {
            catalog: {
                validityWindows:
                    catalogFields?.validityWindows ?? sharedFields?.validityWindows ?? false,
                endsAt: catalogFields?.endsAt ?? sharedFields?.endsAt ?? false,
            },
            entitlement: {
                validityWindows:
                    entitlementFields?.validityWindows ?? sharedFields?.validityWindows ?? false,
                endsAt: entitlementFields?.endsAt ?? sharedFields?.endsAt ?? false,
            },
        },
        tenantSubscription: {
            delegate:
                options?.tenantSubscription?.delegate ??
                DEFAULT_SCHEMA_OPTIONS.tenantSubscription.delegate,
            subscriptionBundleDelegate:
                options?.tenantSubscription?.subscriptionBundleDelegate ??
                DEFAULT_SCHEMA_OPTIONS.tenantSubscription.subscriptionBundleDelegate,
            synchronizePlanVersion:
                options?.tenantSubscription?.synchronizePlanVersion ??
                DEFAULT_SCHEMA_OPTIONS.tenantSubscription.synchronizePlanVersion,
            atomicOnboardingSelection:
                options?.tenantSubscription?.atomicOnboardingSelection ??
                DEFAULT_SCHEMA_OPTIONS.tenantSubscription.atomicOnboardingSelection,
            activeVersionSelection:
                options?.tenantSubscription?.activeVersionSelection ??
                DEFAULT_SCHEMA_OPTIONS.tenantSubscription.activeVersionSelection,
            withEndsAt:
                options?.tenantSubscription?.withEndsAt ??
                DEFAULT_SCHEMA_OPTIONS.tenantSubscription.withEndsAt,
        },
    };
}

export function createPrismaPlanBindingResolver(
    options?: PrismaPlanBindingOptions,
): PrismaPlanBindingResolver {
    const resolved = resolvePrismaSchemaOptions({ planBinding: options }).planBinding;

    return {
        mode: resolved.mode,
        projectKey: resolved.projectKey,

        async toStoragePlanId(client, planKey, projectKey) {
            if (resolved.mode === 'legacy-plan-key') return planKey;

            const scope = resolveProjectKey(resolved.projectKey, projectKey);
            const plan = await asPlanIdentityClient(client).plan.findFirst({
                where: { projectKey: scope, planKey, deletedAt: null },
            });
            if (!plan) {
                throw new Error(`Plan '${planKey}' not found in project '${scope}'.`);
            }
            return plan.id;
        },

        async toPlanKey(client, storedPlanId, projectKey) {
            if (resolved.mode === 'legacy-plan-key') return storedPlanId;

            const scope = resolveProjectKey(resolved.projectKey, projectKey);
            const plan = await asPlanIdentityClient(client).plan.findUnique({
                where: { id: storedPlanId },
            });
            if (!plan || plan.projectKey !== scope) {
                throw new Error(`Plan id '${storedPlanId}' not found in project '${scope}'.`);
            }
            return plan.planKey;
        },
    };
}

/** Resolves a configurable Prisma delegate and fails early on misspellings. */
export function getPrismaDelegate<Row>(
    client: unknown,
    delegateName: string,
): PrismaModelDelegateLike<Row> {
    const delegate = (client as Record<string, unknown> | null)?.[delegateName];
    if (!delegate || typeof delegate !== 'object') {
        throw new Error(`Prisma client has no '${delegateName}' delegate.`);
    }
    return delegate as PrismaModelDelegateLike<Row>;
}

function resolveProjectKey(configured?: string, requested?: string): string {
    const projectKey = requested ?? configured;
    if (!projectKey) {
        throw new Error("Prisma plan binding mode 'normalized-plan-id' requires a projectKey.");
    }
    if (configured && requested && configured !== requested) {
        throw new Error(
            `Prisma plan binding is configured for project '${configured}', not '${requested}'.`,
        );
    }
    return projectKey;
}

function asPlanIdentityClient(client: unknown): PlanIdentityClient {
    if (!client || typeof client !== 'object' || !('plan' in client)) {
        throw new Error("Prisma client has no 'plan' delegate.");
    }
    return client as PlanIdentityClient;
}
