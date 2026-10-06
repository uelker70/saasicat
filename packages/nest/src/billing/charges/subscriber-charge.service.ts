import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    EndedAtOnceNotice,
    FeatureWithdrawalRepository,
    NewSubscriberCharge,
    SubscriberChargeRecord,
    SubscriberLedgerRepository,
    SubscriberRepository,
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    SubscriptionContractRecord,
    SubscriptionContractRepository,
    SubscriptionNoticeRecord,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
} from '@saasicat/core';
import { toCents } from '@saasicat/core';

import { SUBSCRIBER_REPOSITORY_TOKEN } from '../../subscriber/subscriber.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
import { cancellationHasLanded } from '../../entitlement/landed-cancellation.js';
import { resolvePlanAnchorDay } from '../bundle-period.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from '../contract-freeze.tokens.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from '../subscription-bundles.tokens.js';
import { retiredBundleVersionsOf, retiredVersionsOf } from '../retirement-notices.js';
import {
    FEATURE_WITHDRAWAL_REPOSITORY_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
} from '../tenant-billing.tokens.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../../entitlement/entitlement.tokens.js';
import { FeatureWithdrawalContractService } from '../feature-withdrawal-contract.service.js';
import {
    bookingsTheContractMisses,
    deriveDueCharges,
    type ChargeDerivationInput,
} from './charge-derivation.js';
import { SUBSCRIBER_LEDGER_REPOSITORY_TOKEN } from './subscriber-charge.tokens.js';

/**
 * The usage port types it as a string, but the column behind it is the
 * `BillingCycle` enum in the canonical schema, so the database holds it to the
 * two values.
 */
function planCycleOf(subscription: SubscriptionUsageRecord): BillingCycle {
    return subscription.billingCycle as BillingCycle;
}

/** When the subscription ends, or null while it runs on. */
function endOf(subscription: SubscriptionUsageRecord): Date | null {
    return subscription.canceledEffectiveAt ?? subscription.canceledAt ?? null;
}

/**
 * Keeps a subscriber's account up to date: the charges its contracts give rise
 * to, one per contract line and period.
 *
 * The platform calls it where it writes a change itself — onboarding, an
 * immediate plan change and an add-on booking. An application calls it where
 * it writes one: when it activates a subscription, and from the job that renews
 * periods. However often it runs, each charge is written once.
 */
@Injectable()
export class SubscriberChargeService {
    private readonly logger = new Logger(SubscriberChargeService.name);

    constructor(
        @Inject(SUBSCRIBER_LEDGER_REPOSITORY_TOKEN)
        private readonly ledger: SubscriberLedgerRepository,
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: SubscriptionContractRepository,
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly subscribers: SubscriberRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        // Optional — an installation without add-ons has no bookings to charge.
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository | null = null,
        // Always there where the module wires the journal, which requires
        // `contractFreeze`; optional so that the service can be built without.
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly freeze: ContractFreezePort | null = null,
        // Optional — without notices no retirement was ever announced, and
        // nothing moves a subscription off its version.
        @Optional()
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository | null = null,
        // Optional — without it no feature is withdrawn, and nothing reduced.
        @Optional()
        @Inject(FEATURE_WITHDRAWAL_REPOSITORY_TOKEN)
        private readonly featureWithdrawals: FeatureWithdrawalRepository | null = null,
        // Whether a line grants a withdrawn feature through a `replaces` chain.
        @Optional()
        @Inject(ENTITLEMENT_SERVICE_TOKEN)
        private readonly entitlements: {
            withReplacements(features: ReadonlySet<string>): Set<string>;
        } | null = null,
        // Present where features are withdrawn and contracts frozen: writes a
        // reduction the announcement could not into the contract before it is
        // charged, since a charge points at a contract line.
        @Optional()
        @Inject(FeatureWithdrawalContractService)
        private readonly withdrawalReductions: FeatureWithdrawalContractService | null = null,
    ) {}

    /**
     * Writes every charge the tenant's records give rise to by `now` that is
     * not written yet, and returns those.
     *
     * Nothing is charged without a contract (a charge points at a contract
     * line), in a trial, before the plan's current window when the account is
     * still empty, for a period that starts after `now`, or for one that
     * starts on or after the date a cancellation takes effect. A period that
     * starts on or after the date a retirement moves the subscription waits
     * for the contract the move writes, and is charged at the replacement's
     * price once it exists (`SC-PRIC-062`); so does a booking's period from
     * the date an add-on retirement moves that booking (`SC-BUN-050`).
     *
     * A window that moved on before anything charged it is not charged
     * afterwards, so a job that renews periods calls this before it moves a
     * window, and moves it only when the call succeeded.
     */
    async recordDueCharges(tenantId: string, now = new Date()): Promise<SubscriberChargeRecord[]> {
        const input = await this.inputOf(tenantId, now, { writesContracts: true });
        if (!input) return [];
        return this.ledger.recordCharges(deriveDueCharges(input));
    }

    /**
     * What ending the subscription — or, with a booking's id, that booking —
     * at once at `at` would credit, worked out by the derivation that writes it
     * and written nowhere: the unused rest of what was charged, net of the
     * reductions taken back with it, as a positive amount.
     */
    async creditOfEndingAtOnce(
        tenantId: string,
        subscriptionBundleId: string | null,
        at: Date,
    ): Promise<{ creditNet: number; currency: string | null }> {
        const input = await this.inputOf(tenantId, at, {
            writesContracts: false,
            endsAtOnce: { subscriptionBundleId, at },
        });
        return creditAt(input ? deriveDueCharges(input) : [], at);
    }

    /**
     * Everything the derivation reads, or null where nothing can be charged.
     * Contracts a booking or a reduction lacks are written first where
     * `writesContracts` says so; a preview writes nothing. `endsAtOnce` reads
     * the account as it would stand had the subscription or the booking ended
     * at once at that moment.
     */
    private async inputOf(
        tenantId: string,
        now: Date,
        options: {
            writesContracts: boolean;
            endsAtOnce?: { subscriptionBundleId: string | null; at: Date };
        },
    ): Promise<ChargeDerivationInput | null> {
        const subscription = await this.subscriptions.findForTenant(tenantId);
        if (!subscription?.id) return null;
        const subscriber = await this.subscribers.findByTenantId(tenantId);
        if (!subscriber) return null;
        const [bookings, written, told] = await Promise.all([
            this.bookings?.listBySubscription(subscription.id) ?? [],
            this.ledger.listBySubscription(subscription.id),
            this.notices?.listForSubscription(subscription.id) ?? [],
        ]);
        let contracts: SubscriptionContractRecord[];
        if (options.writesContracts) {
            await this.recordWithdrawalReductions(tenantId, told, now);
            contracts = await this.contractsNamingEveryBooking(
                tenantId,
                subscription,
                bookings,
                now,
            );
        } else {
            contracts = await this.contracts.list({ tenantId });
        }
        const end = options.endsAtOnce;
        const endedHere = (bookingId: string | null) =>
            end !== undefined && end.subscriptionBundleId === bookingId;
        const withdrawalInputs = await this.withdrawalInputsOf(told);
        return {
            now,
            subscriberId: subscriber.id,
            subscription: {
                id: subscription.id,
                tenantId,
                status: subscription.status,
                billingCycle: planCycleOf(subscription),
                currentPeriodStart: subscription.currentPeriodStart,
                currentPeriodEnd: subscription.currentPeriodEnd,
                anchorDay: resolvePlanAnchorDay(subscription),
                startedAt: subscription.startedAt,
                endsAt: endedHere(null) ? end!.at : endOf(subscription),
            },
            contracts,
            bookings: bookings.map((booking) =>
                endedHere(booking.id)
                    ? { ...booking, canceledAt: end!.at, canceledEffectiveAt: end!.at }
                    : booking,
            ),
            written,
            retired: retiredVersionsOf(told),
            retiredAddOns: retiredBundleVersionsOf(told),
            ...withdrawalInputs,
            ...(end ? { endedAtOnce: [...(withdrawalInputs.endedAtOnce ?? []), end] } : {}),
        };
    }

    /**
     * Writes the reductions of the withdrawals the subscription was told of
     * that no contract records yet. Logged, not thrown, like the contract for a
     * missed booking: the rest is charged, and the next call tries again.
     */
    private async recordWithdrawalReductions(
        tenantId: string,
        told: readonly SubscriptionNoticeRecord[],
        now: Date,
    ): Promise<void> {
        if (!this.withdrawalReductions) return;
        if (!told.some((record) => record.kind === 'feature-withdrawn')) return;
        try {
            await this.withdrawalReductions.recordReductions(tenantId, now);
        } catch (err) {
            this.logger.error(
                `Writing the reductions of a feature withdrawal into the contract failed ` +
                    `(tenant ${tenantId}): ${String(err)}`,
            );
        }
    }

    /**
     * What the feature withdrawals that reached the subscription change in its
     * account: their days, read from the withdrawals themselves — a lift is
     * recorded there, after the contracts that carry the reductions — and what
     * ended at once under them. A withdrawal counts whether or not its notice
     * reached anybody: the feature is gone either way.
     */
    private async withdrawalInputsOf(
        told: readonly SubscriptionNoticeRecord[],
    ): Promise<Pick<ChargeDerivationInput, 'withdrawals' | 'endedAtOnce' | 'lineGrants'>> {
        const reachedBy = new Set(
            told
                .filter((record) => record.kind === 'feature-withdrawn')
                .map((record) => record.subject),
        );
        if (reachedBy.size === 0 || !this.featureWithdrawals) return {};
        const withdrawals = (await this.featureWithdrawals.list())
            .filter((withdrawal) => reachedBy.has(withdrawal.id))
            .map(({ id, featureKey, effectiveFrom, liftedFrom }) => ({
                id,
                featureKey,
                effectiveFrom,
                liftedFrom,
            }));
        const endedAtOnce = told
            .filter((record) => record.kind === 'ended-at-once')
            .map((record) => record.content as EndedAtOnceNotice)
            .map((notice) => ({
                subscriptionBundleId: notice.subscriptionBundleId,
                at: new Date(notice.endedAt),
            }));
        const entitlements = this.entitlements;
        return {
            withdrawals,
            endedAtOnce,
            ...(entitlements
                ? {
                      lineGrants: (line, featureKey) =>
                          entitlements
                              .withReplacements(new Set(line.featuresSnapshot))
                              .has(featureKey),
                  }
                : {}),
        };
    }

    /**
     * The tenant's contracts, written once more where the one in force misses
     * a running booking.
     *
     * A booking writes its contract after it is saved, and a failure there does
     * not undo the booking. The booking would then stay uncharged for good,
     * since a charge points at a contract line — so the journal writes the
     * contract the way the booking would have. A failure here is logged and the
     * rest is charged: the next call tries again.
     */
    private async contractsNamingEveryBooking(
        tenantId: string,
        subscription: SubscriptionUsageRecord,
        bookings: readonly SubscriptionBundleRecord[],
        now: Date,
    ): Promise<SubscriptionContractRecord[]> {
        const contracts = await this.contracts.list({ tenantId });
        const missed = bookingsTheContractMisses(contracts, bookings, now);
        if (
            missed.length === 0 ||
            !this.freeze ||
            subscription.status === 'TRIAL' ||
            cancellationHasLanded(subscription, now)
        ) {
            return contracts;
        }
        try {
            await this.freeze.freezeOnPlanChange(
                tenantId,
                subscription.planVersion.planId,
                planCycleOf(subscription),
                now,
                endOf(subscription),
            );
        } catch (err) {
            this.logger.error(
                `Writing the contract for ${missed.length} booking(s) it misses failed ` +
                    `(tenant ${tenantId}): ${String(err)}`,
            );
            return contracts;
        }
        return this.contracts.list({ tenantId });
    }
}

/** What the entries ending at once at `at` credit, net, as a positive amount, and in which currency. */
function creditAt(
    charges: readonly NewSubscriberCharge[],
    at: Date,
): { creditNet: number; currency: string | null } {
    const credits = charges.filter(
        (charge) =>
            charge.periodStart.getTime() === at.getTime() &&
            (charge.origin === 'credit' || charge.origin === 'reductionTakenBack'),
    );
    const cents = credits.reduce((sum, charge) => sum + toCents(charge.amountNet), 0);
    return { creditNet: cents === 0 ? 0 : -cents / 100, currency: credits[0]?.currency ?? null };
}
