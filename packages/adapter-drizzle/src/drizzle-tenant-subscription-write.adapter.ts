import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, type Column, type SQL } from 'drizzle-orm';
import type {
    ApplyOnboardingSelectionInput,
    CancelSubscriptionInput,
    CancelSubscriptionResult,
    ApplyOnboardingSelectionResult,
    EndNowInput,
    EndTrialInput,
    EndSubscriptionNowResult,
    ImmediatePlanChangeInput,
    PromoCodeRedemptionRecord,
    RedeemPromoInTransactionCallback,
    ScheduledPlanChangeInput,
    StartAgainInput,
    StartAgainResult,
    SubscriptionPutBack,
    TenantSubscriptionWritePort,
    TransactionContext,
} from '@saasicat/core';
import {
    NO_SCHEDULED_CHANGE,
    columnsClaimedByPutBack,
    columnsOfPeriodOpened,
    columnsPutBack,
    noActivePlanVersion,
    pendingAgreementColumns,
    scheduledChangeAfterWrite,
    subscriptionGone,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient, resolveDb } from './client.js';
import { DrizzlePlanRepository } from './drizzle-plan.repository.js';
import { subscriptions } from './schema.js';

/**
 * The tenant's own writes to their subscription: changing plan, scheduling a
 * change, and cancelling.
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
    /** Both plan-changing writes bind the version they sell; there is no opt-out here. */
    readonly bindsPlanVersion = true;
    private readonly plans: DrizzlePlanRepository;

    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {
        // Composed rather than re-queried: "which version is active at this
        // moment" is one decision — published, inside its validity window, not
        // terminated, newest window first — and the catalogue already owns it.
        // Writing the same predicate a second time here is how two readings of
        // one rule start to disagree.
        this.plans = new DrizzlePlanRepository(this.db);
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
            // Locked, not merely read: everything below decides from this row —
            // which version stays bound, above all — and a decision made on a
            // row that then changes is applied to a state nobody looked at. The
            // lock makes read and write one moment.
            const current = await this.requireSubscription(db, tenantId, { lock: true });
            const unclaimed = {
                plan: current.plan,
                billingCycle: current.billingCycle,
                claimed: false,
            };
            // The binding the caller decided from, where it named one — read
            // under the lock, so it holds until the write.
            if (
                input.expectedPlanVersionId !== undefined &&
                current.planVersionId !== input.expectedPlanVersionId
            ) {
                return unclaimed;
            }
            const keepsVersion = input.keepsBoundVersion && current.plan === input.planId;
            const quoted = keepsVersion
                ? null
                : await this.quotedToBind(
                      input,
                      input.periodStart ?? new Date(),
                      tx as unknown as TransactionContext,
                  );
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
                current.planVersionId !== null;
            const planVersionId =
                keepsVersion || namedVersionGone
                    ? current.planVersionId
                    : (quoted ??
                      (await this.activeVersionId(
                          input.planId,
                          input.periodStart ?? new Date(),
                          tx as unknown as TransactionContext,
                      )));
            const written: Partial<typeof subscriptions.$inferInsert> = {
                plan: input.planId,
                billingCycle: input.cycle,
                planVersionId,
                // The row is locked, so a change kept is the one read.
                ...scheduledChangeAfterWrite(current, input),
                ...columnsOfPeriodOpened(input.periodStart, input.periodEnd),
            };
            if (input.nextStatus) written.status = input.nextStatus;
            // Null and undefined both mean "leave the trial as it is" — the
            // platform passes a carried-over end date or nothing at all.
            if (input.trialEndsAt) written.trialEndsAt = input.trialEndsAt;
            // A change taken back writes the row as it was read, over
            // everything above derived from the change — and only while the
            // row is still as the change left it.
            if (input.putsBack) Object.assign(written, columnsPutBack(input.putsBack));
            const claimed = await this.claim(
                db,
                tenantId,
                input.expectedCanceledAt,
                written,
                input.putsBack ? asChangedIs(input.putsBack) : [],
            );
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
        // And, where the caller named them, the binding and the change already
        // scheduled it decided from.
        const claimed = await this.claim(
            this.db,
            tenantId,
            input.expectedCanceledAt,
            {
                pendingPlan: input.pendingPlan,
                pendingBillingCycle: input.pendingBillingCycle,
                pendingEffectiveAt: input.pendingEffectiveAt,
                pendingChangeVersionId: input.pendingChangeVersionId,
                ...pendingAgreementColumns(input.pendingAgreement),
            },
            [
                ...(input.expectedPlanVersionId !== undefined
                    ? [columnIs(subscriptions.planVersionId, input.expectedPlanVersionId)]
                    : []),
                ...(input.expectedPendingPlan !== undefined
                    ? [columnIs(subscriptions.pendingPlan, input.expectedPendingPlan)]
                    : []),
            ],
        );
        return { claimed: claimed > 0 };
    }

    async cancelSubscription(
        tenantId: string,
        input: CancelSubscriptionInput,
    ): Promise<CancelSubscriptionResult> {
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
                // Written only when the cancellation is already effective.
                // Restating the status this call read would undo whatever
                // changed it in between — a trial going live between the read
                // and the write came back as `TRIAL`, entitlements and all.
                // An ordinary cancellation records dates; it has no opinion
                // about the status.
                ...(input.terminateNow ? { status: 'CANCELED' } : {}),
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

    /**
     * The same conditional claim as `cancelSubscription`, on the effective date
     * the caller read rather than on its absence: a cancellation moved, ended
     * or written between the read and the write claims nothing, and the caller
     * reads back what is stored instead of overwriting it.
     */
    async endNow(tenantId: string, input: EndNowInput): Promise<EndSubscriptionNowResult> {
        const claimed = await this.db
            .update(subscriptions)
            .set({
                canceledAt: input.at,
                canceledEffectiveAt: input.at,
                status: 'CANCELED',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(subscriptions.tenantId, tenantId),
                    eq(subscriptions.canceledEffectiveAt, input.expectedCanceledEffectiveAt),
                ),
            )
            .returning({ id: subscriptions.id });
        const current = await this.requireSubscription(this.db, tenantId);
        return {
            ended: claimed.length === 1,
            canceledAt: current.canceledAt ?? null,
            canceledEffectiveAt: current.canceledEffectiveAt ?? null,
            status: current.status,
        };
    }

    /**
     * The same conditional claim as `endNow`, on the landed cancellation the
     * caller read: one that moved, or a subscription never cancelled, claims
     * nothing. Not on the status, which a cancellation that landed by its date
     * left as it stood. In the caller's transaction where one is given, so the
     * return's contract and the lifted end share it. The version bound is the
     * one the new contract was composed for, never the one in effect instead.
     */
    async startAgain(
        tenantId: string,
        input: StartAgainInput,
        tx?: TransactionContext,
    ): Promise<StartAgainResult> {
        if (input.planVersionId === null) {
            throw new Error(
                `A return for tenant ${tenantId} names no plan version, and this write binds one: ` +
                    'the version the new contract was composed for.',
            );
        }
        const version = await this.plans.findVersionById(input.planVersionId, tx);
        if (version?.planId !== input.planId) {
            throw new Error(
                `A return for tenant ${tenantId} names plan version ${input.planVersionId}, ` +
                    `which is not one of ${input.planId}.`,
            );
        }
        const claimed = await resolveDb(this.db, tx)
            .update(subscriptions)
            .set({
                plan: input.planId,
                billingCycle: input.cycle,
                status: 'ACTIVE',
                planVersionId: input.planVersionId,
                ...columnsOfPeriodOpened(input.periodStart, input.periodEnd),
                canceledAt: null,
                canceledEffectiveAt: null,
                ...NO_SCHEDULED_CHANGE,
                isPilot: false,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(subscriptions.tenantId, tenantId),
                    eq(subscriptions.canceledEffectiveAt, input.expectedCanceledEffectiveAt),
                ),
            )
            .returning({ id: subscriptions.id });
        return { claimed: claimed.length === 1 };
    }

    /**
     * The same conditional claim, on the trial the caller read: still a trial,
     * still ending at `input.trialEndsAt`, and not cancelled.
     */
    async endTrial(tenantId: string, input: EndTrialInput): Promise<EndSubscriptionNowResult> {
        const claimed = await this.db
            .update(subscriptions)
            .set({
                canceledAt: input.at,
                canceledEffectiveAt: input.trialEndsAt,
                status: 'CANCELED',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(subscriptions.tenantId, tenantId),
                    eq(subscriptions.status, 'TRIAL'),
                    eq(subscriptions.trialEndsAt, input.trialEndsAt),
                    isNull(subscriptions.canceledAt),
                    isNull(subscriptions.canceledEffectiveAt),
                ),
            )
            .returning({ id: subscriptions.id });
        const current = await this.requireSubscription(this.db, tenantId);
        return {
            ended: claimed.length === 1,
            canceledAt: current.canceledAt ?? null,
            canceledEffectiveAt: current.canceledEffectiveAt ?? null,
            status: current.status,
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
                ...NO_SCHEDULED_CHANGE,
                ...(input.nextStatus ? { status: input.nextStatus } : {}),
                ...columnsOfPeriodOpened(input.periodStart, input.periodEnd),
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
        alsoExpected: readonly SQL[] = [],
    ): Promise<number> {
        const claimed = await db
            .update(subscriptions)
            .set({ ...values, updatedAt: new Date() })
            .where(
                and(
                    eq(subscriptions.tenantId, tenantId),
                    canceledAtIs(expectedCanceledAt),
                    ...alsoExpected,
                ),
            )
            .returning({ id: subscriptions.id });
        return claimed.length;
    }

    /**
     * `lock: true` takes the row for the rest of the transaction, so a caller
     * deciding from what it read cannot have the ground move underneath it. It
     * is only meaningful inside a transaction — outside one the lock is
     * released with the statement.
     */
    private async requireSubscription(
        db: DrizzleClient,
        tenantId: string,
        options: { lock?: boolean } = {},
    ) {
        const query = db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
        const rows = await (options.lock ? query.for('update') : query).limit(1);
        if (!rows[0]) throw subscriptionGone(tenantId);
        return rows[0];
    }

    private async activeVersionId(
        planKey: string,
        asOf: Date,
        tx: TransactionContext,
    ): Promise<string> {
        const active = await this.plans.findActivePlanVersion(planKey, asOf, tx);
        if (!active) throw noActivePlanVersion(planKey, asOf);
        return active.id;
    }

    /**
     * The version a change was quoted at, while it can still be booked for its
     * plan on the day the change takes effect: it belongs to that plan, it has
     * begun, and it has not ended (`SC-PLAN-016`). Null otherwise, and the
     * version in effect is bound. A window closed by a successor's publication
     * does not count against it — that is the version quoted before the
     * successor. Where the write puts a binding back (`restoresQuotedVersion`),
     * belonging to the plan is enough: putting a subscription back on a version
     * ended is no booking. On the caller's transaction, for the reason given
     * below.
     */
    private async quotedToBind(
        input: ImmediatePlanChangeInput,
        asOf: Date,
        tx: TransactionContext,
    ): Promise<string | null> {
        const quotedVersionId = input.quotedPlanVersionId;
        if (!quotedVersionId) return null;
        const quoted = await this.plans.findVersionById(quotedVersionId, tx);
        if (!quoted || quoted.planId !== input.planId) return null;
        if (input.restoresQuotedVersion) return quotedVersionId;
        if (quoted.validFrom && new Date(quoted.validFrom) > asOf) return null;
        return quoted.endsAt && new Date(quoted.endsAt) <= asOf ? null : quotedVersionId;
    }
}

/**
 * The row as the plan change being put back left it, column by column
 * (`SubscriptionPutBack.asChanged`): a put-back over a row another request has
 * changed since claims nothing.
 */
function asChangedIs(putBack: SubscriptionPutBack): SQL[] {
    const claimed = columnsClaimedByPutBack(putBack);
    return [
        eq(subscriptions.plan, claimed.plan),
        eq(subscriptions.billingCycle, claimed.billingCycle),
        eq(subscriptions.status, claimed.status),
        columnIs(subscriptions.currentPeriodStart, claimed.currentPeriodStart),
        columnIs(subscriptions.currentPeriodEnd, claimed.currentPeriodEnd),
        ...(claimed.billingAnchorDay === undefined
            ? []
            : [columnIs(subscriptions.billingAnchorDay, claimed.billingAnchorDay)]),
        columnIs(subscriptions.pendingPlan, claimed.pendingPlan),
        columnIs(subscriptions.pendingBillingCycle, claimed.pendingBillingCycle),
        columnIs(subscriptions.pendingEffectiveAt, claimed.pendingEffectiveAt),
        columnIs(subscriptions.pendingChangeVersionId, claimed.pendingChangeVersionId),
        columnIs(subscriptions.pendingTermsVersion, claimed.pendingTermsVersion),
        columnIs(
            subscriptions.pendingCancellationNoticeDays,
            claimed.pendingCancellationNoticeDays,
        ),
        columnIs(subscriptions.pendingAgreedAt, claimed.pendingAgreedAt),
    ];
}

/** `= NULL` is never true in SQL — an expected-null claim needs `IS NULL`. */
function canceledAtIs(expected: Date | null): SQL {
    return columnIs(subscriptions.canceledAt, expected);
}

/** A column as the caller read it: `null` claims a row where it is empty. */
function columnIs(column: Column, expected: string | number | Date | null): SQL {
    return expected === null ? isNull(column) : eq(column, expected);
}
