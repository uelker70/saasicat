// Ending at once while a feature is withdrawn: the subscriber's other choice
// beside the reduction.
//
// A subscription the withdrawal reached may end at once, without notice, for
// as long as the feature is withdrawn and its plan — or its special terms —
// would grant it; a booking it reached may end alone, for as long as its
// version would. Whatever was declared before — a cancellation for the end of
// the term included — the end is the moment it is declared, and the unused
// rest of what was charged is credited to the account. Everything here is
// decided by the server from what the subscription was told, never by what the
// request claims.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    isFeatureWithdrawnAt,
    type BillingCycle,
    type BundleRepository,
    type EndAtOncePreview,
    type EndedAtOnce,
    type EndedAtOnceNotice,
    type FeatureWithdrawalRecord,
    type FeatureWithdrawalRepository,
    type FeatureWithdrawnNotice,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
    type SubscriptionNoticeRepository,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
    type TenantFeatureWithdrawal,
    type TenantSubscriptionWritePort,
} from '@saasicat/core';

import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { cancellationHasLanded, cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import { FeatureWithdrawalService } from './feature-withdrawal.service.js';
import { freezeContractAfter } from './freeze-contract-after.js';
import { PLAN_CATALOG_SOURCE_TOKEN } from './plan-catalog.module.js';
import type { PlanCatalogSource } from './plan-catalog-source.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import {
    FEATURE_WITHDRAWAL_REPOSITORY_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
} from './tenant-billing.tokens.js';

/** One withdrawal the subscription was told of, with the withdrawal as it stands. */
interface Told {
    readonly notice: FeatureWithdrawnNotice;
    readonly withdrawal: FeatureWithdrawalRecord;
}

/** Everything the rights of one subscription are read from, read once. */
interface Situation {
    readonly subscription: SubscriptionUsageRecord & { readonly id: string };
    readonly told: readonly Told[];
    readonly bookings: readonly SubscriptionBundleRecord[];
    /** Whether the plan or the special terms grant a feature now, a `replaces` chain included. */
    readonly subscriptionGrants: (featureKey: string) => boolean;
    /** Whether a booking's version grants a feature now. */
    readonly bookingGrants: (booking: SubscriptionBundleRecord, featureKey: string) => boolean;
}

@Injectable()
export class EndAtOnceService {
    private readonly logger = new Logger(EndAtOnceService.name);

    constructor(
        @Inject(FEATURE_WITHDRAWAL_REPOSITORY_TOKEN)
        private readonly withdrawals: FeatureWithdrawalRepository,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly writes: TenantSubscriptionWritePort,
        @Inject(PLAN_CATALOG_SOURCE_TOKEN) private readonly catalogs: PlanCatalogSource,
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        @Inject(FeatureWithdrawalService)
        private readonly featureWithdrawals: FeatureWithdrawalService,
        // Optional: without bookings there is no booking to end.
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository | null = null,
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository | null = null,
        // Optional: without contracts nothing is ended there.
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        // Optional: without the journal nothing is credited.
        @Optional()
        @Inject(SubscriberChargeService)
        private readonly charges: SubscriberChargeService | null = null,
    ) {}

    /**
     * The withdrawals the tenant's subscription was told of that are not over:
     * what each takes away and from when, what each line is reduced by and
     * whether that still holds, and what may end at once now.
     */
    async withdrawalsOf(tenantId: string, now: Date): Promise<TenantFeatureWithdrawal[]> {
        const situation = await this.situationOf(tenantId);
        if (!situation) return [];
        return situation.told
            .filter(
                ({ withdrawal }) => withdrawal.liftedFrom === null || withdrawal.liftedFrom > now,
            )
            .map((told) => viewOf(told, situation, now));
    }

    /** What ending the subscription — or the booking named — at once now would credit. */
    async preview(
        tenantId: string,
        withdrawalId: string,
        subscriptionBundleId: string | null,
        now: Date,
    ): Promise<EndAtOncePreview> {
        const situation = await this.situationOf(tenantId);
        this.assertMayEnd(situation, withdrawalId, subscriptionBundleId, now);
        const credit = await this.creditOf(tenantId, subscriptionBundleId, now);
        return { endsAt: now.toISOString(), ...credit };
    }

    /**
     * Ends the subscription — or the booking named — at once, at `now`: the
     * end is recorded as ending at once under the withdrawal before it is
     * written, so the account can credit the unused rest whatever fails after;
     * then the contract is ended, the account brought up to date, and the
     * subscriber told.
     */
    async end(
        tenantId: string,
        withdrawalId: string,
        subscriptionBundleId: string | null,
        now: Date,
    ): Promise<EndedAtOnce> {
        const situation = await this.situationOf(tenantId);
        const { told, booking } = this.assertMayEnd(
            situation,
            withdrawalId,
            subscriptionBundleId,
            now,
        );
        const { subscription } = situation!;
        const declared = booking ? declaredEndOf(booking) : cancellationLandsAt(subscription);
        // Refused before anything is written: a cancellation declared for a
        // later date can be brought forward only where the store can.
        if (declared && !(booking ? this.bookings?.endNow : this.writes.endNow)) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED,
                message:
                    `Your cancellation for ${declared.toISOString().slice(0, 10)} is recorded, and ` +
                    'it cannot be brought forward here. It ends on that date, and until then the ' +
                    'reduction applies.',
                params: { date: declared.toISOString().slice(0, 10) },
            });
        }
        const credit = await this.creditOf(tenantId, subscriptionBundleId, now);
        const notice = await this.recordEnd(told, subscription, booking, now);
        const at = new Date(notice.endedAt);
        if (booking) {
            await this.endBooking(booking, declared, at);
            await freezeContractAfter(
                cancellationHasLanded(subscription, at) ? null : this.contractFreeze,
                tenantId,
                {
                    plan: subscription.plan,
                    cycle: subscription.billingCycle as BillingCycle,
                    effectiveFrom: at,
                    endsAt: cancellationLandsAt(subscription),
                },
                'an add-on ended at once',
                this.logger,
            );
        } else {
            await this.endSubscription(tenantId, declared, at);
            await this.endContract(tenantId, at);
        }
        this.entitlements.invalidateTenant(tenantId);
        await this.recordCharges(tenantId, at);
        await this.tell(notice, booking?.id ?? subscription.id);
        return {
            withdrawalId,
            subscriptionBundleId: booking?.id ?? null,
            endsAt: at.toISOString(),
            ...credit,
        };
    }

    // ── the rights ───────────────────────────────────────────────────────

    /**
     * Refuses an end the withdrawal does not open: one it did not reach, one
     * while it does not take the feature away, one of what has ended already,
     * and one of a subscription whose plan, or a booking whose version, no
     * longer grants the feature.
     */
    private assertMayEnd(
        situation: Situation | null,
        withdrawalId: string,
        subscriptionBundleId: string | null,
        now: Date,
    ): { told: Told; booking: SubscriptionBundleRecord | null } {
        const told = situation?.told.find(({ withdrawal }) => withdrawal.id === withdrawalId);
        if (!situation || !told) throw doesNotReach();
        if (!isFeatureWithdrawnAt(told.withdrawal, now)) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_NOT_IN_EFFECT,
                message: `${told.withdrawal.featureKey} is not withdrawn now, so nothing can be ended at once because of it.`,
                params: { featureKey: told.withdrawal.featureKey },
            });
        }
        if (cancellationHasLanded(situation.subscription, now)) throw alreadyEnded();
        if (subscriptionBundleId === null) {
            if (!subscriptionEndable(told, situation)) throw doesNotReach();
            return { told, booking: null };
        }
        const reached = told.notice.lines.some(
            (line) => line.subscriptionBundleId === subscriptionBundleId,
        );
        const booking = situation.bookings.find((one) => one.id === subscriptionBundleId);
        if (!reached || !booking) throw doesNotReach();
        if (bookingEnded(booking, now)) throw alreadyEnded();
        if (!situation.bookingGrants(booking, told.withdrawal.featureKey)) throw doesNotReach();
        return { told, booking };
    }

    private async situationOf(tenantId: string): Promise<Situation | null> {
        const subscription = await this.subscriptions.findForTenant(tenantId);
        if (!subscription?.id) return null;
        const records = (await this.notices.listForSubscription(subscription.id)).filter(
            (record) => record.kind === 'feature-withdrawn',
        );
        const withdrawals = new Map(
            records.length > 0
                ? (await this.withdrawals.list()).map((withdrawal) => [withdrawal.id, withdrawal])
                : [],
        );
        const told = records.flatMap((record) => {
            const notice = record.content as FeatureWithdrawnNotice;
            const withdrawal = withdrawals.get(notice.withdrawalId);
            return withdrawal ? [{ notice, withdrawal }] : [];
        });
        const bookings =
            told.length > 0 && this.bookings
                ? await this.bookings.listBySubscription(subscription.id)
                : [];
        const granted =
            told.length > 0
                ? ((
                      await this.entitlements.contractFeaturesFor(
                          tenantId,
                          [],
                          await this.catalogs.current(),
                      )
                  )?.features ?? new Set<string>())
                : new Set<string>();
        const versionFeatures = new Map<string, Set<string>>();
        for (const booking of bookings) {
            const version = await this.bundles?.findVersionById(booking.bundleVersionId);
            versionFeatures.set(
                booking.id,
                this.entitlements.withReplacements(new Set(version?.features ?? [])),
            );
        }
        return {
            subscription: { ...subscription, id: subscription.id },
            told,
            bookings,
            subscriptionGrants: (featureKey) => granted.has(featureKey),
            bookingGrants: (booking, featureKey) =>
                versionFeatures.get(booking.id)?.has(featureKey) ?? false,
        };
    }

    // ── the end ──────────────────────────────────────────────────────────

    /**
     * Records that it ends at once, once: a second request — a retry after a
     * failure below — finds the record and ends at the moment it names.
     */
    private async recordEnd(
        { notice, withdrawal }: Told,
        subscription: Situation['subscription'],
        booking: SubscriptionBundleRecord | null,
        now: Date,
    ): Promise<EndedAtOnceNotice> {
        const content: EndedAtOnceNotice = {
            kind: 'ended-at-once',
            tenantId: notice.tenantId,
            subscriptionId: subscription.id,
            subscriptionBundleId: booking?.id ?? null,
            withdrawalId: withdrawal.id,
            featureKey: withdrawal.featureKey,
            featureLabel: notice.featureLabel,
            endedAt: now.toISOString(),
        };
        const subject = booking?.id ?? subscription.id;
        const recorded = await this.notices.record(
            [
                {
                    tenantId: notice.tenantId,
                    subscriptionId: subscription.id,
                    kind: 'ended-at-once',
                    subject,
                    content,
                },
            ],
            now,
        );
        if (recorded > 0) return content;
        const earlier = (await this.notices.listForSubscription(subscription.id)).find(
            (record) => record.kind === 'ended-at-once' && record.subject === subject,
        );
        return (earlier?.content as EndedAtOnceNotice | undefined) ?? content;
    }

    private async endSubscription(
        tenantId: string,
        declared: Date | null,
        at: Date,
    ): Promise<void> {
        if (declared) {
            const ended = await this.writes.endNow!(tenantId, {
                at,
                expectedCanceledEffectiveAt: declared,
            });
            if (!ended.ended && ended.canceledEffectiveAt?.getTime() !== at.getTime()) {
                throw changedMeanwhile();
            }
            return;
        }
        const result = await this.writes.cancelSubscription(tenantId, {
            canceledAt: at,
            effectiveAt: at,
            terminateNow: true,
        });
        if (result.alreadyCanceled && result.canceledEffectiveAt?.getTime() !== at.getTime()) {
            throw changedMeanwhile();
        }
    }

    private async endBooking(
        booking: SubscriptionBundleRecord,
        declared: Date | null,
        at: Date,
    ): Promise<void> {
        if (declared) {
            const ended = await this.bookings!.endNow!(booking.id, {
                at,
                expectedCanceledEffectiveAt: declared,
            });
            if (!ended) throw changedMeanwhile();
            return;
        }
        await this.bookings!.cancel(booking.id, { canceledAt: at, canceledEffectiveAt: at });
    }

    /** The contract ends when the subscription does; logged, not thrown: the end is recorded. */
    private async endContract(tenantId: string, at: Date): Promise<void> {
        if (!this.contractFreeze) return;
        try {
            await this.contractFreeze.endOnCancellation(tenantId, at);
        } catch (error) {
            this.logger.error(
                `Ending the contract after an end at once failed (tenant ${tenantId}): ${String(error)}`,
            );
        }
    }

    /** Writes the credit; logged, not thrown: the journal finds it again on its next call. */
    private async recordCharges(tenantId: string, at: Date): Promise<void> {
        if (!this.charges) return;
        try {
            await this.charges.recordDueCharges(tenantId, at);
        } catch (error) {
            this.logger.error(
                `Bringing the account up to date after an end at once failed (tenant ${tenantId}): ` +
                    String(error),
            );
        }
    }

    /** Tells the subscriber; a notice that cannot be sent now is sent by the next run. */
    private async tell(notice: EndedAtOnceNotice, subject: string): Promise<void> {
        try {
            await this.featureWithdrawals.tell(notice, subject);
        } catch (error) {
            this.logger.error(
                `The notice of an end at once could not be sent now; the next run tries again: ${String(error)}`,
            );
        }
    }

    private async creditOf(
        tenantId: string,
        subscriptionBundleId: string | null,
        at: Date,
    ): Promise<{ creditNet: number; currency: string | null }> {
        if (!this.charges) return { creditNet: 0, currency: null };
        return this.charges.creditOfEndingAtOnce(tenantId, subscriptionBundleId, at);
    }
}

/** What the tenant sees of one withdrawal its subscription was told of. */
function viewOf(
    { notice, withdrawal }: Told,
    situation: Situation,
    now: Date,
): TenantFeatureWithdrawal {
    const inEffect = isFeatureWithdrawnAt(withdrawal, now);
    const { subscription } = situation;
    const running = !cancellationHasLanded(subscription, now);
    const lines = notice.lines.map((line) => {
        if (line.subscriptionBundleId === null) {
            const reduced =
                running &&
                subscription.plan === line.key &&
                subscription.billingCycle === line.billingCycle &&
                situation.subscriptionGrants(withdrawal.featureKey);
            return { ...line, reduced };
        }
        const booking = situation.bookings.find((one) => one.id === line.subscriptionBundleId);
        const reduced =
            running &&
            booking !== undefined &&
            !bookingEnded(booking, now) &&
            (booking.billingCycle ?? subscription.billingCycle) === line.billingCycle &&
            situation.bookingGrants(booking, withdrawal.featureKey);
        return { ...line, reduced };
    });
    const endableBookings = notice.lines.flatMap((line) => {
        const booking = situation.bookings.find((one) => one.id === line.subscriptionBundleId);
        return inEffect &&
            running &&
            booking &&
            !bookingEnded(booking, now) &&
            situation.bookingGrants(booking, withdrawal.featureKey)
            ? [booking.id]
            : [];
    });
    return {
        withdrawalId: withdrawal.id,
        featureKey: withdrawal.featureKey,
        featureLabel: notice.featureLabel,
        reason: withdrawal.reason,
        effectiveFrom: withdrawal.effectiveFrom.toISOString(),
        liftedFrom: withdrawal.liftedFrom?.toISOString() ?? null,
        inEffect,
        lines,
        specialTerms: notice.specialTerms,
        endable: {
            subscription:
                inEffect && running && subscriptionEndable({ notice, withdrawal }, situation),
            subscriptionBundleIds: endableBookings,
        },
    };
}

/**
 * Whether the subscription may end at once under the withdrawal it was told
 * of: it was reached through its plan or its special terms, and its plan or
 * special terms still grant the feature. A change to a plan without it ends
 * the right with the feature it was about.
 */
function subscriptionEndable({ notice, withdrawal }: Told, situation: Situation): boolean {
    const reachedThroughThePlan =
        notice.specialTerms || notice.lines.some((line) => line.subscriptionBundleId === null);
    return reachedThroughThePlan && situation.subscriptionGrants(withdrawal.featureKey);
}

function bookingEnded(booking: SubscriptionBundleRecord, now: Date): boolean {
    return booking.canceledEffectiveAt !== null && booking.canceledEffectiveAt <= now;
}

/** When a booking's declared cancellation lands, or null where none is declared. */
function declaredEndOf(booking: SubscriptionBundleRecord): Date | null {
    return booking.canceledAt === null ? null : (booking.canceledEffectiveAt ?? booking.canceledAt);
}

function doesNotReach(): UnprocessableEntityException {
    return new UnprocessableEntityException({
        code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_DOES_NOT_REACH,
        message: 'This withdrawal does not reach your subscription, or no longer this booking.',
        params: {},
    });
}

function alreadyEnded(): ConflictException {
    return new ConflictException({
        code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_ALREADY_ENDED,
        message: 'This has ended already.',
        params: {},
    });
}

/** The cancellation moved between the read and the write; nothing was ended. Ask again. */
function changedMeanwhile(): ConflictException {
    return new ConflictException({
        code: BILLING_ERROR_CODES.CANCELLATION_TERMS_CHANGED,
        message: 'The cancellation changed meanwhile. Look at it again before ending at once.',
        params: {},
    });
}
