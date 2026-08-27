import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
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
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { DrizzlePlanRepository } from './drizzle-plan.repository.js';
import { subscriptions } from './schema.js';

/**
 * The tenant's own writes to their subscription: changing plan, scheduling a
 * change, accepting a pending version, and cancelling.
 *
 * Every one of them is a **conditional claim** rather than an update. The
 * caller reads the row, decides, and writes — three moments during which a
 * second request can do the same. Each write therefore names the state it
 * decided against in its own `WHERE`, so a request whose premise has moved
 * writes nothing and is told so, instead of overwriting an answer that was
 * computed against different facts. The case that costs money is a
 * cancellation either side of a notice deadline: two declarations seconds
 * apart, one landing on time and one a whole billing cycle later.
 *
 * The commercial decisions themselves are not here. This adapter writes the
 * dates it is handed; `packages/nest/src/billing/cancellation.ts` decides them,
 * where the minimum term and the notice period are visible.
 */
@Injectable()
export class DrizzleTenantSubscriptionWrite implements TenantSubscriptionWritePort {
    private readonly plans: DrizzlePlanRepository;

    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {
        // Composed rather than re-queried: "which version is active at this
        // moment" is one decision — published, inside its validity window, not
        // terminated, newest window first — and the catalogue already owns it.
        // Writing the same predicate a second time here is how two readings of
        // one rule start to disagree.
        this.plans = new DrizzlePlanRepository(this.db, { validityWindows: true });
    }

    async changePlanImmediate(
        tenantId: string,
        input: ImmediatePlanChangeInput,
    ): Promise<{ plan: string; billingCycle: string; claimed: boolean }> {
        // A transaction because the plan binding and the version pinned to it
        // are one fact in two columns: a row carrying plan PRO beside a
        // STARTER version grants the wrong entitlements for as long as it
        // stands.
        return this.db.transaction(async (tx) => {
            const db = tx as unknown as DrizzleClient;
            const current = await this.requireSubscription(db, tenantId);
            const planVersionId = await this.activeVersionId(
                input.planId,
                input.periodStart ?? new Date(),
                tx as unknown as TransactionContext,
            );
            const pendingMovedAway = await this.pendingVersionBelongsToAnotherPlan(
                tx as unknown as TransactionContext,
                current.pendingPlanVersionId,
                input.planId,
            );
            const claimed = await this.claim(db, tenantId, input.expectedCanceledAt, {
                plan: input.planId,
                billingCycle: input.cycle,
                planVersionId,
                pendingPlan: null,
                pendingBillingCycle: null,
                pendingEffectiveAt: null,
                ...(input.nextStatus ? { status: input.nextStatus } : {}),
                ...periodFields(input.periodStart, input.periodEnd),
                // Null and undefined both mean "leave the trial as it is" — the
                // platform passes a carried-over end date or nothing at all.
                ...(input.trialEndsAt ? { trialEndsAt: input.trialEndsAt } : {}),
                ...(pendingMovedAway ? clearedPendingVersion() : {}),
            });
            const after = await this.requireSubscription(db, tenantId);
            return {
                plan: after.plan,
                billingCycle: after.billingCycle,
                claimed: claimed > 0,
            };
        });
    }

    async schedulePlanChange(
        tenantId: string,
        input: ScheduledPlanChangeInput,
    ): Promise<{ claimed: boolean }> {
        // The same claim as the immediate path: a change scheduled against a
        // subscription that has since been cancelled would sit in the row until
        // its date and then land inside a term that is already ending.
        const claimed = await this.claim(this.db, tenantId, input.expectedCanceledAt, {
            pendingPlan: input.pendingPlan,
            pendingBillingCycle: input.pendingBillingCycle,
            pendingEffectiveAt: input.pendingEffectiveAt,
        });
        return { claimed: claimed > 0 };
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
        const sub = await this.requireSubscription(this.db, tenantId);
        if (!sub.pendingPlanVersionId) {
            throw new Error(`No pending PlanVersion for tenant ${tenantId}.`);
        }
        const pendingPlanVersionId = sub.pendingPlanVersionId;
        const claimed = await this.db
            .update(subscriptions)
            .set({
                pendingPlanVersionAccepted: true,
                pendingPlanVersionAcceptedAt: now,
                pendingPlanVersionAcceptedByUserId: userId,
                updatedAt: now,
            })
            // Named in the WHERE so a version that moved between read and write
            // is not accepted under the previous one's name.
            .where(
                and(
                    eq(subscriptions.id, sub.id),
                    eq(subscriptions.pendingPlanVersionId, pendingPlanVersionId),
                    eq(subscriptions.pendingPlanVersionAccepted, false),
                ),
            )
            .returning({ id: subscriptions.id });
        const updated = await this.requireSubscription(this.db, tenantId);
        if (
            claimed.length === 0 &&
            (updated.pendingPlanVersionId !== pendingPlanVersionId ||
                !updated.pendingPlanVersionAccepted)
        ) {
            // Nothing claimed and the row is not in the accepted state either:
            // somebody replaced the pending version underneath this request.
            throw new Error(
                `Pending PlanVersion changed while accepting it for tenant ${tenantId}.`,
            );
        }
        return {
            accepted: true,
            acceptedAt: updated.pendingPlanVersionAcceptedAt,
            effectiveAt: updated.pendingPlanVersionEffectiveAt,
            alreadyAccepted: claimed.length === 0,
        };
    }

    async cancelSubscription(
        tenantId: string,
        input: CancelSubscriptionInput,
    ): Promise<CancelSubscriptionResult> {
        const sub = await this.requireSubscription(this.db, tenantId);
        const now = new Date();
        const claimed = await this.db
            .update(subscriptions)
            .set({
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                // Absent means unchanged rather than null: an ordinary
                // cancellation does not touch the commitment it was measured
                // against, and writing the field on every call would erase a
                // term that is still running.
                ...(input.minimumTermUntil ? { minimumTermUntil: input.minimumTermUntil } : {}),
                status: input.terminateNow ? 'CANCELED' : sub.status,
                updatedAt: now,
            })
            // Only while both cancellation columns are still empty. Two
            // declarations racing a notice deadline otherwise overwrite each
            // other's date, and the second one wins by arriving late.
            .where(
                and(
                    eq(subscriptions.tenantId, tenantId),
                    isNull(subscriptions.canceledAt),
                    isNull(subscriptions.canceledEffectiveAt),
                ),
            )
            .returning({ id: subscriptions.id });
        const current = await this.requireSubscription(this.db, tenantId);
        return {
            canceledAt: current.canceledAt ?? null,
            canceledEffectiveAt: current.canceledEffectiveAt ?? null,
            status: current.status,
            alreadyCanceled: claimed.length === 0,
        };
    }

    async applyOnboardingSelection(
        tenantId: string,
        input: ApplyOnboardingSelectionInput,
        redeemPromo: RedeemPromoInTransactionCallback | null,
    ): Promise<ApplyOnboardingSelectionResult> {
        return this.db.transaction(async (tx) => {
            const db = tx as unknown as DrizzleClient;
            const planVersionId = await this.activeVersionId(
                input.planId,
                input.periodStart ?? new Date(),
                tx as unknown as TransactionContext,
            );
            const claimed = await this.claim(db, tenantId, input.expectedCanceledAt, {
                plan: input.planId,
                billingCycle: input.cycle,
                planVersionId,
                pendingPlan: null,
                pendingBillingCycle: null,
                pendingEffectiveAt: null,
                ...clearedPendingVersion(),
                ...(input.nextStatus ? { status: input.nextStatus } : {}),
                ...periodFields(input.periodStart, input.periodEnd),
            });
            const updated = await this.requireSubscription(db, tenantId);
            if (claimed === 0) {
                return {
                    plan: updated.plan,
                    billingCycle: updated.billingCycle,
                    subscriptionId: updated.id,
                    promoRedemption: null,
                    claimed: false,
                };
            }
            // Inside the transaction and after the claim: the promo is what the
            // tenant onboarded *with*, so a promo that cannot be written must
            // take the plan binding down with it rather than leave a
            // subscription that was sold on a discount it never got.
            let promoRedemption: PromoCodeRedemptionRecord | null = null;
            if (redeemPromo) {
                promoRedemption = await redeemPromo(
                    tx as unknown as TransactionContext,
                    updated.id,
                );
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

    /**
     * One `UPDATE` naming the cancellation state the caller decided against,
     * answering with how many rows it took. Reading first and updating by
     * tenant alone would leave the window this closes.
     */
    private async claim(
        db: DrizzleClient,
        tenantId: string,
        expectedCanceledAt: Date | null,
        values: Record<string, unknown>,
    ): Promise<number> {
        const claimed = await db
            .update(subscriptions)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(subscriptions.tenantId, tenantId), canceledAtIs(expectedCanceledAt)))
            .returning({ id: subscriptions.id });
        return claimed.length;
    }

    private async requireSubscription(db: DrizzleClient, tenantId: string) {
        const rows = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.tenantId, tenantId))
            .limit(1);
        if (!rows[0]) throw new Error(`No subscription for tenant ${tenantId}.`);
        return rows[0];
    }

    private async activeVersionId(
        planKey: string,
        asOf: Date,
        tx: TransactionContext,
    ): Promise<string> {
        const active = await this.plans.findActivePlanVersion?.(planKey, asOf, tx);
        if (!active) throw new Error(`No active PlanVersion for plan '${planKey}'.`);
        return active.id;
    }

    /**
     * On the caller's transaction, not beside it. The change already holds a
     * connection for its whole length; asking for a second one waits for the
     * connection this transaction is holding, and a one-connection pool then
     * never gets past here.
     */
    private async pendingVersionBelongsToAnotherPlan(
        tx: TransactionContext,
        pendingPlanVersionId: string | null,
        targetPlanKey: string,
    ): Promise<boolean> {
        if (!pendingPlanVersionId) return false;
        const pending = await this.plans.findVersionById(pendingPlanVersionId, tx);
        return !pending || pending.planId !== targetPlanKey;
    }
}

/**
 * The billing day is derived from the window that is being opened, not passed
 * beside it: a field carrying it could only ever hold this value and would be
 * one more place for the two to disagree. Written only when a window opens — a
 * renewal reading its own previous result is exactly the drift the anchor
 * exists to stop.
 */
function periodFields(periodStart: Date | null, periodEnd: Date | null): Record<string, unknown> {
    if (!periodStart || !periodEnd) return {};
    return {
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        billingAnchorDay: periodStart.getUTCDate(),
    };
}

/** Everything a pending version change consists of, back to "none pending". */
function clearedPendingVersion(): Record<string, null | false> {
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

/** `= NULL` is never true in SQL — an expected-null claim needs `IS NULL`. */
function canceledAtIs(expected: Date | null): SQL | undefined {
    return expected === null
        ? isNull(subscriptions.canceledAt)
        : eq(subscriptions.canceledAt, expected);
}
