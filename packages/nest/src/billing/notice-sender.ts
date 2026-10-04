// Telling a subscriber one notice, once: claim it, have the application send
// it, and record to whom (`SC-SUB-023`). Shared by every kind of notice, so a
// notice is once however many instances run, whatever it is about.

import { Logger } from '@nestjs/common';
import type {
    SubscriptionNotice,
    SubscriptionNoticeDelivery,
    SubscriptionNoticePort,
    SubscriptionNoticeRepository,
} from '@saasicat/core';

import { TimeoutError, withTimeout } from '../core/with-timeout.js';

/**
 * How long a run's claim on a notice holds. Longer than an attempt may take,
 * so a second instance does not take a notice on while the first still waits
 * for the application to answer.
 */
export const NOTICE_CLAIM_LEASE_MS = 15 * 60_000;

/** How long the application may take to send one notice before the attempt counts as failed. */
export const NOTICE_DELIVERY_TIMEOUT_MS = 60_000;

/** How often a notice the application keeps telling nobody of is said in the log. */
const NOBODY_WARNING_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * What an attempt came to: told; failed, for the next run to try again;
 * `untold` where the application named nobody and the notice waits for
 * somebody to tell (`retriesNobody`); null where another run holds it or it
 * went out meanwhile.
 */
export type NoticeOutcome = 'told' | 'failed' | 'untold' | null;

export interface NoticeSenderOptions {
    /**
     * Whether a notice the application tells nobody of is tried again, rather
     * than recorded as sent to no one. A retirement's notice is: the date it
     * names counts from its reaching somebody (`SC-SUB-038`).
     */
    readonly retriesNobody?: boolean;
}

export class NoticeSender {
    private readonly logger = new Logger(NoticeSender.name);
    private readonly retriesNobody: boolean;
    /** When each notice told nobody was last said in the log, so it is said once a day. */
    private readonly nobodyWarnedAt = new Map<string, number>();

    constructor(
        private readonly notices: SubscriptionNoticeRepository,
        private readonly port: SubscriptionNoticePort,
        options: NoticeSenderOptions = {},
    ) {
        this.retriesNobody = options.retriesNobody ?? false;
    }

    /**
     * Claims the notice about `subject`, has the application send it, and
     * records to whom. Null where another run holds it or it went out meanwhile.
     */
    async tell(
        notice: SubscriptionNotice,
        subject: string,
        deliveryTimeoutMs: number,
    ): Promise<NoticeOutcome> {
        // Stamped with the moment it is taken, not with the start of the run: a
        // run that takes longer than the lease would otherwise take claims that
        // every other instance already reads as abandoned.
        const takenAt = new Date();
        const what = `${notice.kind} ${subject} to subscription ${notice.subscriptionId}`;
        let claimed: Awaited<ReturnType<SubscriptionNoticeRepository['claim']>>;
        try {
            claimed = await this.notices.claim(
                {
                    tenantId: notice.tenantId,
                    subscriptionId: notice.subscriptionId,
                    kind: notice.kind,
                    subject,
                },
                notice,
                takenAt,
                new Date(takenAt.getTime() - NOTICE_CLAIM_LEASE_MS),
            );
        } catch (error) {
            // Nothing was taken on, so nothing is held: the next run finds the
            // notice as it was, and this one goes on to the next subscriber.
            this.logger.error(
                `The notice ${what} could not be taken on; the next run tries again.`,
                error instanceof Error ? error.stack : String(error),
            );
            return 'failed';
        }
        if (!claimed) return null;
        const claimedAt = claimed.claimedAt ?? takenAt;

        // A port that throws before it returns a promise fails like one that
        // rejects, rather than escaping the run with its claim still held.
        const sending = new Promise<SubscriptionNoticeDelivery>((resolve) =>
            resolve(this.port.deliver(notice)),
        );
        let delivery: SubscriptionNoticeDelivery;
        try {
            delivery = await withTimeout(() => sending, deliveryTimeoutMs);
        } catch (error) {
            if (error instanceof TimeoutError) {
                this.settleLate(sending, claimed.id, claimedAt, deliveryTimeoutMs);
            } else {
                this.logger.error(
                    `The notice ${what} was not sent; the next run tries again.`,
                    error instanceof Error ? error.stack : String(error),
                );
                await this.letGo(claimed.id, claimedAt);
            }
            return 'failed';
        }
        if (delivery.recipients.length === 0) {
            if (this.retriesNobody) {
                this.warnOfNobody(claimed.id, what);
                await this.letGo(claimed.id, claimedAt);
                return 'untold';
            }
            this.logger.warn(
                `The application told nobody of the notice ${what}; it is recorded as sent to ` +
                    'no one and is not tried again.',
            );
        }
        await this.recordSent(claimed.id, claimedAt, delivery);
        return 'told';
    }

    /** Says once a day that a notice still reaches nobody, rather than on every run. */
    private warnOfNobody(id: string, what: string): void {
        const now = Date.now();
        const last = this.nobodyWarnedAt.get(id);
        if (last !== undefined && now - last < NOBODY_WARNING_INTERVAL_MS) return;
        this.nobodyWarnedAt.set(id, now);
        this.logger.warn(
            `The application told nobody of the notice ${what}; it is tried again until ` +
                'somebody is told.',
        );
    }

    /**
     * An application that has not answered in time may still send the notice,
     * so its claim is not let go: no other run takes it on while the answer is
     * awaited. A late success is recorded as sent, and a late failure lets the
     * claim go for the next run — as does a late answer naming nobody, where
     * nobody is not told (`retriesNobody`). An answer that takes longer than
     * the lease comes after another run may have sent the notice again.
     */
    private settleLate(
        sending: Promise<SubscriptionNoticeDelivery>,
        id: string,
        claimedAt: Date,
        deliveryTimeoutMs: number,
    ): void {
        this.logger.warn(
            `The application did not answer within ${deliveryTimeoutMs} ms for the notice ` +
                `${id}; it stays held while the answer is awaited.`,
        );
        void sending.then(
            async (delivery) => {
                if (this.retriesNobody && delivery.recipients.length === 0) {
                    this.warnOfNobody(id, id);
                    await this.letGo(id, claimedAt);
                    return;
                }
                await this.recordSent(id, claimedAt, delivery);
            },
            async (error: unknown) => {
                this.logger.error(
                    `The notice ${id} was not sent; the next run tries again.`,
                    error instanceof Error ? error.stack : String(error),
                );
                await this.letGo(id, claimedAt);
            },
        );
    }

    /**
     * Lets a claim go for the next run. A claim that cannot be let go is not
     * lost — it goes stale and is taken on then — so the failure is logged, not
     * thrown into a run that has other subscribers to tell.
     */
    private async letGo(id: string, claimedAt: Date): Promise<void> {
        try {
            await this.notices.release(id, claimedAt);
        } catch (error) {
            this.logger.error(
                `The notice ${id} could not be let go; it is tried again once its claim goes stale.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    /**
     * Records a notice the application has sent. It went out whatever happens
     * here, so a failure to record it is not released for another attempt: it
     * is logged, and the run goes on to the next subscriber rather than
     * stopping theirs over one row.
     */
    private async recordSent(
        id: string,
        claimedAt: Date,
        delivery: SubscriptionNoticeDelivery,
    ): Promise<void> {
        try {
            if (!(await this.notices.confirm(id, claimedAt, delivery, new Date()))) {
                this.logger.warn(
                    `The notice ${id} was sent, but its claim had gone stale and another run ` +
                        'took it on; the subscriber may hear of it twice.',
                );
            }
        } catch (error) {
            this.logger.error(
                `The notice ${id} was sent, but recording it failed; once its claim goes stale ` +
                    'the subscriber may hear of it again.',
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}
