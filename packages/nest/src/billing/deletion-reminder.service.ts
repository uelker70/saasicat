// The reminders a tenant's administrators are sent before its data is deleted
// (`SC-CANC-022`).
//
// Once a subscription has ended its tenant may only read, and its users stop
// signing in: a notice is the only way its administrators learn when the data
// goes. So the quarter-hourly run that records the ends reminds after it. Every
// end whose deletion day is still to come is asked which lead time of
// `config/saas.yaml` is due today (`deletionReminderDue`), and the one due is
// handed to the application's notice port and recorded — once, however many
// instances run, since the record's unique key is the end and the lead time;
// and of instances that decide on different lead times for one end at once, at
// most one sends, since each checks again after its claim.
//
// The lead times are the ones the file named when the application started,
// not at the end's recording: after a restart with other lead times, one added
// is reminded of on its day, also to ends recorded before, and a reminder told
// for one the file no longer names still covers what it covered. Every end whose deletion
// day is after today is reminded, whatever else holds its tenant back — a
// suspension does not stop a deletion, so it does not stop the warning. No end
// is left out as being deleted already: nothing records a deletion under way
// yet — the `deleting` hold has no writer — so there is none to leave out.
//
// Platform-wide: the ends and the reminders are read across tenants, through
// `RlsBypassPort` (`SC-SEC-019`).

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    addDaysToDay,
    dayInZone,
    deletionReminderDue,
    deletionReminderSubjectIn,
    deletionReminderSubjectOf,
    installationZoneOf,
    type CalendarDay,
    type DeletionReminderNotice,
    type EndOfSubscriptionSettings,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriptionEnd,
    type SubscriptionEndPort,
    type SubscriptionNoticePort,
    type SubscriptionNoticeRecord,
    type SubscriptionNoticeRepository,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import {
    NOTICE_CLAIM_LEASE_MS,
    NOTICE_DELIVERY_TIMEOUT_MS,
    NoticeSender,
    type NoticeOutcome,
} from './notice-sender.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import {
    END_OF_SUBSCRIPTION_TOKEN,
    SUBSCRIPTION_END_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
} from './tenant-billing.tokens.js';

const KIND = 'deletion-reminder';

/**
 * How much earlier than the first of the ends was recorded the run reads the
 * reminders. A reminder is recorded after its end, but by whichever instance
 * claims it and on that instance's clock: an hour's margin keeps a clock
 * running behind the one that recorded the end from hiding a reminder.
 */
const CLOCKS_MAY_DIFFER_BY_MS = 60 * 60_000;

/** What one run sent. */
export interface DeletionReminderRun {
    /** Reminders delivered — to somebody, or recorded as told to nobody. */
    told: number;
    /** Reminders that could not be put together or sent; the next run tries them again. */
    failed: number;
}

/** What the record holds of one end's reminders. */
interface RemindersOfAnEnd {
    /** The lead times reminders were delivered for, to somebody or to nobody. */
    readonly told: number[];
    /** Whether a run holds a claim on one of them that has not gone stale. */
    held: boolean;
}

@Injectable()
export class DeletionReminderService {
    private readonly logger = new Logger(DeletionReminderService.name);
    private readonly sender: NoticeSender;

    constructor(
        @Inject(SUBSCRIPTION_END_PORT_TOKEN) private readonly ends: SubscriptionEndPort,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_NOTICE_PORT_TOKEN) port: SubscriptionNoticePort,
        @Inject(END_OF_SUBSCRIPTION_TOKEN) private readonly period: EndOfSubscriptionSettings,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<PlanCatalogSettings, 'timeZone'>,
        // The run is the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {
        // A reminder told to nobody is not tried again: a read-only tenant
        // cannot add an administrator, so a retry would reach nobody again.
        this.sender = new NoticeSender(notices, port, { retriesNobody: false });
    }

    /**
     * Sends each end whose deletion day is after the installation's day at
     * `now` the reminder due today, where one is — at most one per end: for the
     * smallest lead time due that no reminder told covers.
     *
     * An end one of whose reminders another run holds, claimed and not yet
     * delivered, is left alone by this run: that reminder may still go out,
     * and one sent beside it would reach the administrator alongside it, the
     * nearer lead time possibly first. Once it is delivered it covers what a
     * reminder told covers, and a smaller lead time due goes by a later run;
     * once it is let go, or its claim goes stale, it covers nothing.
     *
     * A reminder of a larger lead time that was never delivered is not sent
     * once a smaller one is due: the smaller one says the same, nearer the day.
     *
     * Two runs at once that decide on different lead times for one end send
     * one of them at most (`stillTheOneToSend`).
     */
    async remindDue(now: Date): Promise<DeletionReminderRun> {
        const today = dayInZone(now, installationZoneOf(this.settings));
        return readAcrossTenants(this.rlsBypass, async () => {
            const ends = await this.ends.listDeletingAfter(today);
            if (ends.length === 0) return { told: 0, failed: 0 };
            const reminders = await this.remindersOf(ends, now);
            let told = 0;
            let failed = 0;
            for (const end of ends) {
                const outcome = await this.remind(end, reminders.get(end.id), today, now);
                if (outcome === 'told') told += 1;
                if (outcome === 'failed') failed += 1;
            }
            return { told, failed };
        });
    }

    /**
     * The reminders of `ends` in one read: every one recorded since the first
     * of them was recorded, less the margin for clocks, by end.
     */
    private async remindersOf(
        ends: readonly SubscriptionEnd[],
        now: Date,
    ): Promise<Map<string, RemindersOfAnEnd>> {
        const firstRecorded = ends.reduce(
            (first, end) => Math.min(first, end.recordedAt.getTime()),
            Number.POSITIVE_INFINITY,
        );
        const records = await this.notices.listOfKindSince(
            KIND,
            new Date(firstRecorded - CLOCKS_MAY_DIFFER_BY_MS),
        );
        return remindersByEnd(records, now);
    }

    /**
     * Sends `end` the reminder due today. One that cannot be put together
     * fails for this end alone, as one the application could not send does,
     * and the next run tries again.
     */
    private async remind(
        end: SubscriptionEnd,
        reminders: RemindersOfAnEnd | undefined,
        today: CalendarDay,
        now: Date,
    ): Promise<NoticeOutcome> {
        if (reminders?.held) return null;
        let reminder: DeletionReminderNotice | null;
        try {
            reminder = this.reminderOf(end, reminders?.told ?? [], today);
        } catch (error) {
            this.logger.error(
                `The reminder of the deletion of tenant ${end.tenantId} on ${end.deletesOn} could ` +
                    'not be put together; the next run tries again.',
                error instanceof Error ? error.stack : String(error),
            );
            return 'failed';
        }
        if (!reminder) return null;
        const decidedOn = reminders?.told ?? [];
        return this.sender.tell(
            reminder,
            deletionReminderSubjectOf(reminder),
            NOTICE_DELIVERY_TIMEOUT_MS,
            (claimed) => this.stillTheOneToSend(end, decidedOn, claimed.id, now),
        );
    }

    /**
     * Whether the reminder this run has just claimed for `end` is still the
     * one to send, read afresh: no other reminder of the end is held, and the
     * lead times told are still the ones the run decided on, `decidedOn`.
     *
     * Two instances can decide on the same record and still decide
     * differently — lead times changed by a restart one has had and the other
     * not, or clocks on either side of the installation's midnight — and then
     * each claims a reminder of another lead time, under another key, so
     * neither claim stops the other. Each claims before it reads here, so of
     * two such runs at least one sees the other's reminder, held or already
     * told: where one sees it, that one lets its claim go and the other
     * sends; where both see each other, both let go and nothing goes this
     * run, and the next run decides again on what the record then holds. One
     * reminder at most, never two from one decision. Two instances that keep
     * running with different lead times — a canary, or a second slot kept
     * warm — reach the end at the same moment every run, so they can keep
     * letting go of the lead times they disagree on until one both name is
     * due: breaking the tie would need an order the database stamps, since
     * each claim's moment comes from its instance's own clock.
     *
     * A reminder told since the run decided is reason enough to let go, even
     * where the lead time decided on would still be due beside it: under
     * other lead times a 10-day reminder does not cover a 7-day one, and the
     * administrator would get both at once. The next run decides with the
     * reminder told, as any later run does.
     */
    private async stillTheOneToSend(
        end: SubscriptionEnd,
        decidedOn: readonly number[],
        claimedId: string,
        now: Date,
    ): Promise<boolean> {
        const records = await this.notices.listForSubscription(end.subscriptionId);
        const others = records.filter((record) => record.kind === KIND && record.id !== claimedId);
        const fresh = remindersByEnd(others, now).get(end.id) ?? { told: [], held: false };
        if (fresh.held) return false;
        return sameLeadTimes(fresh.told, decidedOn);
    }

    /** The reminder due for `end` today, or null where none is. */
    private reminderOf(
        end: SubscriptionEnd,
        toldDaysBefore: readonly number[],
        today: CalendarDay,
    ): DeletionReminderNotice | null {
        const daysBefore = deletionReminderDue({
            deletesOn: end.deletesOn,
            reminderDaysBefore: this.period.reminderDaysBefore,
            toldDaysBefore,
            today,
        });
        if (daysBefore === null) return null;
        return {
            kind: KIND,
            tenantId: end.tenantId,
            subscriptionId: end.subscriptionId,
            subscriptionEndId: end.id,
            daysBefore,
            readOnlyUntil: addDaysToDay(end.deletesOn, -1),
            deletesOn: end.deletesOn,
        };
    }
}

/**
 * The reminders `records` hold, by end: the lead times told — delivered, to
 * somebody or to nobody — and whether a run holds one, claimed within the
 * lease before `now` and not delivered. One definition for the run's snapshot
 * and for the check before sending.
 */
function remindersByEnd(
    records: readonly SubscriptionNoticeRecord[],
    now: Date,
): Map<string, RemindersOfAnEnd> {
    const freshFrom = now.getTime() - NOTICE_CLAIM_LEASE_MS;
    const byEnd = new Map<string, RemindersOfAnEnd>();
    for (const record of records) {
        // Only this run writes the kind; a subject it did not write names no end of its own.
        const subject = deletionReminderSubjectIn(record.subject);
        if (!subject) continue;
        const of = byEnd.get(subject.subscriptionEndId) ?? { told: [], held: false };
        if (record.deliveredAt) of.told.push(subject.daysBefore);
        else if (record.claimedAt && record.claimedAt.getTime() >= freshFrom) of.held = true;
        byEnd.set(subject.subscriptionEndId, of);
    }
    return byEnd;
}

/** Whether `a` and `b` name the same lead times, in whatever order. */
function sameLeadTimes(a: readonly number[], b: readonly number[]): boolean {
    const set = new Set(a);
    return set.size === new Set(b).size && b.every((daysBefore) => set.has(daysBefore));
}
