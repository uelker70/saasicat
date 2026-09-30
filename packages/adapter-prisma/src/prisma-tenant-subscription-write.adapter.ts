import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    ApplyOnboardingSelectionInput,
    CancelSubscriptionInput,
    CancelSubscriptionResult,
    ApplyOnboardingSelectionResult,
    ImmediatePlanChangeInput,
    PromoCodeRedemptionRecord,
    RedeemPromoInTransactionCallback,
    ScheduledPlanChangeInput,
    TenantSubscriptionWritePort,
    TransactionContext,
} from '@saasicat/core';
import {
    buildActivePlanVersionWhere,
    noActivePlanVersion,
    noPendingPlanVersion,
    subscriptionChanged,
    subscriptionGone,
} from '@saasicat/core';
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
    canceledEffectiveAt: Date | null;
    currentPeriodEnd: Date | null;
    pendingPlanVersionAccepted: boolean;
    pendingPlanVersionAcceptedAt: Date | null;
    pendingPlanVersionEffectiveAt: Date | null;
    pendingPlanVersionId: string | null;
    /** Present where plan versions are synchronized. */
    planVersionId?: string | null;
}

interface PlanVersionIdentityDbRow {
    id: string;
    planId: string;
    /** Present only where the schema can end a version. */
    endsAt?: Date | null;
    /** Present only where the schema has validity windows. */
    validFrom?: Date | null;
}

/**
 * Whether a quoted version can be booked for `planId` on `asOf`: it belongs to
 * that plan, it has begun, and it has not ended. A version whose window has
 * closed because a successor was published is still bookable — that is the
 * version a customer was quoted before the successor, which is the point.
 */
function bookableOn(version: PlanVersionIdentityDbRow, planId: string, asOf: Date): boolean {
    if (version.planId !== planId) return false;
    if (version.validFrom && version.validFrom > asOf) return false;
    return !(version.endsAt && version.endsAt <= asOf);
}

/** Structural minimum of the root client; model delegates are configurable. */
interface TransactionalPrismaClient {
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/**
 * `TenantSubscriptionWritePort` against a configurable Prisma subscription
 * delegate.
 *
 * `changePlanImmediate` resolves the target plan through the configured plan
 * binding, selects its live/active PlanVersion, and writes `plan` +
 * `planVersionId` in one transaction: the subscription is bound to the version
 * it was sold, which is what the entitlements and a frozen contract read.
 * `tenantSubscription.synchronizePlanVersion: false` opts out and writes the
 * semantic `plan` and cycle alone — for a schema whose `planVersionId` is kept
 * some other way. `bindsPlanVersion` says which, so a contract freeze can
 * refuse to start beside a write that does not bind.
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
    readonly bindsPlanVersion: boolean;
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
        this.bindsPlanVersion = this.schema.tenantSubscription.synchronizePlanVersion;
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
    ): Promise<{ plan: string; billingCycle: string; claimed: boolean }> {
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
    ): Promise<{ plan: string; billingCycle: string; claimed: boolean }> {
        const subscription = this.subscription(client);
        const data: Record<string, unknown> = {
            plan: input.planId,
            billingCycle: input.cycle,
            pendingPlan: null,
            pendingBillingCycle: null,
            pendingEffectiveAt: null,
            pendingChangeVersionId: null,
            ...(input.nextStatus ? { status: input.nextStatus } : {}),
            // Opening a window sets the day the subscription is billed on, and
            // that day IS the window's start — derived rather than passed,
            // because a field carrying it could only ever hold this value and
            // would be one more place for the two to disagree.
            //
            // Written only when a window is opened. A renewal must not touch
            // it: reading its own previous result is exactly the drift the
            // anchor exists to stop.
            ...(input.periodStart && input.periodEnd
                ? {
                      currentPeriodStart: input.periodStart,
                      currentPeriodEnd: input.periodEnd,
                      billingAnchorDay: input.periodStart.getUTCDate(),
                  }
                : {}),
            // #17: the platform changePlan path computes the carried-over
            // trial end and passes it through; null/undefined leaves the
            // existing trialEndsAt untouched.
            ...(input.trialEndsAt ? { trialEndsAt: input.trialEndsAt } : {}),
        };

        // The binding this write decided from. The claim takes the row only
        // while it still holds, so a rebinding in between — a pending version
        // taken over, another change — is not written over.
        let boundVersionId: string | null | undefined;
        if (this.schema.tenantSubscription.synchronizePlanVersion) {
            const current = await subscription.findUnique({ where: { tenantId } });
            if (!current) {
                throw subscriptionGone(tenantId);
            }
            boundVersionId = current.planVersionId ?? null;
            const unclaimed = {
                plan: current.plan,
                billingCycle: current.billingCycle,
                claimed: false,
            };
            // The binding the caller decided from, where it named one. The
            // claim below holds the row to this read, so the two agreeing here
            // holds it to the caller's.
            if (
                input.expectedPlanVersionId !== undefined &&
                boundVersionId !== input.expectedPlanVersionId
            ) {
                return unclaimed;
            }
            const storagePlanId = await this.planBinding.toStoragePlanId(client, input.planId);
            const keepsVersion =
                input.keepsBoundVersion && current.plan === input.planId && boundVersionId !== null;
            const asOf = input.periodStart ?? new Date();
            const quoted = keepsVersion
                ? null
                : await this.stillBookable(client, input.quotedPlanVersionId, storagePlanId, asOf);
            if (!keepsVersion && input.quotedVersionOnly && quoted === null) {
                return unclaimed;
            }
            // A change that names a version of the plan it keeps, which no
            // longer takes bookings when it lands, keeps the version bound: the
            // one in effect by then is one nobody was offered or agreed to.
            const namedVersionGone =
                quoted === null &&
                input.quotedPlanVersionId !== null &&
                current.plan === input.planId &&
                boundVersionId !== null;
            data.planVersionId =
                keepsVersion || namedVersionGone
                    ? boundVersionId
                    : (quoted ??
                      (await this.findTargetPlanVersionId(
                          client,
                          input.planId,
                          storagePlanId,
                          asOf,
                      )));
            // A pending version of another plan has nothing left to be
            // accepted for, and one the write binds is accepted by being bound:
            // the subscriber is not asked for a version they are already on.
            if (
                data.planVersionId === current.pendingPlanVersionId ||
                (await this.pendingVersionBelongsToAnotherPlan(
                    client,
                    current.pendingPlanVersionId,
                    storagePlanId,
                ))
            ) {
                Object.assign(data, clearedPendingVersionData());
            }
        } else if (input.quotedVersionOnly) {
            throw new Error(
                `A change for tenant ${tenantId} asked for plan version ` +
                    `${input.quotedPlanVersionId ?? '(none)'} to be bound, and this write binds no ` +
                    'version: `tenantSubscription.synchronizePlanVersion` is false.',
            );
        }

        // Claimed, not updated: the caller decided against a cancellation state,
        // and this takes the row only while that state still holds. One
        // statement, so a cancellation arriving in between loses the race
        // instead of being written over.
        const claim = await this.claimRow(
            client,
            tenantId,
            input.expectedCanceledAt,
            data,
            boundVersionId,
        );
        const current = await subscription.findUnique({ where: { tenantId } });
        if (!current) {
            throw subscriptionGone(tenantId);
        }
        return {
            plan: current.plan,
            billingCycle: current.billingCycle,
            claimed: claim.count > 0,
        };
    }

    async schedulePlanChange(
        tenantId: string,
        input: ScheduledPlanChangeInput,
    ): Promise<{ claimed: boolean }> {
        // Same claim as the immediate path: a change scheduled against a
        // subscription that has since been cancelled would sit in the row until
        // its date, and land inside — or past — a term that is already ending.
        // And, where the caller named them, the binding and the change already
        // scheduled it decided from. A write that binds no version has no
        // binding to hold the row to.
        const binds = this.schema.tenantSubscription.synchronizePlanVersion;
        const claim = await this.subscription(this.prisma).updateMany({
            where: {
                tenantId,
                canceledAt: input.expectedCanceledAt,
                ...(binds && input.expectedPlanVersionId !== undefined
                    ? { planVersionId: input.expectedPlanVersionId }
                    : {}),
                ...(input.expectedPendingPlan !== undefined
                    ? { pendingPlan: input.expectedPendingPlan }
                    : {}),
            },
            data: {
                pendingPlan: input.pendingPlan,
                pendingBillingCycle: input.pendingBillingCycle,
                pendingEffectiveAt: input.pendingEffectiveAt,
                pendingChangeVersionId: input.pendingChangeVersionId,
            },
        });
        return { claimed: claim.count > 0 };
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
            throw subscriptionGone(tenantId);
        }
        if (!sub.pendingPlanVersionId) {
            throw noPendingPlanVersion(tenantId);
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
            throw subscriptionGone(tenantId);
        }
        // Nothing claimed and the row is not in the accepted state either: the
        // pending version was cleared underneath this request — which the
        // check answers as nothing pending — or replaced by another one.
        if (claimed.count === 0 && updated.pendingPlanVersionId === null) {
            throw noPendingPlanVersion(tenantId);
        }
        if (
            claimed.count === 0 &&
            (updated.pendingPlanVersionId !== pendingPlanVersionId ||
                !updated.pendingPlanVersionAccepted)
        ) {
            throw subscriptionChanged(tenantId);
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
                pendingChangeVersionId: null,
                ...clearedPendingVersionData(),
                ...(input.nextStatus ? { status: input.nextStatus } : {}),
                // Same derivation as the immediate path: the billing day is
                // the day the window opens.
                ...(input.periodStart && input.periodEnd
                    ? {
                          currentPeriodStart: input.periodStart,
                          currentPeriodEnd: input.periodEnd,
                          billingAnchorDay: input.periodStart.getUTCDate(),
                      }
                    : {}),
            };
            if (this.schema.tenantSubscription.synchronizePlanVersion) {
                const storagePlanId = await this.planBinding.toStoragePlanId(tx, input.planId);
                data.planVersionId = await this.findTargetPlanVersionId(
                    tx,
                    input.planId,
                    storagePlanId,
                    input.periodStart ?? new Date(),
                );
            }

            // The same conditional claim as the sequential path. Inside the
            // transaction, so a cancellation arriving mid-onboarding either
            // loses to it or takes the row before it and turns this into a
            // no-op the caller is told about.
            const claim = await this.claimRow(tx, tenantId, input.expectedCanceledAt, data);
            const updated = await this.subscription(tx).findUnique({ where: { tenantId } });
            if (!updated) {
                throw subscriptionGone(tenantId);
            }
            if (claim.count === 0) {
                return {
                    plan: updated.plan,
                    billingCycle: updated.billingCycle,
                    subscriptionId: updated.id,
                    promoRedemption: null,
                    claimed: false,
                };
            }
            let promoRedemption: PromoCodeRedemptionRecord | null = null;
            if (redeemPromo) {
                promoRedemption = await redeemPromo(tx as TransactionContext, updated.id);
            }
            return {
                plan: updated.plan,
                billingCycle: updated.billingCycle,
                subscriptionId: updated.id,
                promoRedemption,
                claimed: true,
            };
        });
    }

    async cancelSubscription(
        tenantId: string,
        input: CancelSubscriptionInput,
    ): Promise<CancelSubscriptionResult> {
        const subscription = this.subscription(this.prisma);
        const sub = await subscription.findUnique({ where: { tenantId } });
        if (!sub) {
            throw subscriptionGone(tenantId);
        }
        // A conditional claim, not an update: `updateMany` with the emptiness of
        // both cancellation columns in its `where` is one statement, so two
        // concurrent declarations cannot both win it. The loser reads back what
        // the winner wrote instead of overwriting it — which matters most
        // exactly where it is hardest to notice, either side of a notice
        // deadline that moves the date by a whole billing cycle.
        //
        // Writes what it is handed. The dates are a commercial decision — the
        // minimum term, the notice period, whether the window had closed — and
        // none of that is visible from here.
        const claimed = await subscription.updateMany({
            where: { tenantId, canceledAt: null, canceledEffectiveAt: null },
            data: {
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                // Absent means unchanged rather than null: an ordinary
                // cancellation does not touch the commitment it was measured
                // against, and writing the field on every call would erase a
                // term that is still running.
                ...(input.minimumTermUntil ? { minimumTermUntil: input.minimumTermUntil } : {}),
                // Written only when the cancellation is already effective.
                // Restating the status this call read would undo whatever
                // changed it in between — a trial going live between the read
                // and the write came back as `TRIAL`, entitlements and all.
                ...(input.terminateNow ? { status: 'CANCELED' } : {}),
            },
        });
        const current = await subscription.findUnique({ where: { tenantId } });
        if (!current) {
            throw subscriptionGone(tenantId);
        }
        return {
            canceledAt: current.canceledAt ?? null,
            canceledEffectiveAt: current.canceledEffectiveAt ?? null,
            status: current.status,
            alreadyCanceled: claimed.count === 0,
        };
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

    /**
     * The conditional claim on the tenant's row, shared by both plan-changing
     * writes. Where it carries a plan version, a failure says so: a
     * subscription model without a `planVersionId` column makes Prisma answer
     * with an unknown argument that names neither the binding nor the way out.
     * The original error stays the cause, and a claim without a version fails
     * as it always did.
     */
    private async claimRow(
        client: unknown,
        tenantId: string,
        expectedCanceledAt: Date | null | undefined,
        data: Record<string, unknown>,
        boundVersionId?: string | null,
    ): Promise<{ count: number }> {
        try {
            return await this.subscription(client).updateMany({
                where: {
                    tenantId,
                    canceledAt: expectedCanceledAt,
                    ...(boundVersionId === undefined ? {} : { planVersionId: boundVersionId }),
                },
                data,
            });
        } catch (error) {
            if (!('planVersionId' in data)) throw error;
            throw new Error(
                `The plan change for tenant ${tenantId} could not be written with its plan version ` +
                    'bound. A plan change binds the version by default; if the subscription model ' +
                    'has no `planVersionId` column, set `tenantSubscription.synchronizePlanVersion: false`.',
                { cause: error },
            );
        }
    }

    private async findTargetPlanVersionId(
        client: unknown,
        planKey: string,
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
        if (!target) throw noActivePlanVersion(planKey, asOf);
        return target.id;
    }

    /**
     * The version a change was quoted at, while it can still be booked for its
     * plan on the day the change takes effect (`bookableOn`); null otherwise,
     * and the version in effect is bound. A version ended by then takes no new
     * bookings (`SC-PLAN-016`). The row is read whole, so a schema without
     * `endsAt` or `validFrom` hands none back, and there nothing ends or
     * begins later.
     */
    private async stillBookable(
        client: unknown,
        quotedVersionId: string | null,
        storagePlanId: string,
        asOf: Date,
    ): Promise<string | null> {
        if (!quotedVersionId) return null;
        const quoted = await this.planVersions(client).findUnique({
            where: { id: quotedVersionId },
        });
        return quoted && bookableOn(quoted, storagePlanId, asOf) ? quotedVersionId : null;
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
        // Binding reads the plan-version model on every plan change. Resolved
        // here, a schema without one stops the start and names it, rather than
        // failing the first upgrade with an error thrown from inside the write.
        try {
            this.planVersions(this.prisma);
        } catch (error) {
            throw new Error(
                `${error instanceof Error ? error.message : String(error)} A plan change binds ` +
                    'the plan version by default; a schema without a plan-version model sets ' +
                    '`tenantSubscription.synchronizePlanVersion: false`.',
                { cause: error },
            );
        }
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
