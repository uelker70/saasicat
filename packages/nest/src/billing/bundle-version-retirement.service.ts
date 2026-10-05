// An orderly retirement of an add-on version: an operator ends an add-on
// version for the bookings already on it and names the version of the same
// add-on they continue on.
//
// It rests on what a plan version's retirement rests on
// (`VersionRetirementService`): a clause in the operator's terms, which
// `config/saas.yaml` confirms; a version no longer on sale, so nobody books it
// after the announcement; a replacement that is on sale; a notice that has to
// reach somebody before any date is set; and one retirement per subscription
// in twelve months, plan and add-on together. What is the booking's is its
// own: the date is an end of the booking's period, the prices told are the
// add-on's beside the subscription's plan, and the replacement is a version of
// the same add-on, so the booking stays the same booking with its term — and
// has to be able to run beside the plan the subscription is on at the date.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    type OnModuleInit,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    CATALOG_ERROR_CODES,
    type AdminActor,
    type BillingCycle,
    type BundleRepository,
    type BundleRetirementAnnounced,
    type BundleRetirementPreview,
    type BundleRetirementReachedRow,
    type BundleRetirementSkippedRow,
    type BundleVersionRetiredNotice,
    type BundleVersionRetirementRecord,
    type BundleVersionRetirementRepository,
    type BundleVersionRetirementView,
    type BundleVersionRow,
    type PlanCatalogSettings,
    type RetiredBundleVersionRef,
    type RetirementBlocker,
    type RlsBypassPort,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
    type SubscriptionNoticePort,
    type SubscriptionNoticeRecord,
    type SubscriptionNoticeRepository,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
    type TransactionRunner,
    type VersionRetiredNotice,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { BUNDLE_REPOSITORY_TOKEN, type BundleDeletionCheck } from '../catalog/catalog.tokens.js';
import { bundleVersionNotBookableReason } from '../checkout-offer/bundle-version-bookable.js';
import { actorTagOf } from '../core/web-audit.js';
import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import {
    addOnMisfits,
    bookableBeside,
    type AddOnAhead,
    type PlanAhead,
    type PlanBeside,
} from './add-on-fits-plan.js';
import {
    bundleVersionChanges,
    bundleVersionSide,
    bundleRetirementSidesFor,
} from './bundle-version-sides.js';
import { bookingsOfVersion, type BookingsOnVersion } from './bundle-bookings-of-version.js';
import {
    bookingOverBy,
    bundleRetirementReach,
    planAt,
    plansMetAfter,
    type BundleRetirementReach,
} from './bundle-retirement-reach.js';
import {
    NOTICE_CLAIM_LEASE_MS,
    NOTICE_DELIVERY_TIMEOUT_MS,
    NoticeSender,
} from './notice-sender.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import { plansAheadOf } from './plans-ahead.js';
import {
    reachedSomebody,
    remindedByRetirement,
    retirementNoticesTold,
    retirementsOfItsVersion,
    subscriptionsReachedSince,
    toldOfAnotherRetirementWithinAYear,
    toldRetirementNotices,
} from './retirement-notices.js';
import {
    progressOf,
    sameSet,
    waitReasonOf,
    type NoticeReadiness,
    type ReachedState,
} from './retirement-progress.js';
import { RETIREMENT_REPEAT_MONTHS, calendarMonthsAfter } from './retirement-reach.js';
import { onceEach } from './versions-read-once.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import {
    BUNDLE_VERSION_RETIREMENT_REPOSITORY_TOKEN,
    SUBSCRIPTION_NOTICE_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    VERSION_RETIREMENT_TRANSACTION_RUNNER_TOKEN,
} from './tenant-billing.tokens.js';
import {
    retirementTermsConfirmed,
    type RetirementNoticeRun,
} from './version-retirement.service.js';

const KIND = 'bundle-version-retired';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether `version`, billed in `cycle`, can run beside each of `plans`: the
 * plan a booking runs beside at its date and every one it moves to after it
 * (`SC-BUN-044`, the question `SC-BUN-037` asks of a booking).
 */
function runsBesideEach(
    version: BundleVersionRow,
    plans: readonly PlanBeside[],
    cycle: BillingCycle,
): boolean {
    return plans.every((plan) => addOnMisfits(version, plan, cycle).length === 0);
}

/** The preview, with the two versions it was computed from. */
interface ComputedPreview {
    readonly preview: BundleRetirementPreview;
    readonly retired: BundleVersionRow;
    readonly replacement: BundleVersionRow;
}

@Injectable()
export class BundleVersionRetirementService implements OnModuleInit, BundleDeletionCheck {
    private readonly logger = new Logger(BundleVersionRetirementService.name);
    private readonly deliveryTimeoutMs = NOTICE_DELIVERY_TIMEOUT_MS;
    private readonly sender: NoticeSender;

    constructor(
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository,
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_NOTICE_PORT_TOKEN)
        port: SubscriptionNoticePort,
        @Inject(BUNDLE_VERSION_RETIREMENT_REPOSITORY_TOKEN)
        private readonly retirements: BundleVersionRetirementRepository,
        @Inject(VERSION_RETIREMENT_TRANSACTION_RUNNER_TOKEN)
        private readonly transactions: TransactionRunner,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
        // The reach is the installation's, not a tenant's: under a row policy
        // it would otherwise find nobody on the version.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {
        // A retirement counts from its notice reaching somebody, so one the
        // application tells nobody of is tried again.
        this.sender = new NoticeSender(notices, port, { retriesNobody: true });
    }

    /** Refuses a wiring that could never find the bookings a retirement reaches. */
    onModuleInit(): void {
        if (!retirementTermsConfirmed(this.settings)) return;
        if (!this.bookings.listOfVersion) {
            throw new Error(
                'Retiring versions is turned on, but the SubscriptionBundleRepository has no ' +
                    '`listOfVersion`: the platform cannot find the bookings an add-on retirement ' +
                    'reaches. Both shipped adapters have it; a repository of your own adds it.',
            );
        }
        if (!this.subscriptions.listByIds) {
            throw new Error(
                'Retiring versions is turned on, but the SubscriptionUsagePort has no ' +
                    '`listByIds`: the platform cannot find the subscription of a booking an ' +
                    'add-on retirement reaches. Both shipped adapters have it; a port of your ' +
                    'own adds it.',
            );
        }
        if (!this.bookings.moveToVersion) {
            throw new Error(
                'Retiring versions is turned on, but the SubscriptionBundleRepository has no ' +
                    '`moveToVersion`: the platform cannot move a booking onto the replacement ' +
                    'at its date. Both shipped adapters have it; a repository of your own adds it.',
            );
        }
    }

    /**
     * What retiring the add-on version `retiredId` for `replacementId` would do
     * if announced at `now`. Everything that would refuse the announcement is a
     * blocker rather than thrown, so the operator sees all of it at once —
     * except terms that are not confirmed, which leave retiring off.
     */
    async preview(
        retiredId: string,
        replacementId: string,
        now: Date,
    ): Promise<BundleRetirementPreview> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const computed = await this.computePreview(retiredId, replacementId, now);
            return computed.preview;
        });
    }

    /**
     * Announces the retirement, provided it reaches exactly the bookings the
     * operator was shown (`shownBookingIds`). Every notice is recorded before
     * any is sent; one that cannot be sent now is sent by the next run.
     */
    async announce(
        retiredId: string,
        replacementId: string,
        shownBookingIds: readonly string[],
        actor: AdminActor,
        now: Date,
    ): Promise<BundleRetirementAnnounced> {
        return readAcrossTenants(this.rlsBypass, () =>
            this.announceAcrossTenants(retiredId, replacementId, shownBookingIds, actor, now),
        );
    }

    private async announceAcrossTenants(
        retiredId: string,
        replacementId: string,
        shownBookingIds: readonly string[],
        actor: AdminActor,
        now: Date,
    ): Promise<BundleRetirementAnnounced> {
        const { preview, retired, replacement } = await this.computePreview(
            retiredId,
            replacementId,
            now,
        );
        const [first] = preview.blockers;
        if (first) {
            throw new UnprocessableEntityException({ ...first, blockers: preview.blockers });
        }
        if (
            !sameSet(
                preview.reached.map((row) => row.subscriptionBundleId),
                shownBookingIds,
            )
        ) {
            throw new ConflictException({
                code: BILLING_ERROR_CODES.RETIREMENT_PREVIEW_CHANGED,
                message:
                    'The subscriptions this retirement reaches changed since they were shown. ' +
                    'Look at them again before announcing it.',
                params: {},
                preview,
            });
        }

        const retirement = await this.transactions.run(async (tx) => {
            const created = await this.retirements.create(
                {
                    retired: refOf(retired),
                    replacement: refOf(replacement),
                    announcedAt: now,
                    announcedBy: actorTagOf(actor),
                },
                tx,
            );
            const recorded = await this.notices.record(
                preview.reached.map((row) => {
                    const notice = noticeOf(created.id, retired, replacement, row);
                    return { ...keyOf(notice), content: notice };
                }),
                now,
                tx,
            );
            // A notice is kept once per subscription and add-on version retired,
            // so one already there was written by another announcement of this
            // version that passed the same checks beside this one. Thrown inside
            // the transaction, so this announcement is not kept either.
            const alreadyReached = preview.reached.length - recorded;
            if (alreadyReached > 0) {
                throw new ConflictException({
                    code: BILLING_ERROR_CODES.RETIREMENT_WITHIN_TWELVE_MONTHS,
                    message:
                        `${alreadyReached} of these subscriptions were reached by another ` +
                        'retirement of this version meanwhile. A subscription is reached at most ' +
                        'once a year.',
                    params: { count: alreadyReached },
                });
            }
            return created;
        });
        // From here on the retirement is announced, whatever fails: what is
        // left is reported, not thrown, so the operator is not told it failed
        // when it did not.
        try {
            await this.audit?.log({
                actor,
                entity: 'BundleVersion',
                entityId: retirement.retired.bundleVersionId,
                action: 'BUNDLE_VERSION_RETIRE',
                changes: {
                    retirementId: retirement.id,
                    replacementBundleVersionId: retirement.replacement.bundleVersionId,
                    bookings: preview.reached.length,
                },
            });
        } catch (error) {
            this.logger.error(
                `Add-on retirement ${retirement.id} is announced, but writing its audit entry failed.`,
                error instanceof Error ? error.stack : String(error),
            );
        }

        let told = 0;
        let failed = 0;
        for (const row of preview.reached) {
            const notice = noticeOf(retirement.id, retired, replacement, row);
            const outcome = await this.sender.tell(
                notice,
                keyOf(notice).subject,
                this.deliveryTimeoutMs,
            );
            if (outcome === 'told') told += 1;
            // Told to nobody is not told: the next run tries again.
            if (outcome === 'failed' || outcome === 'untold') failed += 1;
        }
        return { retirement, told, failed };
    }

    /**
     * Sends every add-on retirement notice that is recorded and has reached
     * nobody yet. The date counts from the notice reaching the subscriber
     * (`SC-BUN-043`), so a notice sent now names the date counted from now,
     * priced for the plan the subscription is on then. A booking that has
     * left the version, or that the retirement no longer reaches, is not told.
     */
    async sendUndelivered(now: Date): Promise<RetirementNoticeRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            let told = 0;
            let failed = 0;
            const started = Date.now();
            const sendingAt = () => new Date(now.getTime() + (Date.now() - started));
            const staleBefore = new Date(now.getTime() - NOTICE_CLAIM_LEASE_MS);
            const waiting = (await this.notices.listUndelivered(KIND, staleBefore)).map(
                (record) => record.content as BundleVersionRetiredNotice,
            );
            const versions = onceEach(this.bundles);
            for (const retiredId of new Set(waiting.map((n) => n.retired.bundleVersionId))) {
                const { bookings, owners } = await this.bookingsOf(retiredId);
                for (const stored of waiting) {
                    if (stored.retired.bundleVersionId !== retiredId) continue;
                    const readiness = await this.readinessOf(
                        stored,
                        bookings.get(stored.subscriptionBundleId),
                        owners.get(stored.subscriptionId)?.subscription,
                        sendingAt(),
                        versions,
                    );
                    if (!('ready' in readiness)) continue;
                    const notice = await this.retold(stored, readiness.ready, versions);
                    const outcome = await this.sender.tell(
                        notice,
                        retiredId,
                        this.deliveryTimeoutMs,
                    );
                    if (outcome === 'told') told += 1;
                    if (outcome === 'failed') failed += 1;
                }
            }
            return { told, failed };
        });
    }

    /**
     * The add-on retirement that reaches the booking `subscriptionBundleId` and
     * has not taken effect at `now`, or null — as the subscriber was told, and
     * only once they were (`SC-BUN-043`), and only while the booking is still
     * on the version retired. Until then the booking may be cancelled without
     * its minimum term (`SC-BUN-045`); a switch to the replacement ends that,
     * since the right rests on the version being retired (`SC-BUN-054`).
     */
    async pendingForBooking(
        subscriptionId: string,
        subscriptionBundleId: string,
        now: Date,
    ): Promise<BundleVersionRetiredNotice | null> {
        const told = await this.toldForSubscription(subscriptionId);
        const notice = told.find(
            (candidate) =>
                candidate.subscriptionBundleId === subscriptionBundleId &&
                new Date(candidate.effectiveAt) > now,
        );
        if (!notice) return null;
        const booking = await this.bookings.findById(subscriptionBundleId);
        return booking?.bundleVersionId === notice.retired.bundleVersionId ? notice : null;
    }

    /**
     * Why the booking `subscriptionBundleId` may not be reinstated at `now`, or null.
     * A booking on a version being retired that the announcement did not
     * reach — cancelled to end before it would move — was never told, and
     * nothing moves it; reinstated, it would run on past the date on a version
     * nobody sells. A booking that was reached keeps its notice, and moves.
     */
    async refusalToReinstate(
        subscriptionId: string,
        subscriptionBundleId: string,
        now: Date,
    ): Promise<RetirementBlocker | null> {
        const booking = await this.bookings.findById(subscriptionBundleId);
        // The booking service answers for a booking that is missing or not this
        // subscription's.
        if (!booking || booking.subscriptionId !== subscriptionId) return null;
        const retirement = (await this.retirements.list()).find(
            (announced) => announced.retired.bundleVersionId === booking.bundleVersionId,
        );
        if (!retirement) return null;
        const records = await this.notices.listForSubscription(subscriptionId);
        const reached = records.some(
            (record) => record.kind === KIND && record.subject === booking.bundleVersionId,
        );
        // Only a cancelled booking still running is reinstated; the booking
        // route answers for one that is not cancelled, and for one whose
        // cancellation has landed (`SUBSCRIPTION_BUNDLE_CANCELLATION_EFFECTIVE`).
        const ends = booking.canceledEffectiveAt ?? booking.canceledAt;
        const landed = booking.canceledEffectiveAt !== null && booking.canceledEffectiveAt <= now;
        if (reached || ends === null || landed) return null;
        const { retired, replacement } = retirement;
        // The booking still runs until its cancellation lands, and an add-on
        // is booked once at a time (`SC-BUN-027`), so the replacement can be
        // booked once it has: from that day where it lands at midnight UTC,
        // as a period end does, and from the next where it lands during one.
        const bookableAt = new Date(Math.ceil(ends.getTime() / DAY_MS) * DAY_MS);
        const params = {
            bundleKey: retired.bundleKey,
            version: retired.version,
            replacementVersion: replacement.version,
        };
        const sentence =
            `Version ${retired.version} of ${retired.bundleKey} is being retired, and this ` +
            'booking ends before it would move.';
        const instead = await this.whatCanBeBookedInstead(
            subscriptionId,
            replacement.bundleVersionId,
            bookableAt,
            records,
        );
        if (instead === 'subscription-ends') {
            return {
                code: BILLING_ERROR_CODES.BUNDLE_RETIREMENT_REINSTATE_SUBSCRIPTION_ENDS,
                message: `${sentence} Your subscription ends by then as well.`,
                params,
            };
        }
        if (instead === 'nothing-fits') {
            return {
                code: BILLING_ERROR_CODES.BUNDLE_RETIREMENT_REINSTATE_REPLACEMENT_CANNOT_RUN,
                message:
                    `${sentence} Version ${replacement.version}, which replaces it, cannot run ` +
                    'beside your plan, or beside one your subscription is set to move to.',
                params,
            };
        }
        const bookableFrom = bookableAt.toISOString().slice(0, 10);
        return {
            code: BILLING_ERROR_CODES.BUNDLE_RETIREMENT_REINSTATE_REFUSED,
            message:
                `${sentence} Book version ${replacement.version} from ${bookableFrom}, when ` +
                'this booking has ended.',
            params: { ...params, bookableFrom },
        };
    }

    /**
     * What the subscription can book in place of a booking that ends at `at`:
     * the version `bundleVersionId`, unless the subscription ends by then as
     * well, or the version cannot run beside the plan it is on then, or beside
     * one it is set to move to after it, in any rhythm. The booking was
     * cancelled before the announcement, so the announcement never asked this
     * of its plans (`SC-BUN-044`). Where either cannot be read, the booking
     * route answers when the version is booked.
     */
    private async whatCanBeBookedInstead(
        subscriptionId: string,
        bundleVersionId: string,
        at: Date,
        records: readonly SubscriptionNoticeRecord[],
    ): Promise<'the-version' | 'subscription-ends' | 'nothing-fits'> {
        const [owner] = (await this.subscriptions.listByIds?.([subscriptionId])) ?? [];
        if (!owner) return 'the-version';
        const subscription = owner.subscription;
        const subscriptionEnds = cancellationLandsAt(subscription);
        if (subscriptionEnds !== null && subscriptionEnds <= at) return 'subscription-ends';
        const version = await this.bundles.findVersionById(bundleVersionId);
        if (!version) return 'the-version';
        const ahead = await this.plansAheadFor(subscription, records);
        const plans = [planAt(subscription, at, ahead), ...plansMetAfter(ahead, at, subscription)];
        return bookableBeside(version, plans) ? 'the-version' : 'nothing-fits';
    }

    /**
     * The plans `subscription` is set to move to (`plansAheadOf`), from its own
     * notices: `records` where they are read already.
     */
    private async plansAheadFor(
        subscription: SubscriptionUsageRecord,
        records?: readonly SubscriptionNoticeRecord[],
    ): Promise<PlanAhead[]> {
        const id = subscription.id;
        if (!id) return plansAheadOf(subscription, []);
        const told = toldRetirementNotices(records ?? (await this.notices.listForSubscription(id)));
        return plansAheadOf(subscription, retirementsOfItsVersion(told, subscription));
    }

    /**
     * The bookings of the subscription told that their version is being
     * retired, each with the version it continues on. A plan change asks the
     * replacement too, since the booking runs on it from the date whatever
     * plan the subscription is on then (`SC-BUN-044`).
     */
    async addOnsAhead(subscriptionId: string): Promise<AddOnAhead[]> {
        return (await this.toldForSubscription(subscriptionId)).map((notice) => ({
            subscriptionBundleId: notice.subscriptionBundleId,
            retiredBundleVersionId: notice.retired.bundleVersionId,
            replacementBundleVersionId: notice.replacement.bundleVersionId,
            effectiveAt: notice.effectiveAt,
        }));
    }

    /** Every add-on retirement the subscription was told of, the most recent first. */
    async toldForSubscription(subscriptionId: string): Promise<BundleVersionRetiredNotice[]> {
        return (await this.notices.listForSubscription(subscriptionId))
            .filter((record) => record.kind === KIND && reachedSomebody(record))
            .map((record) => record.content as BundleVersionRetiredNotice);
    }

    /**
     * Every add-on announcement, the most recent first, with how far it has
     * come over the bookings it reached (`SC-BUN-053`).
     */
    async list(now = new Date()): Promise<BundleVersionRetirementView[]> {
        return readAcrossTenants(this.rlsBypass, async () =>
            this.viewsOf(await this.retirements.list(), now),
        );
    }

    /** `retirements`, each with how far it has come at `now`. */
    private async viewsOf(
        retirements: readonly BundleVersionRetirementRecord[],
        now: Date,
    ): Promise<BundleVersionRetirementView[]> {
        const [records, reminded] = await Promise.all([
            this.notices.listOfKindSince(KIND, new Date(0)),
            remindedByRetirement(this.notices, 'bundle-version-retirement-reminder'),
        ]);
        const versions = onceEach(this.bundles);
        const onRecord = records.map((record) => ({
            notice: record.content as BundleVersionRetiredNotice,
            told: reachedSomebody(record),
        }));
        const bookingsOf = new Map<string, Promise<BookingsOnVersion>>();
        const onVersion = (bundleVersionId: string) => {
            let found = bookingsOf.get(bundleVersionId);
            if (!found) {
                found = this.bookingsOf(bundleVersionId);
                bookingsOf.set(bundleVersionId, found);
            }
            return found;
        };
        return Promise.all(
            retirements.map(async (retirement) => {
                const onIt = await onVersion(retirement.retired.bundleVersionId);
                const states = await Promise.all(
                    onRecord
                        .filter(({ notice }) => notice.retirementId === retirement.id)
                        .map(({ notice, told }) => this.stateOf(notice, told, onIt, now, versions)),
                );
                const progress = progressOf(states, now);
                return {
                    ...retirement,
                    progress: { ...progress, reminded: reminded.get(retirement.id) ?? 0 },
                };
            }),
        );
    }

    /**
     * Whether a notice not told yet can go out at `at`, with the reach it then
     * says; or why it waits. The retirement may no longer reach the booking;
     * the plans beside the add-on may have changed while it waited, and it
     * says what happens only where the replacement can run beside the plan at
     * the date and each one after it (`SC-BUN-044`); and a subscription told of
     * another retirement within twelve months is told of this one once those
     * are over (`SC-BUN-041`). The run sends on the answer, and the operator's
     * list counts it.
     */
    private async readinessOf(
        stored: BundleVersionRetiredNotice,
        booking: SubscriptionBundleRecord | undefined,
        sub: SubscriptionUsageRecord | undefined,
        at: Date,
        versions: Pick<BundleRepository, 'findVersionById'>,
    ): Promise<NoticeReadiness<Extract<BundleRetirementReach, { reached: true }>>> {
        const reach =
            booking && sub
                ? bundleRetirementReach(booking, sub, at, await this.plansAheadFor(sub))
                : null;
        if (!reach?.reached) return { waits: 'noLongerReached' };
        const replacement = await versions.findVersionById(stored.replacement.bundleVersionId);
        if (
            !replacement ||
            !runsBesideEach(replacement, [reach.plan, ...reach.plansAfter], reach.billingCycle)
        ) {
            return { waits: 'doesNotFit' };
        }
        if (
            await toldOfAnotherRetirementWithinAYear(
                this.notices,
                stored.subscriptionId,
                stored.retired.bundleVersionId,
                at,
            )
        ) {
            return { waits: 'twelveMonths' };
        }
        return { ready: reach };
    }

    /**
     * Where one booking an add-on retirement reached stands at `now`: and,
     * where its notice is not told yet while it is still on the version and
     * running, why that notice waits.
     */
    private async stateOf(
        notice: BundleVersionRetiredNotice,
        told: boolean,
        { bookings, owners }: BookingsOnVersion,
        now: Date,
        versions: Pick<BundleRepository, 'findVersionById'>,
    ): Promise<ReachedState> {
        const booking = bookings.get(notice.subscriptionBundleId);
        const sub = owners.get(notice.subscriptionId)?.subscription;
        const effectiveAt = new Date(notice.effectiveAt);
        // Over by its date, or over since and still on the version: the run
        // moves neither (`BundleRetirementMoveService`).
        const endsBeforeItMoves = Boolean(
            booking &&
            bookingOverBy(
                booking,
                sub ? cancellationLandsAt(sub) : null,
                effectiveAt > now ? effectiveAt : now,
            ),
        );
        const state = { stillOn: Boolean(booking), endsBeforeItMoves, told, effectiveAt };
        if (told || !booking || endsBeforeItMoves) return state;
        const readiness = await this.readinessOf(notice, booking, sub, now, versions);
        return { ...state, waitsBecause: waitReasonOf(readiness) };
    }

    /**
     * Refuses deleting the add-on `bundleId` while bookings still have to move
     * onto one of its versions (`SC-BUN-051`): their notices promised them the
     * replacement, and a deleted add-on is booked by nothing, the move
     * included. A booking that has moved, that has ended, or whose notice can
     * no longer go out holds nothing up; one whose notice is still to go out
     * does. Only the add-on's own retirements are read.
     */
    async assertMayDelete(bundleId: string, now = new Date()): Promise<void> {
        const bundle = await this.bundles.findById(bundleId);
        // The catalogue answers for an add-on that is not there.
        if (!bundle) return;
        const views = await readAcrossTenants(this.rlsBypass, async () =>
            this.viewsOf(
                (await this.retirements.list()).filter(
                    (retirement) => retirement.retired.bundleKey === bundle.bundleKey,
                ),
                now,
            ),
        );
        const stillToMove = views.reduce(
            (count, { progress }) =>
                count +
                progress.waiting +
                progress.overdue +
                progress.notTold -
                (progress.notToldReasons?.noLongerReached ?? 0),
            0,
        );
        if (stillToMove === 0) return;
        throw new UnprocessableEntityException({
            code: CATALOG_ERROR_CODES.BUNDLE_DELETE_WHILE_RETIREMENT_MOVES_PENDING,
            message:
                `${stillToMove} bookings still move onto a version of ${bundle.bundleKey}, as a ` +
                'retirement told them. The add-on can be deleted once they have.',
            params: { count: stillToMove, bundleKey: bundle.bundleKey },
        });
    }

    private async computePreview(
        retiredId: string,
        replacementId: string,
        now: Date,
    ): Promise<ComputedPreview> {
        if (!retirementTermsConfirmed(this.settings)) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.RETIREMENT_TERMS_NOT_CONFIRMED,
                message:
                    'Retiring a version for running subscriptions needs a clause in your terms. ' +
                    'Set tenantBilling.orderlyRetirement.termsConfirmed in config/saas.yaml once ' +
                    'they carry it.',
                params: {},
            });
        }
        if (retiredId === replacementId) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.RETIREMENT_REPLACEMENT_IS_RETIRED,
                message: 'A version cannot be its own replacement.',
                params: {},
            });
        }
        const retired = await this.versionOf(retiredId);
        const replacement = await this.versionOf(replacementId);
        const retiredSide = bundleVersionSide(retired, null);
        const replacementSide = bundleVersionSide(replacement, null);

        const blockers: RetirementBlocker[] = [];
        // Off sale by the booking rule (`SC-BUN-035`, `SC-BUN-036`), so nobody
        // books the version after the announcement, and the replacement is on
        // sale by the same rule, so a booking can continue on it.
        if (await this.bookable(retired, now)) {
            blockers.push(blocker(BILLING_ERROR_CODES.BUNDLE_RETIREMENT_VERSION_ON_SALE, retired));
        }
        if (!(await this.bookable(replacement, now))) {
            blockers.push(
                blocker(BILLING_ERROR_CODES.BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE, replacement),
            );
        }
        // The booking stays the same booking, so it continues on a version of
        // its own add-on.
        if (replacement.bundleId !== retired.bundleId) {
            blockers.push({
                code: BILLING_ERROR_CODES.BUNDLE_RETIREMENT_REPLACEMENT_OF_ANOTHER_BUNDLE,
                message:
                    `The replacement is a version of ${replacement.bundleKey}, not of ` +
                    `${retired.bundleKey}. A booking continues on a version of its own add-on.`,
                params: {
                    bundleKey: retired.bundleKey,
                    replacementBundleKey: replacement.bundleKey,
                },
            });
        }

        const { reached, skipped, plansAfter } = await this.reachOf(retired.id, now);
        if (reached.length === 0) {
            blockers.push(blocker(BILLING_ERROR_CODES.BUNDLE_RETIREMENT_NOTHING_AFFECTED, retired));
        }
        // Continuing on a version means running beside the plan the
        // subscription is on at the date, in the rhythm both are billed in
        // then, and beside every plan it is set to move to after it
        // (`SC-BUN-044`, the rule of `SC-CHG-024`).
        const cannotRun = reached.filter(
            (row) =>
                !runsBesideEach(
                    replacement,
                    [
                        { planKey: row.planKey, billingCycle: row.planCycle as BillingCycle },
                        ...(plansAfter.get(row.subscriptionBundleId) ?? []),
                    ],
                    row.billingCycle as BillingCycle,
                ),
        );
        if (cannotRun.length > 0) {
            blockers.push({
                code: BILLING_ERROR_CODES.BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN,
                message:
                    `${cannotRun.length} of these bookings run beside a plan that version ` +
                    `${replacement.version} of ${replacement.bundleKey} cannot run beside, so ` +
                    'they cannot continue on it.',
                params: {
                    count: cannotRun.length,
                    bundleKey: replacement.bundleKey,
                    version: replacement.version,
                },
            });
        }
        const recent = reached.filter((row) => row.reachedRecently);
        if (recent.length > 0) {
            blockers.push({
                code: BILLING_ERROR_CODES.RETIREMENT_WITHIN_TWELVE_MONTHS,
                message:
                    `${recent.length} of these subscriptions were reached by a retirement within ` +
                    'the last twelve months. A subscription is reached at most once a year.',
                params: { count: recent.length },
            });
        }
        return {
            preview: {
                retired: retiredSide,
                replacement: replacementSide,
                changes: bundleVersionChanges(retiredSide, replacementSide),
                asOf: now.toISOString(),
                reached,
                skipped,
                blockers,
            },
            retired,
            replacement,
        };
    }

    /**
     * Which bookings of the version a retirement now reaches, and which it
     * does not; for each one reached, the plans it meets after its date.
     */
    private async reachOf(
        bundleVersionId: string,
        now: Date,
    ): Promise<{
        reached: BundleRetirementReachedRow[];
        skipped: BundleRetirementSkippedRow[];
        plansAfter: Map<string, readonly PlanAhead[]>;
    }> {
        const { bookings, owners } = await this.bookingsOf(bundleVersionId);
        // The plan retirements told, read once for every subscription: one
        // that moves a subscription by a booking's date sets the plan its
        // add-on runs beside then (`SC-BUN-044`).
        const toldPlans = new Map<string, VersionRetiredNotice[]>();
        for (const notice of await retirementNoticesTold(this.notices)) {
            const ofSubscription = toldPlans.get(notice.subscriptionId) ?? [];
            ofSubscription.push(notice);
            toldPlans.set(notice.subscriptionId, ofSubscription);
        }
        const recently = await subscriptionsReachedSince(
            this.notices,
            calendarMonthsAfter(now, -RETIREMENT_REPEAT_MONTHS),
        );
        // Told of this version's retirement already, by an earlier announcement:
        // that one stands, and its notice is the one the booking keeps.
        const told = new Set(
            (await this.notices.listOfKindSince(KIND, new Date(0)))
                .filter((notice) => notice.subject === bundleVersionId)
                .map((notice) => notice.subscriptionId),
        );
        const reached: BundleRetirementReachedRow[] = [];
        const skipped: BundleRetirementSkippedRow[] = [];
        const plansAfter = new Map<string, readonly PlanAhead[]>();
        for (const booking of bookings.values()) {
            const owner = owners.get(booking.subscriptionId);
            // A booking whose subscription cannot be read has nobody to tell.
            if (!owner) continue;
            const row = {
                tenantId: owner.tenantId,
                subscriptionId: booking.subscriptionId,
                subscriptionBundleId: booking.id,
            };
            if (told.has(booking.subscriptionId)) {
                skipped.push({ ...row, reason: 'already-told' });
                continue;
            }
            const ahead = plansAheadOf(
                owner.subscription,
                retirementsOfItsVersion(
                    toldPlans.get(booking.subscriptionId) ?? [],
                    owner.subscription,
                ),
            );
            const reach = bundleRetirementReach(booking, owner.subscription, now, ahead);
            if (!reach.reached) {
                skipped.push({ ...row, reason: reach.reason });
                continue;
            }
            plansAfter.set(booking.id, reach.plansAfter);
            reached.push({
                ...row,
                planKey: reach.plan.planKey,
                planCycle: reach.plan.billingCycle,
                billingCycle: reach.billingCycle,
                effectiveAt: reach.effectiveAt.toISOString(),
                lastDayToCancel: reach.lastDayToCancel,
                reachedRecently: recently.has(booking.subscriptionId),
            });
        }
        return { reached, skipped, plansAfter };
    }

    /** The bookings on a version by id, and their subscriptions by id. */
    private async bookingsOf(bundleVersionId: string): Promise<BookingsOnVersion> {
        // `onModuleInit` refused a repository and a port without them where
        // retiring is on, and a notice exists only where it was.
        return bookingsOfVersion(this.bookings, this.subscriptions, bundleVersionId);
    }

    /** Whether `version` can be booked at `now`, by the rule a booking follows. */
    private async bookable(version: BundleVersionRow, now: Date): Promise<boolean> {
        const bundle = await this.bundles.findById(version.bundleId);
        return bundleVersionNotBookableReason(version, bundle, now.getTime()) === null;
    }

    private async versionOf(id: string): Promise<BundleVersionRow> {
        const version = await this.bundles.findVersionById(id);
        if (!version) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
                message: `BundleVersion '${id}' not found`,
                params: { bundleVersionId: id },
            });
        }
        return version;
    }

    /**
     * The notice `stored` as it is sent now: the date, the rhythm and the plan
     * of `reach`, with both versions priced for that plan. Where a version
     * cannot be read, the sides recorded with the announcement stand.
     */
    private async retold(
        stored: BundleVersionRetiredNotice,
        reach: Extract<BundleRetirementReach, { reached: true }>,
        versions: Pick<BundleRepository, 'findVersionById'>,
    ): Promise<BundleVersionRetiredNotice> {
        const [retired, replacement] = await Promise.all([
            versions.findVersionById(stored.retired.bundleVersionId),
            versions.findVersionById(stored.replacement.bundleVersionId),
        ]);
        return {
            ...stored,
            ...bundleRetirementSidesFor(stored, reach.plan.planKey, retired, replacement),
            billingCycle: reach.billingCycle,
            effectiveAt: reach.effectiveAt.toISOString(),
            lastDayToCancel: reach.lastDayToCancel,
        };
    }
}

function noticeOf(
    retirementId: string,
    retired: BundleVersionRow,
    replacement: BundleVersionRow,
    row: BundleRetirementReachedRow,
): BundleVersionRetiredNotice {
    const retiredSide = bundleVersionSide(retired, row.planKey);
    const replacementSide = bundleVersionSide(replacement, row.planKey);
    return {
        kind: KIND,
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        subscriptionBundleId: row.subscriptionBundleId,
        retirementId,
        planKey: row.planKey,
        retired: retiredSide,
        replacement: replacementSide,
        changes: bundleVersionChanges(retiredSide, replacementSide),
        billingCycle: row.billingCycle,
        effectiveAt: row.effectiveAt,
        lastDayToCancel: row.lastDayToCancel,
    };
}

/**
 * Where an add-on retirement notice is kept: once per subscription and add-on
 * version retired. A subscription holds one booking of an add-on, so that is
 * once per booking, whichever announcement made it.
 */
function keyOf(notice: BundleVersionRetiredNotice) {
    return {
        tenantId: notice.tenantId,
        subscriptionId: notice.subscriptionId,
        kind: notice.kind,
        subject: notice.retired.bundleVersionId,
    };
}

function refOf(version: BundleVersionRow): RetiredBundleVersionRef {
    return { bundleVersionId: version.id, bundleKey: version.bundleKey, version: version.version };
}

function blocker(code: string, version: BundleVersionRow): RetirementBlocker {
    const params = { bundleKey: version.bundleKey, version: version.version };
    const sentences: Record<string, string> = {
        [BILLING_ERROR_CODES.BUNDLE_RETIREMENT_VERSION_ON_SALE]:
            `Version ${params.version} of ${params.bundleKey} is still on sale. Publish the ` +
            'version that replaces it, and retire this one once its sale has ended, so nobody ' +
            'books it after the announcement.',
        [BILLING_ERROR_CODES.BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE]:
            `Version ${params.version} of ${params.bundleKey} is not on sale, so bookings ` +
            'cannot continue on it.',
        [BILLING_ERROR_CODES.BUNDLE_RETIREMENT_NOTHING_AFFECTED]:
            `No running booking is on version ${params.version} of ${params.bundleKey}, so ` +
            'there is nobody to tell.',
    };
    return { code, message: sentences[code] ?? code, params };
}
