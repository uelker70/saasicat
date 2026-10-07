// A feature withdrawn for a reason outside the platform: an external service it
// depends on stopped, or a law took it away or changed it.
//
// The operator names the feature, the reason, the date — at once or later —
// and the reduction for each plan and add-on in each rhythm it reaches, after
// a preview of every subscription it reaches. From the date the feature is
// granted to nobody (`EntitlementService`), and every subscription holding it
// when it is announced is told at once. The withdrawal and what it means for
// each subscription are written in one transaction, before anybody is told, so
// the reduction and the right to end at once exist exactly when the
// withdrawal does. The operator lifts it at a date once the feature is back.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    type AdminActor,
    type BundleRepository,
    type BundleVersionRow,
    type FeatureWithdrawalAnnounced,
    type FeatureWithdrawalBlocker,
    type FeatureWithdrawalLifted,
    type FeatureWithdrawalLiftedNotice,
    type FeatureWithdrawalPreview,
    type FeatureWithdrawalRecord,
    type FeatureWithdrawalReduction,
    type FeatureWithdrawalRepository,
    type FeatureWithdrawalView,
    type EndedAtOnceNotice,
    type FeatureWithdrawnNotice,
    type PlanCatalog,
    type PlanRepository,
    type PlanVersionRow,
    type RlsBypassPort,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
    type SubscriptionContractRecord,
    type SubscriptionNotice,
    type SubscriptionNoticeKind,
    type SubscriptionNoticePort,
    type SubscriptionNoticeRecord,
    type SubscriptionNoticeRepository,
    type SubscriptionUsagePort,
    type TenantSubscriptionUsage,
    type TransactionRunner,
    type WithdrawnFeature,
    featureWithdrawalRowOf,
    withdrawnFeaturesOf,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { BUNDLE_REPOSITORY_TOKEN, PLAN_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { actorTagOf } from '../core/web-audit.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { SubscriptionContractService } from '../subscription-contract/subscription-contract.service.js';
import { ownersOf } from './bundle-bookings-of-version.js';
import {
    targetKeyOf,
    withdrawalReachOf,
    withdrawalTargetsOf,
    type WithdrawalCandidate,
    type WithdrawalReachInputs,
} from './feature-withdrawal-reach.js';
import {
    NOTICE_CLAIM_LEASE_MS,
    NOTICE_DELIVERY_TIMEOUT_MS,
    NoticeSender,
} from './notice-sender.js';
import { PLAN_CATALOG_SOURCE_TOKEN } from './plan-catalog.module.js';
import type { PlanCatalogSource } from './plan-catalog-source.js';
import { reachedSomebody } from './retirement-notices.js';
import { sameSet } from './retirement-progress.js';
import { FeatureWithdrawalContractService } from './feature-withdrawal-contract.service.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import {
    FEATURE_WITHDRAWAL_REPOSITORY_TOKEN,
    FEATURE_WITHDRAWAL_TRANSACTION_RUNNER_TOKEN,
    SUBSCRIPTION_NOTICE_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
} from './tenant-billing.tokens.js';

/** What the operator announces. */
export interface FeatureWithdrawalAnnouncement {
    readonly featureKey: string;
    readonly reason: string;
    /** From when; null for the moment it is announced. */
    readonly effectiveFrom: Date | null;
    readonly reductions: readonly FeatureWithdrawalReduction[];
    /** The subscriptions the preview showed the operator. */
    readonly subscriptionIds: readonly string[];
}

/** What one catch-up run did. */
export interface FeatureWithdrawalNoticeRun {
    readonly told: number;
    readonly failed: number;
}

const WITHDRAWN: SubscriptionNoticeKind = 'feature-withdrawn';
const LIFTED: SubscriptionNoticeKind = 'feature-withdrawal-lifted';
const ENDED_AT_ONCE: SubscriptionNoticeKind = 'ended-at-once';

/** How many subscriptions one read by id asks for. */
const IDS_PER_READ = 1000;

@Injectable()
export class FeatureWithdrawalService {
    private readonly logger = new Logger(FeatureWithdrawalService.name);
    private readonly sender: NoticeSender;

    /**
     * Whether everything a withdrawal reaches can be found: every subscription
     * bound to a version that grants the feature, every booking of an add-on
     * version that does, and the subscription each booking belongs to. A
     * withdrawal that found nobody would still take the feature from everybody,
     * untold and with nothing in return — so it is offered only where all of it
     * can be read, and silently not otherwise.
     */
    readonly available: boolean;

    constructor(
        @Inject(FEATURE_WITHDRAWAL_REPOSITORY_TOKEN)
        private readonly withdrawals: FeatureWithdrawalRepository,
        @Inject(FEATURE_WITHDRAWAL_TRANSACTION_RUNNER_TOKEN)
        private readonly transactions: TransactionRunner,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_NOTICE_PORT_TOKEN)
        port: SubscriptionNoticePort,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(PLAN_CATALOG_SOURCE_TOKEN) private readonly catalogs: PlanCatalogSource,
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        @Optional()
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository | null = null,
        // Both optional: an installation without add-ons has no booking to reach.
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository | null = null,
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository | null = null,
        // Where contracts are frozen: what the special terms grant is read
        // from the contract in force, which is what the platform grants.
        @Optional()
        @Inject(SubscriptionContractService)
        private readonly contracts: SubscriptionContractService | null = null,
        // The reach is the installation's, not a tenant's: under a row policy
        // it would otherwise find nobody.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
        // Present where contracts are frozen: the reductions go into them.
        @Optional()
        @Inject(FeatureWithdrawalContractService)
        private readonly contractReductions: FeatureWithdrawalContractService | null = null,
    ) {
        // A notice says what happened; nothing waits for it to arrive, so one
        // the application tells nobody of is recorded as sent to no one.
        this.sender = new NoticeSender(notices, port);
        const bookingsReadable =
            !this.bookings || Boolean(this.bookings.listOfVersion && this.bundles);
        // Optional chaining on the usage port too: a module assembled for a
        // test of something else may leave it out, and this is read at start.
        this.available = Boolean(
            this.plans?.listVersions &&
            this.subscriptions?.listBoundToVersion &&
            this.subscriptions?.listByIds &&
            bookingsReadable,
        );
    }

    /**
     * What withdrawing `featureKey` from `effectiveFrom` — null for now — would
     * do if announced at `now`. Everything that would refuse the announcement
     * is reported as a blocker rather than thrown, so the operator sees all of
     * it at once; a feature the catalogue does not know, or a date already
     * past, is refused before anything is read.
     */
    preview(
        featureKey: string,
        effectiveFrom: Date | null,
        now: Date,
    ): Promise<FeatureWithdrawalPreview> {
        return readAcrossTenants(this.rlsBypass, () =>
            this.previewAcrossTenants(featureKey, effectiveFrom, now),
        );
    }

    /**
     * Announces the withdrawal, provided it reaches exactly the subscriptions
     * the operator was shown, and every reduction names a plan or an add-on in
     * a rhythm it reaches at no more than the lowest price it reduces. Every
     * notice is recorded before any is sent; one that cannot be sent now is
     * sent by the next run.
     */
    announce(
        announcement: FeatureWithdrawalAnnouncement,
        actor: AdminActor,
        now: Date,
    ): Promise<FeatureWithdrawalAnnounced> {
        // Across tenants from the first read to the last notice: the
        // transaction opens inside the frame, and every notice it writes
        // belongs to a tenant the operator's request is not scoped to.
        return readAcrossTenants(this.rlsBypass, () =>
            this.announceAcrossTenants(announcement, actor, now),
        );
    }

    /**
     * Lifts the withdrawal `id` from `liftedFrom` — null for now — and tells
     * every subscription it reached that has not ended. From then the feature
     * is granted again, and the reduction and the right to end at once end.
     */
    lift(
        id: string,
        liftedFrom: Date | null,
        actor: AdminActor,
        now: Date,
    ): Promise<FeatureWithdrawalLifted> {
        return readAcrossTenants(this.rlsBypass, () =>
            this.liftAcrossTenants(id, liftedFrom, actor, now),
        );
    }

    /**
     * Every withdrawal, the most recently announced first, with how many
     * subscriptions it reached, how many of them were told, and how many
     * subscriptions and bookings ended at once under it.
     */
    list(): Promise<FeatureWithdrawalView[]> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const [withdrawals, catalog, reached, ended] = await Promise.all([
                this.withdrawals.list(),
                this.catalogs.current(),
                this.notices.listOfKindSince(WITHDRAWN, new Date(0)),
                this.notices.listOfKindSince(ENDED_AT_ONCE, new Date(0)),
            ]);
            const happened = await this.endsThatHappened(ended);
            return withdrawals.map((withdrawal) => {
                const told = reached.filter((record) => record.subject === withdrawal.id);
                return {
                    ...featureWithdrawalRowOf(withdrawal),
                    featureLabel: featureLabelOf(catalog, withdrawal.featureKey),
                    progress: {
                        reached: told.length,
                        told: told.filter(reachedSomebody).length,
                        endedAtOnce: happened.filter(
                            (notice) => notice.withdrawalId === withdrawal.id,
                        ).length,
                    },
                };
            });
        });
    }

    /**
     * The features withdrawn at `now` or from a date ahead, and not lifted by
     * then: what a catalogue marks beside every plan and add-on that grants
     * them, so whoever concludes is shown it first.
     */
    async withdrawnFeatures(now: Date): Promise<WithdrawnFeature[]> {
        return withdrawnFeaturesOf(await this.withdrawals.list(), now);
    }

    /** One withdrawal, or null where none has that id. */
    find(id: string): Promise<FeatureWithdrawalRecord | null> {
        return this.withdrawals.findById(id);
    }

    /**
     * Sends every notice of a withdrawal — announced, lifted, ended at once —
     * that is recorded and has gone out to nobody yet. Each says what happened
     * when it happened, and is sent as it was recorded.
     */
    async sendUndelivered(now: Date): Promise<FeatureWithdrawalNoticeRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            let told = 0;
            let failed = 0;
            const staleBefore = new Date(now.getTime() - NOTICE_CLAIM_LEASE_MS);
            for (const kind of [WITHDRAWN, LIFTED, ENDED_AT_ONCE]) {
                const undelivered = await this.notices.listUndelivered(kind, staleBefore);
                // An end at once is told only where it happened: an attempt
                // that failed after recording it left a record of nothing.
                const due =
                    kind === ENDED_AT_ONCE
                        ? await this.recordsOfEndsThatHappened(undelivered)
                        : undelivered;
                for (const record of due) {
                    const outcome = await this.sender.tell(
                        record.content as SubscriptionNotice,
                        record.subject,
                        NOTICE_DELIVERY_TIMEOUT_MS,
                    );
                    if (outcome === 'told') told += 1;
                    if (outcome === 'failed') failed += 1;
                }
            }
            return { told, failed };
        });
    }

    /**
     * Of `records`, the ends at once that happened: the subscription or the
     * booking records the end at the moment the notice names. An attempt that
     * failed after recording its notice ended nothing.
     */
    private async recordsOfEndsThatHappened(
        records: readonly SubscriptionNoticeRecord[],
    ): Promise<SubscriptionNoticeRecord[]> {
        const notices = records.map((record) => record.content as EndedAtOnceNotice);
        const subscriptionIds = [
            ...new Set(
                notices
                    .filter((notice) => notice.subscriptionBundleId === null)
                    .map((notice) => notice.subscriptionId),
            ),
        ];
        const subscriptionEnds = new Map(
            subscriptionIds.length > 0 && this.subscriptions.listByIds
                ? (await this.subscriptions.listByIds(subscriptionIds)).map((owner) => [
                      owner.subscription.id,
                      (
                          owner.subscription.canceledEffectiveAt ?? owner.subscription.canceledAt
                      )?.getTime() ?? null,
                  ])
                : [],
        );
        const kept: SubscriptionNoticeRecord[] = [];
        for (const [index, notice] of notices.entries()) {
            const at = Date.parse(notice.endedAt);
            const endsAt =
                notice.subscriptionBundleId === null
                    ? subscriptionEnds.get(notice.subscriptionId)
                    : ((
                          await this.bookings?.findById(notice.subscriptionBundleId)
                      )?.canceledEffectiveAt?.getTime() ?? null);
            if (endsAt === at) kept.push(records[index]!);
        }
        return kept;
    }

    /** The ends at once of `records` that happened, as their notices. */
    private async endsThatHappened(
        records: readonly SubscriptionNoticeRecord[],
    ): Promise<EndedAtOnceNotice[]> {
        return (await this.recordsOfEndsThatHappened(records)).map(
            (record) => record.content as EndedAtOnceNotice,
        );
    }

    /** Tells one notice now, and says whether it went out. */
    async tell(notice: SubscriptionNotice, subject: string): Promise<boolean> {
        return (await this.sender.tell(notice, subject, NOTICE_DELIVERY_TIMEOUT_MS)) === 'told';
    }

    // ── announcing ───────────────────────────────────────────────────────

    private async previewAcrossTenants(
        featureKey: string,
        requestedFrom: Date | null,
        now: Date,
    ): Promise<FeatureWithdrawalPreview> {
        this.assertAvailable();
        const catalog = await this.catalogs.current();
        if (!(catalog.features ?? []).some((feature) => feature.key === featureKey)) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_FEATURE_UNKNOWN,
                message: `The catalogue knows no feature ${featureKey}.`,
                params: { featureKey },
            });
        }
        const effectiveFrom = requestedFrom ?? now;
        if (effectiveFrom < now) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_DATE_IN_PAST,
                message:
                    'A feature is withdrawn from now on or from a later date, never from a date ' +
                    'already past.',
                params: {},
            });
        }
        const reach = await this.reachOf(featureKey, effectiveFrom, catalog, now);
        return {
            feature: { key: featureKey, label: featureLabelOf(catalog, featureKey) },
            effectiveFrom: effectiveFrom.toISOString(),
            asOf: now.toISOString(),
            reached: reach.reached,
            skipped: reach.skipped,
            targets: withdrawalTargetsOf(reach.reached),
            blockers: await this.blockersOf(featureKey, effectiveFrom),
        };
    }

    private async announceAcrossTenants(
        announcement: FeatureWithdrawalAnnouncement,
        actor: AdminActor,
        now: Date,
    ): Promise<FeatureWithdrawalAnnounced> {
        const preview = await this.previewAcrossTenants(
            announcement.featureKey,
            announcement.effectiveFrom,
            now,
        );
        const [first] = preview.blockers;
        if (first) {
            throw new UnprocessableEntityException({ ...first, blockers: preview.blockers });
        }
        assertReductionsFit(announcement.reductions, preview);
        if (
            !sameSet(
                preview.reached.map((row) => row.subscriptionId),
                announcement.subscriptionIds,
            )
        ) {
            throw new ConflictException({
                code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_PREVIEW_CHANGED,
                message:
                    'The subscriptions this withdrawal reaches changed since they were shown. ' +
                    'Look at them again before announcing it.',
                params: {},
                preview,
            });
        }

        const reductions = announcement.reductions.map((reduction) => ({ ...reduction }));
        const withdrawal = await this.transactions.run(async (tx) => {
            const created = await this.withdrawals.create(
                {
                    featureKey: announcement.featureKey,
                    reason: announcement.reason,
                    effectiveFrom: new Date(preview.effectiveFrom),
                    reductions,
                    announcedAt: now,
                    announcedBy: actorTagOf(actor),
                },
                tx,
            );
            // The database holds a feature to one withdrawal not lifted: one
            // announced beside this one, after the blockers were read, landed
            // first. Nothing of this one is kept.
            if (!created) throw openWithdrawal(announcement.featureKey);
            await this.notices.record(
                preview.reached.map((row) => {
                    const notice = withdrawnNoticeOf(created, preview, row);
                    return { ...keyOf(notice), content: notice };
                }),
                now,
                tx,
            );
            return created;
        });
        // From here on the withdrawal is announced, whatever fails: what is
        // left is reported, not thrown, so the operator is not told it failed
        // when it did not.
        this.entitlements.invalidateAll();
        await this.record(actor, 'FEATURE_WITHDRAW', withdrawal, {
            featureKey: withdrawal.featureKey,
            effectiveFrom: withdrawal.effectiveFrom.toISOString(),
            reductions: withdrawal.reductions,
            subscriptions: preview.reached.length,
        });
        await this.recordReductions(withdrawal, preview, now);
        let told = 0;
        let failed = 0;
        for (const row of preview.reached) {
            const notice = withdrawnNoticeOf(withdrawal, preview, row);
            const outcome = await this.sender.tell(
                notice,
                withdrawal.id,
                NOTICE_DELIVERY_TIMEOUT_MS,
            );
            if (outcome === 'told') told += 1;
            if (outcome === 'failed') failed += 1;
        }
        return { withdrawal: featureWithdrawalRowOf(withdrawal), told, failed };
    }

    /**
     * Writes the reductions into the contract in force of each subscription
     * reached with one. A contract that cannot be written now is written by the
     * journal before it next charges, so a failure here is logged, not thrown:
     * the withdrawal is announced.
     */
    private async recordReductions(
        withdrawal: FeatureWithdrawalRecord,
        preview: FeatureWithdrawalPreview,
        now: Date,
    ): Promise<void> {
        if (!this.contractReductions) return;
        const reduced = new Set(
            withdrawal.reductions.map((reduction) =>
                targetKeyOf(reduction.kind, reduction.key, reduction.billingCycle),
            ),
        );
        for (const row of preview.reached) {
            const reducesALine = row.lines.some((line) =>
                reduced.has(targetKeyOf(line.line, line.key, line.billingCycle)),
            );
            if (!reducesALine) continue;
            try {
                await this.contractReductions.recordReductions(row.tenantId, now);
            } catch (error) {
                this.logger.error(
                    `Feature withdrawal ${withdrawal.id} is announced, but writing its reductions ` +
                        `into the contract of tenant ${row.tenantId} failed; the journal writes ` +
                        'them before it next charges.',
                    error instanceof Error ? error.stack : String(error),
                );
            }
        }
    }

    /**
     * Who holds the feature at `effectiveFrom`: the subscriptions bound to a
     * plan version that grants it, the bookings of an add-on version that
     * grants it, and the tenants whose contract in force grants it — which is
     * where special terms are recorded.
     */
    private async reachOf(
        featureKey: string,
        effectiveFrom: Date,
        catalog: PlanCatalog,
        now: Date,
    ): Promise<Pick<FeatureWithdrawalPreview, 'reached' | 'skipped'>> {
        const grants = (features: readonly string[]) =>
            this.entitlements.withReplacements(new Set(features)).has(featureKey);
        const planVersions = await this.planVersionsGranting(grants);
        const bundleVersions = await this.bundleVersionsGranting(grants);
        const inputs: WithdrawalReachInputs = {
            effectiveFrom,
            grants,
            planVersions,
            planLabels: new Map(
                (catalog.plans ?? []).map((plan) => [plan.id, plan.name ?? plan.id]),
            ),
            bundleVersions,
        };

        const candidates = new Map<string, WithdrawalCandidate>();
        const contracts = await this.contractsInForce(now);
        const add = (owner: TenantSubscriptionUsage, booking?: SubscriptionBundleRecord) => {
            const known = candidates.get(owner.subscription.id);
            candidates.set(owner.subscription.id, {
                tenantId: owner.tenantId,
                subscription: owner.subscription,
                contract: contracts.get(owner.tenantId) ?? null,
                bookings: [...(known?.bookings ?? []), ...(booking ? [booking] : [])],
            });
        };
        for (const versionId of planVersions.keys()) {
            // `available` asked for it before anything is read.
            for (const owner of await this.subscriptions.listBoundToVersion!(versionId)) {
                if (!candidates.has(owner.subscription.id)) add(owner);
            }
        }
        for (const versionId of bundleVersions.keys()) {
            const booked = await this.bookings!.listOfVersion!(versionId);
            const owners = await ownersOf(this.subscriptions, booked);
            for (const booking of booked) {
                const owner = owners.get(booking.subscriptionId);
                if (owner) add(owner, booking);
            }
        }
        const known = new Set([...candidates.values()].map((candidate) => candidate.tenantId));
        for (const [tenantId, contract] of contracts) {
            if (known.has(tenantId) || !grants(contract.entitlementSnapshot?.features ?? [])) {
                continue;
            }
            const subscription = await this.subscriptions.findForTenant(tenantId);
            if (subscription?.id) {
                add({ tenantId, subscription: { ...subscription, id: subscription.id } });
            }
        }

        const reached: FeatureWithdrawalPreview['reached'][number][] = [];
        const skipped: FeatureWithdrawalPreview['skipped'][number][] = [];
        for (const candidate of candidates.values()) {
            const reach = withdrawalReachOf(candidate, inputs);
            if (!reach) continue;
            if ('endsBefore' in reach) {
                skipped.push({
                    tenantId: candidate.tenantId,
                    subscriptionId: candidate.subscription.id,
                    reason: 'ends-before',
                });
                continue;
            }
            reached.push(reach.reached);
        }
        const bySubscription = (a: { subscriptionId: string }, b: { subscriptionId: string }) =>
            a.subscriptionId.localeCompare(b.subscriptionId);
        return { reached: reached.sort(bySubscription), skipped: skipped.sort(bySubscription) };
    }

    /** Every published version of every plan that grants the feature, by id. */
    private async planVersionsGranting(
        grants: (features: readonly string[]) => boolean,
    ): Promise<Map<string, PlanVersionRow>> {
        const versions = new Map<string, PlanVersionRow>();
        // `available` asked for both before anything is read.
        for (const plan of await this.plans!.list({ excludeDeleted: false })) {
            for (const version of await this.plans!.listVersions!(plan.planKey)) {
                if (version.publishedAt && grants(version.features)) {
                    versions.set(version.id, version);
                }
            }
        }
        return versions;
    }

    /** Every published version of every add-on that grants the feature, by id. */
    private async bundleVersionsGranting(
        grants: (features: readonly string[]) => boolean,
    ): Promise<Map<string, BundleVersionRow>> {
        const versions = new Map<string, BundleVersionRow>();
        if (!this.bookings || !this.bundles) return versions;
        for (const bundle of await this.bundles.list({ excludeDeleted: false })) {
            for (const version of await this.bundles.listVersions(bundle.id)) {
                if (version.publishedAt && grants(version.features)) {
                    versions.set(version.id, version);
                }
            }
        }
        return versions;
    }

    /** The contract in force at `now` of each tenant that has one. */
    private async contractsInForce(now: Date): Promise<Map<string, SubscriptionContractRecord>> {
        const inForce = new Map<string, SubscriptionContractRecord>();
        if (!this.contracts) return inForce;
        for (const contract of await this.contracts.list({ asOf: now })) {
            const runs =
                contract.status !== 'scheduled' &&
                contract.effectiveFrom <= now &&
                (contract.effectiveUntil === null || now < contract.effectiveUntil);
            const known = inForce.get(contract.tenantId);
            if (runs && (!known || known.effectiveFrom < contract.effectiveFrom)) {
                inForce.set(contract.tenantId, contract);
            }
        }
        return inForce;
    }

    /**
     * What stands in the way of withdrawing the feature from `effectiveFrom`:
     * a withdrawal of it not lifted, or one lifted only from a later date.
     */
    private async blockersOf(
        featureKey: string,
        effectiveFrom: Date,
    ): Promise<FeatureWithdrawalBlocker[]> {
        const ofFeature = (await this.withdrawals.list()).filter(
            (withdrawal) => withdrawal.featureKey === featureKey,
        );
        if (ofFeature.some((withdrawal) => withdrawal.liftedFrom === null)) {
            const refusal = openWithdrawal(featureKey).getResponse() as FeatureWithdrawalBlocker;
            return [refusal];
        }
        const overlapping = ofFeature
            .filter(
                (withdrawal) =>
                    withdrawal.liftedFrom !== null &&
                    withdrawal.liftedFrom > effectiveFrom &&
                    withdrawal.effectiveFrom < withdrawal.liftedFrom,
            )
            .map((withdrawal) => withdrawal.liftedFrom!.getTime());
        if (overlapping.length === 0) return [];
        const date = new Date(Math.max(...overlapping)).toISOString().slice(0, 10);
        return [
            {
                code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_OVERLAPS,
                message: `${featureKey} is withdrawn until ${date}. Another withdrawal can begin on that date at the earliest.`,
                params: { featureKey, date },
            },
        ];
    }

    // ── lifting ──────────────────────────────────────────────────────────

    private async liftAcrossTenants(
        id: string,
        requestedFrom: Date | null,
        actor: AdminActor,
        now: Date,
    ): Promise<FeatureWithdrawalLifted> {
        this.assertAvailable();
        const found = await this.withdrawals.findById(id);
        if (!found) throw withdrawalNotFound(id);
        if (found.liftedFrom) throw alreadyLifted(found.liftedFrom);
        const liftedFrom = requestedFrom ?? now;
        if (liftedFrom < now) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_LIFT_IN_PAST,
                message:
                    'A withdrawal is lifted from now on or from a later date, never from a date ' +
                    'already past.',
                params: {},
            });
        }
        const catalog = await this.catalogs.current();
        const reached = (await this.notices.listOfKindSince(WITHDRAWN, new Date(0))).filter(
            (record) => record.subject === id,
        );
        const running = await this.stillRunning(
            reached.map((record) => record.subscriptionId),
            now,
        );
        const toTell = reached.filter((record) => running.has(record.subscriptionId));
        const noticeOf = (record: (typeof reached)[number]): FeatureWithdrawalLiftedNotice => ({
            kind: 'feature-withdrawal-lifted',
            tenantId: record.tenantId,
            subscriptionId: record.subscriptionId,
            withdrawalId: id,
            featureKey: found.featureKey,
            featureLabel: featureLabelOf(catalog, found.featureKey),
            liftedFrom: liftedFrom.toISOString(),
        });

        const lifted = await this.transactions.run(async (tx) => {
            const written = await this.withdrawals.lift(
                id,
                { liftedFrom, liftedAt: now, liftedBy: actorTagOf(actor) },
                tx,
            );
            // Lifted meanwhile by another operator: what they recorded stands.
            if (!written) {
                const current = await this.withdrawals.findById(id);
                throw current?.liftedFrom
                    ? alreadyLifted(current.liftedFrom)
                    : withdrawalNotFound(id);
            }
            await this.notices.record(
                toTell.map((record) => ({
                    tenantId: record.tenantId,
                    subscriptionId: record.subscriptionId,
                    kind: LIFTED,
                    subject: id,
                    content: noticeOf(record),
                })),
                now,
                tx,
            );
            return written;
        });
        this.entitlements.invalidateAll();
        await this.record(actor, 'FEATURE_WITHDRAWAL_LIFT', lifted, {
            featureKey: lifted.featureKey,
            liftedFrom: liftedFrom.toISOString(),
            subscriptions: toTell.length,
        });
        let told = 0;
        let failed = 0;
        for (const record of toTell) {
            const outcome = await this.sender.tell(
                noticeOf(record),
                id,
                NOTICE_DELIVERY_TIMEOUT_MS,
            );
            if (outcome === 'told') told += 1;
            if (outcome === 'failed') failed += 1;
        }
        return { withdrawal: featureWithdrawalRowOf(lifted), told, failed };
    }

    /** Of `subscriptionIds`, the ones whose subscription has not ended at `now`. */
    private async stillRunning(
        subscriptionIds: readonly string[],
        now: Date,
    ): Promise<Set<string>> {
        const running = new Set<string>();
        const ids = [...new Set(subscriptionIds)];
        for (let start = 0; start < ids.length; start += IDS_PER_READ) {
            // `available` asked for it before anything is read.
            for (const owner of await this.subscriptions.listByIds!(
                ids.slice(start, start + IDS_PER_READ),
            )) {
                if (!cancellationHasLanded(owner.subscription, now)) {
                    running.add(owner.subscription.id);
                }
            }
        }
        return running;
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /** Refuses where not everything a withdrawal reaches can be found (`available`). */
    private assertAvailable(): void {
        if (this.available) return;
        throw new NotFoundException({
            code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_UNAVAILABLE,
            message:
                'Withdrawing a feature is not offered here: the subscription and booking stores ' +
                'cannot list everybody a withdrawal reaches (listBoundToVersion, listByIds, ' +
                'listOfVersion, PlanRepository.listVersions).',
            params: {},
        });
    }

    /** Best effort: the withdrawal stands whether or not its record could be written (`SC-AUD-004`). */
    private async record(
        actor: AdminActor,
        action: 'FEATURE_WITHDRAW' | 'FEATURE_WITHDRAWAL_LIFT',
        withdrawal: FeatureWithdrawalRecord,
        changes: Record<string, unknown>,
    ): Promise<void> {
        if (!this.audit) return;
        try {
            await this.audit.log({
                actor,
                entity: 'FeatureWithdrawal',
                entityId: withdrawal.id,
                action,
                changes,
            });
        } catch (error) {
            // The withdrawal row names who acted and when; the audit entry is
            // the second record of it, and its loss is said loudly.
            this.logger.error(
                `Feature withdrawal ${withdrawal.id} is recorded, but writing its audit entry failed.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}

/** The feature's name as the catalogue gives it, or its key. */
export function featureLabelOf(catalog: PlanCatalog, featureKey: string): string {
    return catalog.features?.find((feature) => feature.key === featureKey)?.label ?? featureKey;
}

/**
 * Refuses reductions that name a plan or an add-on in a rhythm the withdrawal
 * does not reach, that are named twice, or that are more than the lowest
 * price among the lines they reduce: a price is reduced to nothing at most.
 */
function assertReductionsFit(
    reductions: readonly FeatureWithdrawalReduction[],
    preview: FeatureWithdrawalPreview,
): void {
    const targets = new Map(
        preview.targets.map((target) => [
            targetKeyOf(target.kind, target.key, target.billingCycle),
            target,
        ]),
    );
    const seen = new Set<string>();
    for (const reduction of reductions) {
        const key = targetKeyOf(reduction.kind, reduction.key, reduction.billingCycle);
        if (seen.has(key)) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_REDUCTION_NAMED_TWICE,
                message: `The reduction for ${reduction.key} billed ${reduction.billingCycle} is named twice.`,
                params: {
                    kind: reduction.kind,
                    key: reduction.key,
                    billingCycle: reduction.billingCycle,
                },
            });
        }
        seen.add(key);
        const target = targets.get(key);
        if (!target) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_REDUCTION_NOT_REACHED,
                message: `The reduction for ${reduction.key} billed ${reduction.billingCycle} names nothing this withdrawal reaches.`,
                params: {
                    kind: reduction.kind,
                    key: reduction.key,
                    billingCycle: reduction.billingCycle,
                },
            });
        }
        if (target.lowestPriceNet !== null && reduction.amountNet > target.lowestPriceNet) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_REDUCTION_EXCEEDS_PRICE,
                message: `The reduction for ${reduction.key} billed ${reduction.billingCycle} is more than the lowest price it reduces, ${target.lowestPriceNet}.`,
                params: {
                    key: reduction.key,
                    billingCycle: reduction.billingCycle,
                    price: target.lowestPriceNet,
                },
            });
        }
    }
}

/** What the subscription of `row` is told: each line reached, with what it is reduced by. */
function withdrawnNoticeOf(
    withdrawal: FeatureWithdrawalRecord,
    preview: FeatureWithdrawalPreview,
    row: FeatureWithdrawalPreview['reached'][number],
): FeatureWithdrawnNotice {
    const amounts = new Map(
        withdrawal.reductions.map((reduction) => [
            targetKeyOf(reduction.kind, reduction.key, reduction.billingCycle),
            reduction.amountNet,
        ]),
    );
    return {
        kind: 'feature-withdrawn',
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        withdrawalId: withdrawal.id,
        featureKey: withdrawal.featureKey,
        featureLabel: preview.feature.label,
        reason: withdrawal.reason,
        effectiveFrom: withdrawal.effectiveFrom.toISOString(),
        lines: row.lines.map(({ priceNet: _price, ...line }) => ({
            ...line,
            reductionNet: amounts.get(targetKeyOf(line.line, line.key, line.billingCycle)) ?? null,
        })),
        specialTerms: row.specialTerms,
    };
}

/** A subscription is told of a withdrawal once. */
function keyOf(notice: FeatureWithdrawnNotice) {
    return {
        tenantId: notice.tenantId,
        subscriptionId: notice.subscriptionId,
        kind: notice.kind,
        subject: notice.withdrawalId,
    };
}

function openWithdrawal(featureKey: string): ConflictException {
    return new ConflictException({
        code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_OPEN,
        message: `${featureKey} is withdrawn already, and that withdrawal is not lifted. Lift it before announcing another.`,
        params: { featureKey },
    });
}

function withdrawalNotFound(withdrawalId: string): NotFoundException {
    return new NotFoundException({
        code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_NOT_FOUND,
        message: `Feature withdrawal ${withdrawalId} not found.`,
        params: { withdrawalId },
    });
}

function alreadyLifted(liftedFrom: Date): ConflictException {
    const date = liftedFrom.toISOString().slice(0, 10);
    return new ConflictException({
        code: BILLING_ERROR_CODES.FEATURE_WITHDRAWAL_ALREADY_LIFTED,
        message: `This withdrawal is lifted already, from ${date}.`,
        params: { date },
    });
}
