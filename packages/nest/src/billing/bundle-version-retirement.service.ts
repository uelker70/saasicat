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
    classifyBundleVersionDiff,
    type AdminActor,
    type BillingCycle,
    type BundleRepository,
    type BundleRetirementAnnounced,
    type BundleRetirementPreview,
    type BundleRetirementReachedRow,
    type BundleRetirementSide,
    type BundleRetirementSkippedRow,
    type BundleVersionRetiredNotice,
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
    type SubscriptionNoticeRepository,
    type SubscriptionUsagePort,
    type TenantSubscriptionUsage,
    type TransactionRunner,
    type VersionChange,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { bundleVersionNotBookableReason } from '../checkout-offer/bundle-version-bookable.js';
import { actorTagOf } from '../core/web-audit.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import { addOnMisfits } from './add-on-fits-plan.js';
import { resolveBundlePriceNet } from './bundle-price.js';
import { bundleRetirementReach, type BundleRetirementReach } from './bundle-retirement-reach.js';
import {
    NOTICE_CLAIM_LEASE_MS,
    NOTICE_DELIVERY_TIMEOUT_MS,
    NoticeSender,
} from './notice-sender.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import { reachedSomebody, subscriptionsReachedSince } from './retirement-notices.js';
import { progressOf, sameSet, type ReachedState } from './retirement-progress.js';
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

/** How many subscriptions one read asks for. */
const IDS_PER_READ = 1000;

/** The bookings on one add-on version by id, and their subscriptions by id. */
interface BookingsOnVersion {
    readonly bookings: Map<string, SubscriptionBundleRecord>;
    readonly owners: Map<string, TenantSubscriptionUsage>;
}

/** The preview, with the two versions it was computed from. */
interface ComputedPreview {
    readonly preview: BundleRetirementPreview;
    readonly retired: BundleVersionRow;
    readonly replacement: BundleVersionRow;
}

@Injectable()
export class BundleVersionRetirementService implements OnModuleInit {
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
                    const booking = bookings.get(stored.subscriptionBundleId);
                    const owner = owners.get(stored.subscriptionId);
                    const reach =
                        booking && owner
                            ? bundleRetirementReach(booking, owner.subscription, sendingAt())
                            : null;
                    if (!reach?.reached) continue;
                    const notice = await this.retold(stored, reach, versions);
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
     * only once they were (`SC-BUN-043`). Until then the booking may be
     * cancelled without its minimum term (`SC-BUN-045`).
     */
    async pendingForBooking(
        subscriptionId: string,
        subscriptionBundleId: string,
        now: Date,
    ): Promise<BundleVersionRetiredNotice | null> {
        const told = await this.toldForSubscription(subscriptionId);
        return (
            told.find(
                (notice) =>
                    notice.subscriptionBundleId === subscriptionBundleId &&
                    new Date(notice.effectiveAt) > now,
            ) ?? null
        );
    }

    /**
     * Why the booking `subscriptionBundleId` may not be reinstated, or null.
     * A booking on a version being retired that the announcement did not
     * reach — cancelled to end before it would move — was never told, and
     * nothing moves it; reinstated, it would run on past the date on a version
     * nobody sells. A booking that was reached keeps its notice, and moves.
     */
    async refusalToReinstate(
        subscriptionId: string,
        subscriptionBundleId: string,
    ): Promise<RetirementBlocker | null> {
        const booking = await this.bookings.findById(subscriptionBundleId);
        // The booking service answers for a booking that is missing or not this
        // subscription's.
        if (!booking || booking.subscriptionId !== subscriptionId) return null;
        const retirement = (await this.retirements.list()).find(
            (announced) => announced.retired.bundleVersionId === booking.bundleVersionId,
        );
        if (!retirement) return null;
        const reached = (await this.notices.listForSubscription(subscriptionId)).some(
            (record) => record.kind === KIND && record.subject === booking.bundleVersionId,
        );
        if (reached) return null;
        const { retired, replacement } = retirement;
        return {
            code: BILLING_ERROR_CODES.BUNDLE_RETIREMENT_REINSTATE_REFUSED,
            message:
                `Version ${retired.version} of ${retired.bundleKey} is being retired, and this ` +
                `booking ends before it would move. Book version ${replacement.version} instead.`,
            params: {
                bundleKey: retired.bundleKey,
                version: retired.version,
                replacementVersion: replacement.version,
            },
        };
    }

    /** Every add-on retirement the subscription was told of, the most recent first. */
    async toldForSubscription(subscriptionId: string): Promise<BundleVersionRetiredNotice[]> {
        return (await this.notices.listForSubscription(subscriptionId))
            .filter((record) => record.kind === KIND && reachedSomebody(record))
            .map((record) => record.content as BundleVersionRetiredNotice);
    }

    /**
     * Every add-on announcement, the most recent first, with how far it has
     * come over the bookings it reached (`SC-BUN-047`).
     */
    async list(now = new Date()): Promise<BundleVersionRetirementView[]> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const [retirements, records] = await Promise.all([
                this.retirements.list(),
                this.notices.listOfKindSince(KIND, new Date(0)),
            ]);
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
                    const { bookings, owners } = await onVersion(
                        retirement.retired.bundleVersionId,
                    );
                    const states = onRecord
                        .filter(({ notice }) => notice.retirementId === retirement.id)
                        .map(({ notice, told }) => bookingState(notice, told, bookings, owners));
                    return { ...retirement, progress: { ...progressOf(states, now), reminded: 0 } };
                }),
            );
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
        const retiredSide = sideOf(retired, null);
        const replacementSide = sideOf(replacement, null);

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

        const { reached, skipped } = await this.reachOf(retired.id, now);
        if (reached.length === 0) {
            blockers.push(blocker(BILLING_ERROR_CODES.BUNDLE_RETIREMENT_NOTHING_AFFECTED, retired));
        }
        // Continuing on a version means running beside the plan the
        // subscription is on at the date, in the rhythm both are billed in
        // then (`SC-BUN-044`, the rule of `SC-CHG-024`).
        const cannotRun = reached.filter(
            (row) =>
                addOnMisfits(
                    replacement,
                    { planKey: row.planKey, billingCycle: row.planCycle as BillingCycle },
                    row.billingCycle as BillingCycle,
                ).length > 0,
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
                changes: changesBetween(retiredSide, replacementSide),
                asOf: now.toISOString(),
                reached,
                skipped,
                blockers,
            },
            retired,
            replacement,
        };
    }

    /** Which bookings of the version a retirement now reaches, and which it does not. */
    private async reachOf(
        bundleVersionId: string,
        now: Date,
    ): Promise<{ reached: BundleRetirementReachedRow[]; skipped: BundleRetirementSkippedRow[] }> {
        const { bookings, owners } = await this.bookingsOf(bundleVersionId);
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
            const reach = bundleRetirementReach(booking, owner.subscription, now);
            if (!reach.reached) {
                skipped.push({ ...row, reason: reach.reason });
                continue;
            }
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
        return { reached, skipped };
    }

    /** The bookings on a version by id, and their subscriptions by id. */
    private async bookingsOf(bundleVersionId: string): Promise<BookingsOnVersion> {
        // `onModuleInit` refused a repository and a port without them where
        // retiring is on, and a notice exists only where it was.
        const rows = await this.bookings.listOfVersion!(bundleVersionId);
        const ids = [...new Set(rows.map((row) => row.subscriptionId))];
        // In slices: a query binds a bounded number of values, and a version
        // can be booked on more subscriptions than that.
        const owners: TenantSubscriptionUsage[] = [];
        for (let start = 0; start < ids.length; start += IDS_PER_READ) {
            owners.push(
                ...(await this.subscriptions.listByIds!(ids.slice(start, start + IDS_PER_READ))),
            );
        }
        return {
            bookings: new Map(rows.map((row) => [row.id, row])),
            owners: new Map(owners.map((owner) => [owner.subscription.id, owner])),
        };
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
        const planKey = reach.plan.planKey;
        const retiredSide = retired ? sideOf(retired, planKey) : stored.retired;
        const replacementSide = replacement ? sideOf(replacement, planKey) : stored.replacement;
        return {
            ...stored,
            planKey,
            retired: retiredSide,
            replacement: replacementSide,
            changes: changesBetween(retiredSide, replacementSide),
            billingCycle: reach.billingCycle,
            effectiveAt: reach.effectiveAt.toISOString(),
            lastDayToCancel: reach.lastDayToCancel,
        };
    }
}

/**
 * One version as a subscriber compares it, priced beside `planKey` —
 * `pricingOverrides` included — or at its own prices where no plan is named.
 */
function sideOf(version: BundleVersionRow, planKey: string | null): BundleRetirementSide {
    const priced = planKey === null ? { ...version, pricingOverrides: [] } : version;
    return {
        bundleVersionId: version.id,
        bundleKey: version.bundleKey,
        label: version.label,
        version: version.version,
        features: [...version.features],
        quotas: { ...version.quotas },
        monthlyNet: resolveBundlePriceNet(priced, planKey ?? '', 'MONTHLY'),
        yearlyNet: resolveBundlePriceNet(priced, planKey ?? '', 'YEARLY'),
    };
}

/** Every difference, retired to replacement, as the catalogue's diff states it. */
function changesBetween(
    retired: BundleRetirementSide,
    replacement: BundleRetirementSide,
): VersionChange[] {
    const fields = (side: BundleRetirementSide) => ({
        features: [...side.features],
        quotas: { ...side.quotas },
        monthlyNet: side.monthlyNet,
        yearlyNet: side.yearlyNet,
    });
    return classifyBundleVersionDiff(fields(retired), fields(replacement)).changes;
}

function noticeOf(
    retirementId: string,
    retired: BundleVersionRow,
    replacement: BundleVersionRow,
    row: BundleRetirementReachedRow,
): BundleVersionRetiredNotice {
    const retiredSide = sideOf(retired, row.planKey);
    const replacementSide = sideOf(replacement, row.planKey);
    return {
        kind: KIND,
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        subscriptionBundleId: row.subscriptionBundleId,
        retirementId,
        planKey: row.planKey,
        retired: retiredSide,
        replacement: replacementSide,
        changes: changesBetween(retiredSide, replacementSide),
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

/** Where one booking an add-on retirement reached stands now. */
function bookingState(
    notice: BundleVersionRetiredNotice,
    told: boolean,
    stillOn: ReadonlyMap<string, SubscriptionBundleRecord>,
    owners: ReadonlyMap<string, TenantSubscriptionUsage>,
): ReachedState {
    const booking = stillOn.get(notice.subscriptionBundleId);
    const owner = owners.get(notice.subscriptionId);
    const effectiveAt = new Date(notice.effectiveAt);
    const bookingEnds = booking?.canceledEffectiveAt ?? booking?.canceledAt ?? null;
    return {
        stillOn: Boolean(booking),
        endedByTheDate:
            (bookingEnds !== null && bookingEnds <= effectiveAt) ||
            Boolean(owner && cancellationHasLanded(owner.subscription, effectiveAt)),
        told,
        effectiveAt,
    };
}
