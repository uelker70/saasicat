// What the operator reads of a tenant's deletion (`SC-ADM-058`): where it
// stands, on the tenant's page, and every deletion of a subscriber's tenants,
// on the subscriber's record — there also once the application keeps no row
// of the tenant any more, since the record of a deletion is kept with the
// subscriber (`SC-PRIV-023`).
//
// Where a deletion stands is decided by the functions the run decides by
// (`tenantDeletionStatusOf`), from what the run reads: the end that decides
// the tenant's day (`decidingEnds`), the record once begun, the installation's
// mark, the subscriber, and a contract running past the end. Before the day
// the same reasons are the operator's forecast, so a contract is read wherever
// a deletion has not begun.
//
// The record names roles and numbers, never a person: whoever took the
// export by the role they acted in (`actorRoleOf`), and whoever a reminder
// reached by how many there were — also while the deletion is under way and
// the rows it is read from still name people.
//
// Reads across tenants: the caller runs it inside `RlsBypassPort`.

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    actorRoleOf,
    dayInZone,
    deletionReminderSubjectIn,
    installationZoneOf,
    tenantDeletionStatusOf,
    type AdminSubscriberDeletions,
    type AdminTenantDeletion,
    type AdminTenantDeletionFailure,
    type AdminTenantDeletionRecord,
    type AdminTenantDeletionReminder,
    type AdminTenantDeletionStatus,
    type InstallationMarkVerdict,
    type PlanCatalogSettings,
    type SubscriberRepository,
    type SubscriptionContractRepository,
    type SubscriptionEnd,
    type SubscriptionEndAnnouncement,
    type SubscriptionEndPort,
    type SubscriptionNoticeRecord,
    type SubscriptionNoticeRepository,
    type TenantAccessHoldPort,
    type TenantDeletionFailure,
    type TenantDeletionRecord,
    type TenantDeletionRecordPort,
    type TenantDeletionStatus,
    type TenantDeletionStatusInput,
    type TenantExportDownload,
} from '@saasicat/core';

import { contractRunningPast } from '../../subscription-contract/contract-runs-from.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../../subscription-contract/subscription-contract.tokens.js';
import { referencesOf } from '../../tenant-access/hold-references.js';
import { TENANT_ACCESS_HOLDS_TOKEN } from '../../tenant-access/tenant-access.tokens.js';
import { decidingEnds, type DecidingEnd } from '../deciding-end.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import {
    SUBSCRIPTION_END_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    TENANT_DELETION_RECORD_PORT_TOKEN,
    TENANT_DELETION_SUBSCRIBERS_TOKEN,
} from '../tenant-billing.tokens.js';
import { InstallationMarkService } from './installation-mark.service.js';
import { DELETION_CLAIM_LEASE_MS } from './tenant-deletion.service.js';

/** The kind of notice a reminder of a deletion is kept as. */
const REMINDER_KIND = 'deletion-reminder';

/** What the reads of a begun deletion's record found, by subscription. */
interface RecordTrail {
    readonly announcements: readonly SubscriptionEndAnnouncement[];
    readonly downloads: readonly TenantExportDownload[];
}

@Injectable()
export class TenantDeletionReadingService {
    constructor(
        @Inject(TENANT_DELETION_RECORD_PORT_TOKEN)
        private readonly records: Pick<
            TenantDeletionRecordPort,
            'findForTenants' | 'findForSubscriber'
        >,
        @Inject(TENANT_DELETION_SUBSCRIBERS_TOKEN)
        private readonly subscribers: Pick<
            SubscriberRepository,
            'findByTenantId' | 'listTenantLinks'
        >,
        @Inject(SUBSCRIPTION_END_PORT_TOKEN)
        private readonly ends: Pick<
            SubscriptionEndPort,
            'listFor' | 'listAnnouncedFor' | 'listExportDownloadsFor'
        >,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: Pick<SubscriptionNoticeRepository, 'listForSubscription'>,
        @Inject(InstallationMarkService)
        private readonly marks: Pick<InstallationMarkService, 'verdict'>,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<PlanCatalogSettings, 'timeZone'>,
        // Absent only where tenant billing is wired by hand without
        // `SaaSiCatModule`: nothing keeps the reasons then, so no end decides a
        // deletion and only a begun one is read.
        @Optional()
        @Inject(TENANT_ACCESS_HOLDS_TOKEN)
        private readonly holds: Pick<TenantAccessHoldPort, 'listOpenFor'> | null = null,
        // Absent where the installation keeps no contracts.
        @Optional()
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: Pick<SubscriptionContractRepository, 'list'> | null = null,
    ) {}

    /**
     * Where the deletion of `tenantId` stands at `now`, with its record once
     * begun; null where none has begun and no end decides one.
     */
    async ofTenant(tenantId: string, now: Date): Promise<AdminTenantDeletion | null> {
        const [record] = await this.records.findForTenants([tenantId]);
        if (record) {
            const [deletion] = await this.begun([record], await this.marks.verdict(), now);
            return deletion ?? null;
        }
        const deciding = (await this.decidingEndsOf([tenantId])).get(tenantId);
        if (!deciding) return null;
        const hasSubscriber = (await this.subscribers.findByTenantId(tenantId)) !== null;
        return this.toCome(deciding.end, hasSubscriber, await this.marks.verdict(), now);
    }

    /**
     * Every deletion of `subscriberId`'s tenants: the one still to come of its
     * live tenant first, then every begun one, the most recently begun first.
     * A tenant's record stays with the subscriber live for it when it began:
     * no subscriber is joined while a deletion of its tenants is open.
     */
    async ofSubscriber(subscriberId: string, now: Date): Promise<AdminSubscriberDeletions> {
        const records = await this.records.findForSubscriber(subscriberId);
        const begun = new Set(records.map((record) => record.tenantId));
        const live = (await this.subscribers.listTenantLinks(subscriberId))
            .filter((link) => link.unlinkedAt === null && !begun.has(link.tenantId))
            .map((link) => link.tenantId);
        const deciding =
            live.length > 0 ? await this.decidingEndsOf(live) : new Map<string, DecidingEnd>();
        if (records.length === 0 && deciding.size === 0) return { deletions: [] };
        const verdict = await this.marks.verdict();
        const deletions: AdminTenantDeletion[] = [];
        // The subscriber is live for each of these tenants: its link says so.
        for (const { end } of deciding.values()) {
            deletions.push(await this.toCome(end, true, verdict, now));
        }
        deletions.push(...(await this.begun(records, verdict, now)));
        return { deletions };
    }

    /** By tenant, the end that decides its deletion, as the run finds it. */
    private async decidingEndsOf(tenantIds: readonly string[]): Promise<Map<string, DecidingEnd>> {
        if (!this.holds) return new Map();
        const open = await this.holds.listOpenFor(tenantIds);
        return decidingEnds(open, await this.ends.listFor(referencesOf(open, 'ended')));
    }

    /** A deletion `end` decides that has not begun: scheduled, due or held. */
    private async toCome(
        end: SubscriptionEnd,
        hasSubscriber: boolean,
        verdict: InstallationMarkVerdict,
        now: Date,
    ): Promise<AdminTenantDeletion> {
        const running = await contractRunningPast(this.contracts, end);
        const status = this.statusOf({
            end,
            record: null,
            holds: { verdict, hasSubscriber, contractRunsPastEnd: running !== null },
            now,
        });
        return { tenantId: end.tenantId, status: statusAsText(status), record: null };
    }

    /** The begun deletions of `records`, in their order, each with its record. */
    private async begun(
        records: readonly TenantDeletionRecord[],
        verdict: InstallationMarkVerdict,
        now: Date,
    ): Promise<AdminTenantDeletion[]> {
        if (records.length === 0) return [];
        const subscriptionIds = records.map((record) => record.subscriptionId);
        const trail: RecordTrail = {
            announcements: await this.ends.listAnnouncedFor(subscriptionIds),
            downloads: await this.ends.listExportDownloadsFor(subscriptionIds),
        };
        const deletions: AdminTenantDeletion[] = [];
        for (const record of records) {
            // A begun deletion is decided by its record and the mark alone.
            const status = this.statusOf({
                end: null,
                record,
                holds: { verdict, hasSubscriber: true, contractRunsPastEnd: false },
                now,
            });
            const notices = await this.notices.listForSubscription(record.subscriptionId);
            deletions.push({
                tenantId: record.tenantId,
                status: statusAsText(status),
                record: this.recordView(record, trail, notices),
            });
        }
        return deletions;
    }

    /** Where a deletion stands, decided as the run decides it. */
    private statusOf(
        input: Pick<TenantDeletionStatusInput, 'end' | 'record' | 'holds' | 'now'>,
    ): TenantDeletionStatus {
        const status = tenantDeletionStatusOf({
            ...input,
            timeZone: installationZoneOf(this.settings),
            leaseMs: DELETION_CLAIM_LEASE_MS,
        });
        // Only a deletion with neither an end nor a record has no status, and
        // every caller hands one of the two.
        if (!status) throw new Error('A deletion is read without its end or its record.');
        return status;
    }

    /** The record of a begun deletion, naming no person. */
    private recordView(
        record: TenantDeletionRecord,
        trail: RecordTrail,
        notices: readonly SubscriptionNoticeRecord[],
    ): AdminTenantDeletionRecord {
        const announced = trail.announcements.find(
            (announcement) => announcement.subscriptionId === record.subscriptionId,
        );
        return {
            exportOfferedFrom: record.exportOfferedFrom.toISOString(),
            exportBlockedBySuspension: record.exportBlockedBySuspension,
            announcedOn: announced
                ? dayInZone(announced.announcedAt, installationZoneOf(this.settings))
                : null,
            keep: record.keep,
            stores: record.stores.map((store) => ({
                store: store.store,
                position: store.position,
                countedAt: momentAsText(store.countedAt),
                counts: store.counts,
                erasedAt: momentAsText(store.erasedAt),
            })),
            commercialBefore: record.commercialBefore,
            commercialAfter: record.commercialAfter,
            startedAt: record.startedAt.toISOString(),
            closedAt: momentAsText(record.closedAt),
            attempts: record.attempts,
            lastFailure: record.lastFailure && failureAsText(record.lastFailure),
            reminders: remindersOf(notices),
            downloads: trail.downloads
                .filter((download) => download.subscriptionId === record.subscriptionId)
                .map((download) => ({
                    at: download.downloadedAt.toISOString(),
                    size: download.size,
                    by: actorRoleOf(download.downloadedBy, 'download.downloadedBy'),
                })),
        };
    }
}

/**
 * The reminders among the notices of one subscription, the first recorded
 * first: those of its end, since a subscription has one end.
 */
function remindersOf(notices: readonly SubscriptionNoticeRecord[]): AdminTenantDeletionReminder[] {
    const reminders: { readonly at: Date; readonly view: AdminTenantDeletionReminder }[] = [];
    for (const notice of notices) {
        if (notice.kind !== REMINDER_KIND) continue;
        const subject = deletionReminderSubjectIn(notice.subject);
        if (!subject) continue;
        const delivered = notice.deliveredAt !== null;
        reminders.push({
            at: notice.createdAt,
            view: {
                daysBefore: subject.daysBefore,
                createdAt: notice.createdAt.toISOString(),
                deliveredAt: momentAsText(notice.deliveredAt),
                recipientCount: delivered ? notice.recipientCount : null,
                channel: delivered ? (notice.delivery?.channel ?? null) : null,
            },
        });
    }
    return reminders
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .map((reminder) => reminder.view);
}

function momentAsText(moment: Date | null): string | null {
    return moment === null ? null : moment.toISOString();
}

function failureAsText(failure: TenantDeletionFailure): AdminTenantDeletionFailure {
    return { ...failure, at: failure.at.toISOString() };
}

/** `status` as JSON carries it: every moment as ISO 8601 text. */
function statusAsText(status: TenantDeletionStatus): AdminTenantDeletionStatus {
    switch (status.kind) {
        case 'scheduled':
        case 'due':
        case 'halted':
            return status;
        case 'running':
            return {
                ...status,
                startedAt: status.startedAt.toISOString(),
                lastFailure: status.lastFailure && failureAsText(status.lastFailure),
            };
        case 'retrying':
            return {
                ...status,
                startedAt: status.startedAt.toISOString(),
                lastFailure: failureAsText(status.lastFailure),
            };
        case 'deleted':
            return { ...status, closedAt: status.closedAt.toISOString() };
    }
}
