import { createHash } from 'node:crypto';

import {
    ConflictException,
    HttpException,
    Inject,
    Injectable,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
    type OnModuleInit,
} from '@nestjs/common';
import {
    SUBSCRIBER_ERROR_CODES,
    canonicalJson,
    planSubscriberJoin,
    subscriberJoinDigestInput,
    subscriberJoinRefusal,
    subscriberSearchTermsOf,
    type RlsBypassPort,
    type SubscriberRecord,
    type SubscriberRepository,
    type SubscriberJoinPlan,
    type SubscriberJoinRecord,
    type SubscriberJoinRefusal,
    type SubscriberJoinRepository,
    type SubscriberJoinRequest,
    type SubscriberJoinState,
    type TransactionRunner,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { codedError } from '../errors/coded-error.js';
import {
    SUBSCRIBER_JOIN_REPOSITORY_TOKEN,
    SUBSCRIBER_JOIN_TRANSACTION_RUNNER_TOKEN,
    SUBSCRIBER_REPOSITORY_TOKEN,
} from './subscriber.tokens.js';

/**
 * How many subscribers a search for one customer number reads: the number
 * itself, and the few a prefix-less search finds under other prefixes.
 */
const SUBSCRIBERS_ONE_NUMBER_MATCHES = 20;

/** What a join would do, decided under the locks it held, and the digest it is shown under. */
export interface SubscriberJoinDecision {
    state: SubscriberJoinState;
    plan: SubscriberJoinPlan;
    digest: string;
}

/** A join made: what was recorded, and what it was decided from. */
export interface SubscriberJoinOutcome extends SubscriberJoinDecision {
    join: SubscriberJoinRecord;
}

/** The answer a refusal is given on the wire: what the operator gave is wrong, or what the subscribers are. */
const REFUSED_AS_INVALID: ReadonlySet<string> = new Set([
    SUBSCRIBER_ERROR_CODES.SUBSCRIBER_JOIN_REASON_REQUIRED,
    SUBSCRIBER_ERROR_CODES.SUBSCRIBER_TAKEOVER_IS_A_TRANSFER,
    SUBSCRIBER_ERROR_CODES.SUBSCRIBER_JOIN_SAME_SUBSCRIBER,
]);

/**
 * Joins a returning customer's new subscriber into the subscriber it had
 * (`SC-ADM-027`): `from` is the one with the live tenant, `into` the earlier
 * one. Both rows are locked for the whole decision, so what is shown, checked
 * and written is one state, and a write that reads either subscriber waits.
 * Runs across tenants: the two subscribers' rows belong to two tenants, and a
 * row a policy hid would be left behind — which the repository refuses.
 */
@Injectable()
export class SubscriberJoinService implements OnModuleInit {
    constructor(
        @Inject(SUBSCRIBER_JOIN_REPOSITORY_TOKEN)
        private readonly joins: SubscriberJoinRepository,
        @Inject(SUBSCRIBER_JOIN_TRANSACTION_RUNNER_TOKEN)
        private readonly runner: TransactionRunner,
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly subscribers: SubscriberRepository,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

    /**
     * Refuses to start beside a database that would let a join leave rows
     * behind: a write that read a subscriber before its join and wrote after
     * it would land at a record nobody looks at, and nothing would say so.
     */
    async onModuleInit(): Promise<void> {
        const problem = await this.joins.protectionProblem();
        if (problem) throw new Error(`Joining subscribers cannot start:\n- ${problem}`);
    }

    /**
     * What joining `fromSubscriberId` into `intoSubscriberId` would do, refused
     * where the two subscribers cannot be joined. Writes nothing.
     */
    preview(fromSubscriberId: string, intoSubscriberId: string): Promise<SubscriberJoinDecision> {
        return readAcrossTenants(this.rlsBypass, () =>
            this.runner.run(async (tx) => {
                const state = await this.held(fromSubscriberId, intoSubscriberId, tx);
                refuse(subscriberJoinRefusal(state));
                return decisionOf(state);
            }),
        );
    }

    /**
     * Joins the two, refused where they cannot be joined or where what the join
     * would do is not what the preview `request.previewDigest` names showed —
     * with the preview as it stands now, as `present` shows it, where it is
     * given. `joinedBy` is who joins them, as an actor tag the audit log would
     * write.
     */
    join(
        fromSubscriberId: string,
        intoSubscriberId: string,
        request: SubscriberJoinRequest,
        joinedBy: string,
        present?: (decision: SubscriberJoinDecision) => Promise<unknown>,
    ): Promise<SubscriberJoinOutcome> {
        return readAcrossTenants(this.rlsBypass, () =>
            this.runner.run(async (tx) => {
                const state = await this.held(fromSubscriberId, intoSubscriberId, tx);
                refuse(subscriberJoinRefusal(state, request));
                const decision = decisionOf(state);
                if (
                    request.previewDigest !== undefined &&
                    request.previewDigest !== decision.digest
                ) {
                    throw new ConflictException(
                        codedError(
                            SUBSCRIBER_ERROR_CODES.SUBSCRIBER_JOIN_PREVIEW_CHANGED,
                            present ? { preview: await present(decision) } : undefined,
                        ),
                    );
                }
                const join = await this.joins.join(
                    {
                        plan: decision.plan,
                        reason: request.reason.trim(),
                        joinedBy,
                        joinedAt: new Date(),
                        digest: decision.digest,
                    },
                    tx,
                );
                return { ...decision, join };
            }),
        );
    }

    /**
     * The subscriber the customer number names, whether or not its tenant
     * lives, or `null` where none does: what a support call starts with, and
     * what the command line names both subscribers by.
     */
    subscriberNumbered(customerNumber: string): Promise<SubscriberRecord | null> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const page = await this.subscribers.search({
                terms: subscriberSearchTermsOf(customerNumber),
                withoutLiveTenant: false,
                limit: SUBSCRIBERS_ONE_NUMBER_MATCHES,
            });
            return page.subscribers.find((each) => each.customerNumber === customerNumber) ?? null;
        });
    }

    /** Every join that names one of these subscribers, either way. */
    joinsOf(subscriberIds: readonly string[]): Promise<SubscriberJoinRecord[]> {
        return readAcrossTenants(this.rlsBypass, () => this.joins.listFor(subscriberIds));
    }

    private async held(
        fromSubscriberId: string,
        intoSubscriberId: string,
        tx: Parameters<SubscriberJoinRepository['hold']>[2],
    ): Promise<SubscriberJoinState> {
        const state = await this.joins.hold(fromSubscriberId, intoSubscriberId, tx);
        if (state) return state;
        throw new NotFoundException(
            codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_NOT_FOUND, {
                subscriberId: `${fromSubscriberId}, ${intoSubscriberId}`,
            }),
        );
    }
}

/** The plan and the digest of the state it was decided from. */
function decisionOf(state: SubscriberJoinState): SubscriberJoinDecision {
    const digest = createHash('sha256')
        .update(canonicalJson(subscriberJoinDigestInput(state)))
        .digest('hex');
    return { state, plan: planSubscriberJoin(state), digest };
}

/** Throws the refusal as the answer it is on the wire; nothing where there is none. */
function refuse(refusal: SubscriberJoinRefusal | null): void {
    if (!refusal) return;
    const body = codedError(refusal.code, refusal.params);
    const refused: HttpException = REFUSED_AS_INVALID.has(refusal.code)
        ? new UnprocessableEntityException(body)
        : new ConflictException(body);
    throw refused;
}
