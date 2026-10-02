// The one reminder a retirement sends (`SC-SUB-034`).
//
// A subscription told of a retirement is reminded once, 14 days before its
// date, where staying put costs it something: the replacement is dearer in the
// rhythm it is billed in then, or takes a feature or a quota away. The
// quarter-hourly run finds every subscription whose reminder is due and that
// is still on the retired version, so a run that did not happen is caught up
// by the next — until the date, after which there is nothing to remind of.
//
// Not reminded: a subscription that has cancelled, which is leaving already
// and cannot declare an earlier end over the one it has; one that switched,
// which is no longer on the version; and one whose own scheduled change takes
// it off the version by the date. A reminder is a notice like the others: the
// application sends it to the tenant's administrators, and the record keeps to
// whom and how, once however many instances run.

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    retirementCostsTheSubscription,
    retirementReminderIsDue,
    type RlsBypassPort,
    type SubscriptionNoticePort,
    type SubscriptionNoticeRepository,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
    type VersionRetiredNotice,
    type VersionRetirementReminder,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { NOTICE_DELIVERY_TIMEOUT_MS, NoticeSender } from './notice-sender.js';
import { leavesTheVersionBy, rhythmAt } from './retirement-reach.js';
import { groupByRetiredVersion, retirementNoticesOnRecord } from './retirement-notices.js';
import { RetirementSwitchService } from './retirement-switch.service.js';
import {
    SUBSCRIPTION_NOTICE_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import type { RetirementNoticeRun } from './version-retirement.service.js';

const KIND = 'version-retirement-reminder';

@Injectable()
export class RetirementReminderService {
    private readonly deliveryTimeoutMs = NOTICE_DELIVERY_TIMEOUT_MS;
    private readonly sender: NoticeSender;

    constructor(
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_NOTICE_PORT_TOKEN)
        port: SubscriptionNoticePort,
        @Inject(RetirementSwitchService)
        private readonly switches: RetirementSwitchService,
        // The run is the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {
        this.sender = new NoticeSender(notices, port);
    }

    /** Reminds every subscription whose reminder is due at `now` and has not gone out. */
    async remindDue(now: Date): Promise<RetirementNoticeRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const due = (await retirementNoticesOnRecord(this.notices)).filter((notice) =>
                retirementReminderIsDue(notice, now),
            );
            let told = 0;
            let failed = 0;
            for (const [retiredId, notices] of groupByRetiredVersion(due)) {
                const reminded = new Set(
                    await this.notices.listDeliveredSubscriptionIds(KIND, retiredId),
                );
                // `listBoundToVersion` is required where retiring is on, and
                // a notice exists only where it was.
                const onIt = await this.subscriptions.listBoundToVersion!(retiredId);
                const byId = new Map(onIt.map((row) => [row.subscription.id, row.subscription]));
                for (const notice of notices) {
                    const sub = byId.get(notice.subscriptionId);
                    if (!sub || reminded.has(notice.subscriptionId)) continue;
                    if (!isToBeReminded(sub, notice)) continue;
                    const reminder = await this.reminderOf(notice, sub, now);
                    if (!reminder) continue;
                    const outcome = await this.sender.tell(
                        reminder,
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
     * The reminder for `sub`, or null where staying put costs it nothing in the
     * rhythm it is billed in at the date.
     */
    private async reminderOf(
        notice: VersionRetiredNotice,
        sub: SubscriptionUsageRecord,
        now: Date,
    ): Promise<VersionRetirementReminder | null> {
        const billingCycle = rhythmAt(sub, new Date(notice.effectiveAt));
        if (!retirementCostsTheSubscription(notice, billingCycle)) return null;
        const open = await this.switches.openFor(sub, now);
        return {
            ...notice,
            kind: KIND,
            billingCycle,
            switchTerms: open?.notice.retirementId === notice.retirementId ? open.terms : null,
        };
    }
}

/**
 * Whether the reminder is the platform's to send: not where the subscription
 * has ended or cancelled, nor where a change of its own takes it off the
 * version by its date — it would be told of a cost it does not bear.
 */
function isToBeReminded(sub: SubscriptionUsageRecord, notice: VersionRetiredNotice): boolean {
    if (sub.status === 'CANCELED' || cancellationLandsAt(sub) !== null) return false;
    return !leavesTheVersionBy(sub, new Date(notice.effectiveAt));
}
