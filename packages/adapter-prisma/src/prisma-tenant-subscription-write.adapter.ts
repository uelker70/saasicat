import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    ApplyOnboardingSelectionInput,
    CancelSubscriptionInput,
    CancelSubscriptionResult,
    ApplyOnboardingSelectionResult,
    EndNowInput,
    EndSubscriptionNowResult,
    ImmediatePlanChangeInput,
    PromoCodeRedemptionRecord,
    RedeemPromoInTransactionCallback,
    ScheduledPlanChangeInput,
    TenantSubscriptionWritePort,
    TransactionContext,
} from '@saasicat/core';
import {
    NO_SCHEDULED_CHANGE,
    type ScheduledChangeColumns,
    buildActivePlanVersionWhere,
    noActivePlanVersion,
    scheduledChangeAfterWrite,
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
    pendingPlan: string | null;
    pendingBillingCycle: string | null;
    pendingEffectiveAt: Date | null;
    pendingChangeVersionId: string | null;
    /** Present where plan versions are synchronized. */
    planVersionId?: string | null;
}

interface PlanVersionIdentityDbRow {
    id: string;
    planId: string;
    endsAt: Date | null;
    validFrom: Date | null;
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
 * binding, selects its PlanVersion on sale, and writes `plan` +
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
 * callback. In synchronized mode it also binds the concrete PlanVersion.
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
        // while it still holds, so a rebinding in between — a newer version
        // taken, another change — is not written over.
        let boundVersionId: string | null | undefined;
        // The scheduled change as read, where the write keeps it: the claim
        // then holds the row to it, so one rescheduled in between is not
        // written over with what was read before.
        let scheduledAsRead: ScheduledChangeColumns | undefined;
        if (this.schema.tenantSubscription.synchronizePlanVersion) {
            const current = await subscription.findUnique({ where: { tenantId } });
            if (!current) {
                throw subscriptionGone(tenantId);
            }
            boundVersionId = current.planVersionId ?? null;
            Object.assign(data, scheduledChangeAfterWrite(current, input));
            if (input.keepsPendingChange) scheduledAsRead = scheduledChangeOf(current);
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
                : await this.quotedToBind(client, input, storagePlanId, asOf);
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
        } else if (input.quotedVersionOnly) {
            throw new Error(
                `A change for tenant ${tenantId} asked for plan version ` +
                    `${input.quotedPlanVersionId ?? '(none)'} to be bound, and this write binds no ` +
                    'version: `tenantSubscription.synchronizePlanVersion` is false.',
            );
        } else if (input.keepsPendingChange) {
            // Only a retirement's move keeps the change, and a move binds a
            // version, which this write does not.
            throw new Error(
                `A change for tenant ${tenantId} asked to keep the change it has scheduled, and ` +
                    'this write reads no row to keep it from: ' +
                    '`tenantSubscription.synchronizePlanVersion` is false.',
            );
        } else {
            Object.assign(data, NO_SCHEDULED_CHANGE);
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
            scheduledAsRead,
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

    /**
     * The same conditional claim as `cancelSubscription`, on the effective date
     * the caller read rather than on its absence: a cancellation moved, ended
     * or written between the read and the write leaves the count at zero, and
     * the caller reads back what is stored instead of overwriting it.
     */
    async endNow(tenantId: string, input: EndNowInput): Promise<EndSubscriptionNowResult> {
        const subscription = this.subscription(this.prisma);
        const claimed = await subscription.updateMany({
            where: { tenantId, canceledEffectiveAt: input.expectedCanceledEffectiveAt },
            data: {
                canceledAt: input.at,
                canceledEffectiveAt: input.at,
                status: 'CANCELED',
            },
        });
        const current = await subscription.findUnique({ where: { tenantId } });
        if (!current) {
            throw subscriptionGone(tenantId);
        }
        return {
            ended: claimed.count === 1,
            canceledAt: current.canceledAt ?? null,
            canceledEffectiveAt: current.canceledEffectiveAt ?? null,
            status: current.status,
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
        scheduledAsRead?: ScheduledChangeColumns,
    ): Promise<{ count: number }> {
        try {
            return await this.subscription(client).updateMany({
                where: {
                    tenantId,
                    canceledAt: expectedCanceledAt,
                    ...(boundVersionId === undefined ? {} : { planVersionId: boundVersionId }),
                    ...(scheduledAsRead ?? {}),
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
        // The version on sale at `asOf`, by the rule every price and catalogue
        // reads (`PlanRepository.findActivePlanVersion`).
        const target = await this.planVersions(client).findFirst({
            where: {
                planId: storagePlanId,
                ...buildActivePlanVersionWhere(asOf, { withEndsAt: true }),
            },
            orderBy: [{ validFrom: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }],
        });
        if (!target) throw noActivePlanVersion(planKey, asOf);
        return target.id;
    }

    /**
     * The version a change was quoted at, while it can still be booked for its
     * plan on the day the change takes effect (`bookableOn`) — or, where the
     * write puts a binding back (`restoresQuotedVersion`), while it is one of
     * that plan's. Null otherwise, and the version in effect is bound. A version
     * ended by then takes no new bookings (`SC-PLAN-016`), and putting a
     * subscription back on it is none.
     */
    private async quotedToBind(
        client: unknown,
        input: ImmediatePlanChangeInput,
        storagePlanId: string,
        asOf: Date,
    ): Promise<string | null> {
        if (!input.quotedPlanVersionId) return null;
        const quoted = await this.planVersions(client).findUnique({
            where: { id: input.quotedPlanVersionId },
        });
        if (!quoted) return null;
        const binds = input.restoresQuotedVersion
            ? quoted.planId === storagePlanId
            : bookableOn(quoted, storagePlanId, asOf);
        return binds ? input.quotedPlanVersionId : null;
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
    }
}

/** The scheduled change a row holds, as the claim compares it. */
function scheduledChangeOf(row: ScheduledChangeColumns): ScheduledChangeColumns {
    return {
        pendingPlan: row.pendingPlan,
        pendingBillingCycle: row.pendingBillingCycle,
        pendingEffectiveAt: row.pendingEffectiveAt,
        pendingChangeVersionId: row.pendingChangeVersionId,
    };
}
