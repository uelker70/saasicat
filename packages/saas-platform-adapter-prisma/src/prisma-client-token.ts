// PRISMA_CLIENT_TOKEN — DI token to which the consumer binds their
// PrismaService. All adapters in the package inject against this token so they
// do not depend on a concrete `PrismaService` class token. With the
// `prismaPersistence({ client })` bundle the binding happens implicitly; the
// token remains for manual wiring:
//
// ```ts
// providers: [
//     { provide: PRISMA_CLIENT_TOKEN, useExisting: PrismaService },
//     PrismaMfaAdapter,
//     // ...
// ];
// ```

export const PRISMA_CLIENT_TOKEN = Symbol.for('saasicat/adapter-prisma/PrismaClient');

/** Prisma `Decimal` values arrive as objects with `toString()`; tests may use plain values. */
export type DecimalLike = { toString(): string } | string | number;

// -----------------------------------------------------------------------------
// Row shapes — structural minimum of the canonical tables
// (@saasicat/spec prisma-fragments). Generated Prisma rows carry more
// fields; adapters only rely on these.
// -----------------------------------------------------------------------------

export interface SubscriptionRowLike {
    id: string;
    tenantId: string;
    plan: string;
    billingCycle: string;
    status: string;
    isPilot: boolean;
    trialEntitlementPlan: string | null;
    pendingPlan: string | null;
    pendingEffectiveAt: Date | null;
    customLimits: unknown;
    planVersionId: string;
    pendingPlanVersionId: string | null;
    startedAt: Date | null;
}

export interface PlanVersionRowLike {
    id: string;
    planId: string;
    version: number;
    baseVersionId: string | null;
    features: unknown;
    quotas: unknown;
    monthlyNet: DecimalLike;
    yearlyNet: DecimalLike;
    marketed: boolean;
    publishedAt: Date | null;
    supersededAt: Date | null;
    publishedChanges: unknown;
    changeNote: string;
    nonRegressive: boolean;
    createdByUserId: string | null;
    publishedByUserId: string | null;
    validFrom?: Date | null;
    validUntil?: Date | null;
    endsAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface PlanRowLike {
    id: string;
    projectKey: string;
    planKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

export interface FeatureCatalogEntryRowLike {
    id: string;
    projectKey: string;
    featureKey: string;
    label: string;
    description: string | null;
    marketingLabel: string | null;
    marketingDescription: string | null;
    icon: string | null;
    tier: string | null;
    discoveryStatus: string;
    requires: string[];
    replaces: string[];
    successorKey: string | null;
    approvedAt: Date | null;
    approvedBy: string | null;
    approvedSignature: string | null;
    plannedOnly: boolean;
    core: boolean;
    i18n: unknown;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

export interface PromoCodeRowLike {
    id: string;
    code: string;
    valueType: string;
    value: DecimalLike;
    durationType: string;
    durationValue: number | null;
    validFrom: Date | null;
    validUntil: Date | null;
    maxRedemptions: number | null;
    redemptionsCount: number;
    appliesToPlans: string[];
    appliesToBilling: string | null;
    firstTimeCustomersOnly: boolean;
    minimumPlanAmountGross: DecimalLike | null;
    allowZeroInvoice: boolean;
    status: string;
    description: string | null;
    campaignTag: string | null;
    revenueDeductionAccount: string | null;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

export interface PromoCodeRedemptionRowLike {
    id: string;
    promoCodeId: string;
    subscriptionId: string;
    tenantId: string;
    appliedValueType: string;
    appliedValue: DecimalLike;
    appliedDurationType: string;
    appliedDurationValue: number | null;
    startsAt: Date;
    endsAt: Date | null;
    status: string;
    redeemedAt: Date;
    reversedAt: Date | null;
}

export interface AuditLogRowLike {
    id: string;
    tenantId: string | null;
    userId: string | null;
    entity: string;
    entityId: string;
    action: string;
    changes: unknown;
    actorTag: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
}

export interface SuperAdminUserRowLike {
    id: string;
    email: string;
    passwordHash: string;
    firstName: string | null;
    lastName: string | null;
    platformRole: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

// -----------------------------------------------------------------------------
// Delegate shapes. Deliberately without `select`/`include` args — flat calls
// keep the structural typing robust against the generated Prisma client's
// generics. Relations are loaded with explicit second queries instead.
// -----------------------------------------------------------------------------

type SortDirection = 'asc' | 'desc';

export interface SubscriptionDelegateLike {
    findUnique(args: {
        where: { id?: string; tenantId?: string };
    }): Promise<SubscriptionRowLike | null>;
    findMany(args?: { where?: { status?: { in: string[] } } }): Promise<SubscriptionRowLike[]>;
    count(args?: {
        where?: { OR?: Array<{ planVersionId?: string; pendingPlanVersionId?: string }> };
    }): Promise<number>;
}

export interface PlanVersionDelegateLike {
    findUnique(args: { where: { id: string } }): Promise<PlanVersionRowLike | null>;
    findFirst(args: {
        where: {
            planId?: string;
            version?: number;
            publishedAt?: { not: null } | null;
            supersededAt?: null;
        };
        orderBy?: { version?: SortDirection };
    }): Promise<PlanVersionRowLike | null>;
    findMany(args?: {
        where?: {
            planId?: { in: string[] };
            publishedAt?: { not: null } | null;
            supersededAt?: null;
        };
    }): Promise<PlanVersionRowLike[]>;
    create(args: {
        data: {
            planId: string;
            version: number;
            features: unknown;
            quotas: unknown;
            monthlyNet: string;
            yearlyNet: string;
            marketed: boolean;
            publishedAt: Date | null;
            changeNote: string;
        };
    }): Promise<PlanVersionRowLike>;
    updateMany(args: {
        where: {
            planId?: string;
            publishedAt?: { not: null } | null;
            supersededAt?: null;
            version?: { lt: number };
        };
        data: { supersededAt?: Date };
    }): Promise<{ count: number }>;
}

export interface PlanDelegateLike {
    findFirst(args: {
        where: { projectKey?: string; planKey?: string; deletedAt?: null };
    }): Promise<PlanRowLike | null>;
    findMany(args?: {
        where?: { projectKey?: string; deletedAt?: null };
        orderBy?: { sortOrder?: SortDirection };
    }): Promise<PlanRowLike[]>;
    create(args: {
        data: {
            projectKey: string;
            planKey: string;
            label: string;
            description?: string | null;
            sortOrder?: number;
        };
    }): Promise<PlanRowLike>;
}

export interface FeatureCatalogEntryDelegateLike {
    findFirst(args: {
        where: { projectKey?: string; featureKey?: string; deletedAt?: null };
    }): Promise<FeatureCatalogEntryRowLike | null>;
    findMany(args?: {
        where?: { projectKey?: string; deletedAt?: null };
        orderBy?: { sortOrder?: SortDirection };
    }): Promise<FeatureCatalogEntryRowLike[]>;
    create(args: {
        data: {
            projectKey: string;
            featureKey: string;
            label: string;
            icon?: string | null;
            tier?: string | null;
            plannedOnly?: boolean;
            core?: boolean;
        };
    }): Promise<FeatureCatalogEntryRowLike>;
}

export interface PromoCodeDelegateLike {
    findUnique(args: { where: { id?: string; code?: string } }): Promise<PromoCodeRowLike | null>;
    findMany(args?: {
        where?: {
            deletedAt?: null;
            status?: string;
            campaignTag?: string;
            code?: { contains: string };
        };
        orderBy?: { createdAt?: SortDirection };
    }): Promise<PromoCodeRowLike[]>;
    create(args: {
        data: {
            code: string;
            valueType: string;
            value: string;
            durationType: string;
            durationValue: number | null;
            validFrom: Date | null;
            validUntil: Date | null;
            maxRedemptions: number | null;
            appliesToPlans: string[];
            appliesToBilling: string | null;
            firstTimeCustomersOnly: boolean;
            minimumPlanAmountGross: string | null;
            allowZeroInvoice: boolean;
            description: string | null;
            campaignTag: string | null;
            revenueDeductionAccount: string | null;
            createdById: string;
        };
    }): Promise<PromoCodeRowLike>;
    update(args: {
        where: { id: string };
        data: {
            status?: string;
            description?: string | null;
            validUntil?: Date | null;
            maxRedemptions?: number | null;
            deletedAt?: Date;
        };
    }): Promise<PromoCodeRowLike>;
    updateMany(args: {
        where: { status?: { in: string[] }; validUntil?: { lt: Date } };
        data: { status?: string };
    }): Promise<{ count: number }>;
}

export interface PromoCodeRedemptionDelegateLike {
    findUnique(args: {
        where: { id?: string; subscriptionId?: string };
    }): Promise<PromoCodeRedemptionRowLike | null>;
    findMany(args?: {
        where?: { promoCodeId?: string };
        orderBy?: { redeemedAt?: SortDirection };
    }): Promise<PromoCodeRedemptionRowLike[]>;
    create(args: {
        data: {
            promoCodeId: string;
            subscriptionId: string;
            tenantId: string;
            appliedValueType: string;
            appliedValue: string;
            appliedDurationType: string;
            appliedDurationValue: number | null;
            startsAt: Date;
            endsAt: Date | null;
        };
    }): Promise<PromoCodeRedemptionRowLike>;
    update(args: {
        where: { id: string };
        data: { status?: string; reversedAt?: Date | null };
    }): Promise<PromoCodeRedemptionRowLike>;
    count(args?: { where?: { promoCodeId?: string; status?: string } }): Promise<number>;
    updateMany(args: {
        where: { status?: string; endsAt?: { lt: Date } };
        data: { status?: string };
    }): Promise<{ count: number }>;
}

export interface PromoCodeValidationLogDelegateLike {
    create(args: {
        data: {
            promoCodeId: string | null;
            codeAttempt: string;
            result: string;
            ipHash?: string | null;
            sessionId?: string | null;
        };
    }): Promise<unknown>;
    count(args?: { where?: { promoCodeId?: string; result?: string } }): Promise<number>;
}

export interface AuditLogDelegateLike {
    create(args: {
        data: {
            tenantId: string | null;
            userId: string | null;
            entity: string;
            entityId: string;
            action: string;
            changes: unknown;
            actorTag: string | null;
        };
    }): Promise<unknown>;
    findMany(args?: {
        where?: {
            tenantId?: string;
            userId?: string;
            entity?: string;
            entityId?: string;
            action?: string;
            actorTag?: string | { startsWith: string };
            createdAt?: { gte?: Date; lte?: Date };
        };
        orderBy?: { createdAt?: SortDirection };
        skip?: number;
        take?: number;
    }): Promise<AuditLogRowLike[]>;
    count(args?: { where?: { createdAt?: { gte?: Date } } }): Promise<number>;
}

export interface SuperAdminUserDelegateLike {
    findUnique(args: { where: { email: string } }): Promise<SuperAdminUserRowLike | null>;
    count(args?: { where?: { isActive?: boolean; deletedAt?: null } }): Promise<number>;
    create(args: {
        data: {
            email: string;
            passwordHash: string;
            firstName?: string | null;
            lastName?: string | null;
        };
    }): Promise<SuperAdminUserRowLike>;
}

export interface SuperAdminMfaDelegateLike {
    findUnique(args: { where: { userId: string } }): Promise<{
        userId: string;
        secret: string | null;
        enabledAt: Date | null;
        updatedAt: Date;
    } | null>;
    upsert(args: {
        where: { userId: string };
        create: { userId: string; secret: string | null; enabledAt: Date | null };
        update: { secret: string | null; enabledAt: Date | null };
    }): Promise<unknown>;
}

/**
 * Structural sub-interface of a Prisma transaction client
 * (`Prisma.TransactionClient`): the table delegates plus raw access, without
 * `$transaction`. Repository methods that accept an opaque
 * `TransactionContext` cast it to this shape.
 */
export interface PrismaTxLike {
    subscription: SubscriptionDelegateLike;
    planVersion: PlanVersionDelegateLike;
    plan: PlanDelegateLike;
    featureCatalogEntry: FeatureCatalogEntryDelegateLike;
    promoCode: PromoCodeDelegateLike;
    promoCodeRedemption: PromoCodeRedemptionDelegateLike;
    promoCodeValidationLog: PromoCodeValidationLogDelegateLike;
    auditLog: AuditLogDelegateLike;
    superAdminUser: SuperAdminUserDelegateLike;
    superAdminMfa: SuperAdminMfaDelegateLike;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * Structural sub-interface of `@prisma/client.PrismaClient`. The adapters
 * expect only the delegates they actually use — no hard import on
 * `@prisma/client`, so the package builds without a Prisma generate and can be
 * mocked in tests.
 *
 * A consumer's `PrismaService extends PrismaClient` (generated from the
 * canonical prisma-fragments schema) satisfies the interface automatically.
 */
export interface PrismaLike extends PrismaTxLike {
    $transaction<T>(fn: (tx: PrismaTxLike) => Promise<T>): Promise<T>;
}

/**
 * Generic structural minimum of a Prisma model delegate. The catalog-plane
 * repositories (bundle, plan, catalog-entry, marketing,
 * promotion, contract) declare their own DB-row interfaces and view the
 * injected client through `{ model: PrismaModelDelegateLike<Row> }` casts —
 * this keeps each repo self-contained and avoids hard-coding every delegate on
 * `PrismaTxLike`. Args mirror Prisma's `where`/`data`/`select`/`orderBy` shapes
 * and are typed `unknown`: the repos build them inline and Prisma validates
 * them at runtime; only the results are typed, matching the package's
 * structural-minimum philosophy.
 */
export interface PrismaModelDelegateLike<Row> {
    findMany(args?: unknown): Promise<Row[]>;
    findUnique(args: unknown): Promise<Row | null>;
    findFirst(args?: unknown): Promise<Row | null>;
    create(args: unknown): Promise<Row>;
    update(args: unknown): Promise<Row>;
    delete(args: unknown): Promise<Row>;
    upsert(args: unknown): Promise<Row>;
    updateMany(args: unknown): Promise<{ count: number }>;
    createMany(args: unknown): Promise<{ count: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
    count(args?: unknown): Promise<number>;
}
