import { planNotInCatalog } from '@saasicat/core';
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

export interface PrismaPlanBindingOptions {
    mode?: PrismaPlanBindingMode;
}

/**
 * Prisma delegate names used by the two independent plan-version slices.
 * Both default to `planVersion`, preserving the 0.6 canonical schema.
 */
export interface PrismaPlanDelegateOptions {
    catalogPlanVersion?: string;
    entitlementPlanVersion?: string;
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
}

/**
 * Schema differences understood by the plan-related Prisma adapters.
 *
 * Every plan-version model carries `validFrom`, `validUntil` and `endsAt`, as
 * the canonical schema does: which version is on sale is decided by those
 * dates everywhere, so there is no setting that leaves them out.
 */
export interface PrismaSchemaOptions {
    planBinding?: PrismaPlanBindingOptions;
    delegates?: PrismaPlanDelegateOptions;
    tenantSubscription?: PrismaTenantSubscriptionOptions;
}

export interface ResolvedPrismaSchemaOptions {
    planBinding: {
        mode: PrismaPlanBindingMode;
    };
    delegates: {
        catalogPlanVersion: string;
        entitlementPlanVersion: string;
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
    planKey: string;
}

interface PlanIdentityClient {
    plan: PrismaModelDelegateLike<PlanIdentityRow>;
}

export interface PrismaPlanBindingResolver {
    readonly mode: PrismaPlanBindingMode;
    /** The stored id of the plan a write targets; a key no live plan has is an error. */
    toStoragePlanId(client: unknown, planKey: string): Promise<string>;
    /**
     * The stored id a read looks versions up by, or `null` when no plan row has
     * the key. A retired plan is found: its versions stay readable, and the
     * deletion guard that counts them must not be told it has none.
     */
    findStoragePlanId(client: unknown, planKey: string): Promise<string | null>;
    toPlanKey(client: unknown, storedPlanId: string): Promise<string>;
}

const DEFAULT_SCHEMA_OPTIONS: ResolvedPrismaSchemaOptions = {
    planBinding: { mode: 'legacy-plan-key' },
    delegates: {
        catalogPlanVersion: 'planVersion',
        entitlementPlanVersion: 'planVersion',
    },
    tenantSubscription: {
        delegate: 'subscription',
        subscriptionBundleDelegate: false,
        synchronizePlanVersion: true,
        atomicOnboardingSelection: false,
    },
};

export function resolvePrismaSchemaOptions(
    options?: PrismaSchemaOptions,
): ResolvedPrismaSchemaOptions {
    const mode = options?.planBinding?.mode ?? 'legacy-plan-key';

    return {
        planBinding: { mode },
        delegates: {
            catalogPlanVersion:
                options?.delegates?.catalogPlanVersion ??
                DEFAULT_SCHEMA_OPTIONS.delegates.catalogPlanVersion,
            entitlementPlanVersion:
                options?.delegates?.entitlementPlanVersion ??
                DEFAULT_SCHEMA_OPTIONS.delegates.entitlementPlanVersion,
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
        },
    };
}

export function createPrismaPlanBindingResolver(
    options?: PrismaPlanBindingOptions,
): PrismaPlanBindingResolver {
    const resolved = resolvePrismaSchemaOptions({ planBinding: options }).planBinding;

    return {
        mode: resolved.mode,

        async toStoragePlanId(client, planKey) {
            if (resolved.mode === 'legacy-plan-key') return planKey;

            const plan = await asPlanIdentityClient(client).plan.findFirst({
                where: { planKey, deletedAt: null },
            });
            if (!plan) throw planNotInCatalog(planKey);
            return plan.id;
        },

        async findStoragePlanId(client, planKey) {
            if (resolved.mode === 'legacy-plan-key') return planKey;

            const plan = await asPlanIdentityClient(client).plan.findFirst({
                where: { planKey },
            });
            return plan?.id ?? null;
        },

        async toPlanKey(client, storedPlanId) {
            if (resolved.mode === 'legacy-plan-key') return storedPlanId;

            const plan = await asPlanIdentityClient(client).plan.findUnique({
                where: { id: storedPlanId },
            });
            if (!plan) {
                throw new Error(`Plan id '${storedPlanId}' not found.`);
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
        throw new Error(
            `Prisma client has no '${delegateName}' delegate. If your model is called something ` +
                'else, map it — `adminResources: { delegates: { tenant: "organization" } }` for ' +
                'the SuperAdmin resources, `schema` for the plan binding.',
        );
    }
    return delegate as PrismaModelDelegateLike<Row>;
}

function asPlanIdentityClient(client: unknown): PlanIdentityClient {
    if (!client || typeof client !== 'object' || !('plan' in client)) {
        throw new Error("Prisma client has no 'plan' delegate.");
    }
    return client as PlanIdentityClient;
}
