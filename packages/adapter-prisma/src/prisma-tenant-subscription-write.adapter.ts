import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    ApplyOnboardingSelectionInput,
    ApplyOnboardingSelectionResult,
    ImmediatePlanChangeInput,
    PromoCodeRedemptionRecord,
    RedeemPromoInTransactionCallback,
    ScheduledPlanChangeInput,
    TenantSubscriptionWritePort,
    TransactionContext,
} from '@saasicat/types';
import { buildActivePlanVersionWhere } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';
import {
    createPrismaPlanBindingResolver,
    getPrismaDelegate,
    PRISMA_SCHEMA_OPTIONS_TOKEN,
    resolvePrismaSchemaOptions,
    type PrismaPlanBindingResolver,
    type PrismaSchemaOptions,
    type ResolvedPrismaSchemaOptions,
} from './prisma-plan-binding.js';

/** DB columns this adapter reads back from `subscriptions`. */
interface SubscriptionDbRow {
    id: string;
    plan: string;
    billingCycle: string;
    status: string;
    canceledAt: Date | null;
    currentPeriodEnd: Date | null;
    pendingPlanVersionAccepted: boolean;
    pendingPlanVersionAcceptedAt: Date | null;
    pendingPlanVersionEffectiveAt: Date | null;
    pendingPlanVersionId: string | null;
}

interface PlanVersionIdentityDbRow {
    id: string;
    planId: string;
}

/** Structural minimum of the root client; model delegates are configurable. */
interface TransactionalPrismaClient {
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/**
 * `TenantSubscriptionWritePort` against a configurable Prisma subscription
 * delegate.
 *
 * The 0.6 default remains deliberately conservative:
 * `tenantSubscription.synchronizePlanVersion` is false, so
 * `changePlanImmediate` writes the semantic `plan` and cycle exactly as
 * before. Opting into synchronization resolves the target plan through the
 * configured plan binding, selects its live/active PlanVersion, and writes
 * `plan` + `planVersionId` in one transaction.
 *
 * Pure persistence: trial carry-over (#17) and contract freeze (#18) are
 * resolved in the platform `changePlan` path and handed down as plain values —
 * this adapter only writes what it receives.
 *
 * `applyOnboardingSelection` is an explicit opt-in capability. When
 * `tenantSubscription.atomicOnboardingSelection` is true it uses one
 * interactive transaction for the subscription write and optional promo
 * callback. In synchronized mode it also binds the concrete PlanVersion and
 * clears stale pending-version state.
 */
@Injectable()
export class PrismaTenantSubscriptionWriteAdapter implements TenantSubscriptionWritePort {
    readonly applyOnboardingSelection?: (
        tenantId: string,
        input: ApplyOnboardingSelectionInput,
        redeemPromo: RedeemPromoInTransactionCallback | null,
    ) => Promise<ApplyOnboardingSelectionResult>;

    private readonly schema: ResolvedPrismaSchemaOptions;
    private readonly planBinding: PrismaPlanBindingResolver;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: TransactionalPrismaClient,
        @Optional()
        @Inject(PRISMA_SCHEMA_OPTIONS_TOKEN)
        options?: PrismaSchemaOptions,
    ) {
        this.schema = resolvePrismaSchemaOptions(options);
        this.planBinding = createPrismaPlanBindingResolver(options?.planBinding);
        this.assertConfiguration();
        if (this.schema.tenantSubscription.atomicOnboardingSelection) {
            this.applyOnboardingSelection = (tenantId, input, redeemPromo) =>
                this.applyOnboardingSelectionAtomic(tenantId, input, redeemPromo);
        }
    }

    async changePlanImmediate(
        tenantId: string,
        input: ImmediatePlanChangeInput,
    ): Promise<{ plan: string; billingCycle: string }> {
        if (this.schema.tenantSubscription.synchronizePlanVersion) {
            return this.prisma.$transaction((tx) =>
                this.changePlanImmediateInClient(tx, tenantId, input),
            );
        }
        return this.changePlanImmediateInClient(this.prisma, tenantId, input);
    }

    private async changePlanImmediateInClient(
        client: unknown,
        tenantId: string,
        input: ImmediatePlanChangeInput,
    ): Promise<{ plan: string; billingCycle: string }> {
        const subscription = this.subscription(client);
        const data: Record<string, unknown> = {
            plan: input.planId,
            billingCycle: input.cycle,
            pendingPlan: null,
            pendingBillingCycle: null,
            pendingEffectiveAt: null,
            ...(input.nextStatus ? { status: input.nextStatus } : {}),
            ...(input.periodStart && input.periodEnd
                ? { currentPeriodStart: input.periodStart, currentPeriodEnd: input.periodEnd }
                : {}),
            // #17: the platform changePlan path computes the carried-over
            // trial end and passes it through; null/undefined leaves the
            // existing trialEndsAt untouched.
            ...(input.trialEndsAt ? { trialEndsAt: input.trialEndsAt } : {}),
        };

        if (this.schema.tenantSubscription.synchronizePlanVersion) {
            const current = await subscription.findUnique({ where: { tenantId } });
            if (!current) {
                throw new Error(`No subscription for tenant ${tenantId}.`);
            }
            const storagePlanId = await this.planBinding.toStoragePlanId(client, input.planId);
            data.planVersionId = await this.findTargetPlanVersionId(
                client,
                storagePlanId,
                input.periodStart ?? new Date(),
            );
            if (
                await this.pendingVersionBelongsToAnotherPlan(
                    client,
                    current.pendingPlanVersionId,
                    storagePlanId,
                )
            ) {
                Object.assign(data, clearedPendingVersionData());
            }
        }

        const updated = await subscription.update({
            where: { tenantId },
            data,
        });
        return { plan: updated.plan, billingCycle: updated.billingCycle };
    }

    async schedulePlanChange(tenantId: string, input: ScheduledPlanChangeInput): Promise<void> {
        await this.subscription(this.prisma).update({
            where: { tenantId },
            data: {
                pendingPlan: input.pendingPlan,
                pendingBillingCycle: input.pendingBillingCycle,
                pendingEffectiveAt: input.pendingEffectiveAt,
            },
        });
    }

    async acceptPendingPlanVersion(
        tenantId: string,
        userId: string,
        now: Date,
    ): Promise<{
        accepted: boolean;
        acceptedAt: Date | null;
        effectiveAt: Date | null;
        alreadyAccepted: boolean;
    }> {
        const subscription = this.subscription(this.prisma);
        const sub = await subscription.findUnique({ where: { tenantId } });
        if (!sub) {
            throw new Error(`No subscription for tenant ${tenantId}.`);
        }
        if (!sub.pendingPlanVersionId) {
            throw new Error(`No pending PlanVersion for tenant ${tenantId}.`);
        }
        const pendingPlanVersionId = sub.pendingPlanVersionId;
        const claimed = await subscription.updateMany({
            where: {
                id: sub.id,
                pendingPlanVersionId,
                pendingPlanVersionAccepted: false,
            },
            data: {
                pendingPlanVersionAccepted: true,
                pendingPlanVersionAcceptedAt: now,
                pendingPlanVersionAcceptedByUserId: userId,
            },
        });
        const updated = await subscription.findUnique({ where: { id: sub.id } });
        if (!updated) {
            throw new Error(`No subscription for tenant ${tenantId}.`);
        }
        if (
            claimed.count === 0 &&
            (updated.pendingPlanVersionId !== pendingPlanVersionId ||
                !updated.pendingPlanVersionAccepted)
        ) {
            throw new Error(
                `Pending PlanVersion changed while accepting it for tenant ${tenantId}.`,
            );
        }
        return {
            accepted: true,
            acceptedAt: updated.pendingPlanVersionAcceptedAt,
            effectiveAt: updated.pendingPlanVersionEffectiveAt,
            alreadyAccepted: claimed.count === 0,
        };
    }

    private async applyOnboardingSelectionAtomic(
        tenantId: string,
        input: ApplyOnboardingSelectionInput,
        redeemPromo: RedeemPromoInTransactionCallback | null,
    ): Promise<ApplyOnboardingSelectionResult> {
        return this.prisma.$transaction(async (tx) => {
            const data: Record<string, unknown> = {
                plan: input.planId,
                billingCycle: input.cycle,
                pendingPlan: null,
                pendingBillingCycle: null,
                pendingEffectiveAt: null,
                ...clearedPendingVersionData(),
                ...(input.nextStatus ? { status: input.nextStatus } : {}),
                ...(input.periodStart && input.periodEnd
                    ? { currentPeriodStart: input.periodStart, currentPeriodEnd: input.periodEnd }
                    : {}),
            };
            if (this.schema.tenantSubscription.synchronizePlanVersion) {
                const storagePlanId = await this.planBinding.toStoragePlanId(tx, input.planId);
                data.planVersionId = await this.findTargetPlanVersionId(
                    tx,
                    storagePlanId,
                    input.periodStart ?? new Date(),
                );
            }

            const updated = await this.subscription(tx).update({
                where: { tenantId },
                data,
            });
            let promoRedemption: PromoCodeRedemptionRecord | null = null;
            if (redeemPromo) {
                promoRedemption = await redeemPromo(tx as TransactionContext, updated.id);
            }
            return {
                plan: updated.plan,
                billingCycle: updated.billingCycle,
                subscriptionId: updated.id,
                promoRedemption,
            };
        });
    }

    async cancelSubscription(
        tenantId: string,
        immediate: boolean,
        now: Date,
    ): Promise<{ canceledAt: Date | null; status: string }> {
        const subscription = this.subscription(this.prisma);
        const sub = await subscription.findUnique({ where: { tenantId } });
        if (!sub) {
            throw new Error(`No subscription for tenant ${tenantId}.`);
        }
        const canceledAt = immediate ? now : (sub.currentPeriodEnd ?? now);
        const updated = await subscription.update({
            where: { tenantId },
            data: {
                canceledAt,
                status: immediate ? 'CANCELED' : sub.status,
            },
        });
        return { canceledAt: updated.canceledAt, status: updated.status };
    }

    private subscription(client: unknown): PrismaModelDelegateLike<SubscriptionDbRow> {
        return getPrismaDelegate<SubscriptionDbRow>(
            client,
            this.schema.tenantSubscription.delegate,
        );
    }

    private planVersions(client: unknown): PrismaModelDelegateLike<PlanVersionIdentityDbRow> {
        return getPrismaDelegate<PlanVersionIdentityDbRow>(
            client,
            this.schema.delegates.entitlementPlanVersion,
        );
    }

    private async findTargetPlanVersionId(
        client: unknown,
        storagePlanId: string,
        asOf: Date,
    ): Promise<string> {
        const activeWindow =
            this.schema.tenantSubscription.activeVersionSelection === 'validity-window';
        const activeVersionWhere = this.schema.tenantSubscription.withEndsAt
            ? buildActivePlanVersionWhere(asOf, { withEndsAt: true })
            : buildActivePlanVersionWhere(asOf);
        const where: Record<string, unknown> = activeWindow
            ? {
                  planId: storagePlanId,
                  ...activeVersionWhere,
              }
            : {
                  planId: storagePlanId,
                  publishedAt: { not: null },
                  supersededAt: null,
                  ...(this.schema.tenantSubscription.withEndsAt
                      ? {
                            OR: [{ endsAt: null }, { endsAt: { gt: asOf } }],
                        }
                      : {}),
              };
        const target = await this.planVersions(client).findFirst({
            where,
            orderBy: activeWindow
                ? [{ validFrom: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }]
                : { version: 'desc' },
        });
        if (!target) {
            throw new Error(`No active PlanVersion for plan '${storagePlanId}'.`);
        }
        return target.id;
    }

    private async pendingVersionBelongsToAnotherPlan(
        client: unknown,
        pendingPlanVersionId: string | null,
        targetStoragePlanId: string,
    ): Promise<boolean> {
        if (!pendingPlanVersionId) return false;
        const pending = await this.planVersions(client).findUnique({
            where: { id: pendingPlanVersionId },
        });
        return !pending || pending.planId !== targetStoragePlanId;
    }

    private assertConfiguration(): void {
        if (!this.schema.tenantSubscription.synchronizePlanVersion) return;
        const entitlementFields = this.schema.planVersionFields.entitlement;
        if (
            this.schema.tenantSubscription.activeVersionSelection === 'validity-window' &&
            !entitlementFields.validityWindows
        ) {
            throw new Error(
                "tenantSubscription.activeVersionSelection='validity-window' requires " +
                    'planVersionFields.entitlement.validityWindows=true.',
            );
        }
        if (this.schema.tenantSubscription.withEndsAt && !entitlementFields.endsAt) {
            throw new Error(
                'tenantSubscription.withEndsAt=true requires ' +
                    'planVersionFields.entitlement.endsAt=true.',
            );
        }
    }
}

function clearedPendingVersionData(): Record<string, null | false> {
    return {
        pendingPlanVersionId: null,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
        pendingPlanVersionAcceptedByUserId: null,
        pendingPlanVersionNotifiedAt: null,
        pendingPlanVersionReminderSentAt: null,
    };
}
