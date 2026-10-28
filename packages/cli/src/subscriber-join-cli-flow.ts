// SubscriberJoinCliFlow — `<app> subscribers join`.
//
// Joins a returning customer's new subscriber into the subscriber it had, on
// the operator's command (`SC-ADM-027`), for an installation without the
// administration's resources as well:
//
//     <app> subscribers join --from 10234 --into 10045 \
//         --reason "Returning customer, confirmed by phone"   # shows what moves
//     <app> subscribers join … --apply                       # joins them
//
// Both subscribers are named by their customer number, which is what a support
// call names and what both records show. `--from` is the one with the live
// tenant, `--into` the earlier one. Without `--apply` nothing is written.
// `--apply` declares that both are one legal entity — another one taking over
// is a transfer, not a join —, asks for the second factor (`SC-ADM-019`) and,
// against production, a confirmation; the audit log records the operator and
// the reason (`SC-ADM-020`). A join is not undone.

import { Inject, Injectable } from '@nestjs/common';
import { LEGAL_IDENTITY_FIELDS, SUBSCRIBER_OWNED_TABLES } from '@saasicat/core';
import type {
    SubscriberJoinPlan,
    SubscriberJoinRecord,
    SubscriberJoinSide,
    SubscriberOwnedTable,
    SubscriberRecord,
} from '@saasicat/core';
import { SubscriberJoinService, type SubscriberJoinDecision } from '@saasicat/nest';

import { CliContextService, CliError } from './cli-context.service.js';
import { refusalsAsCliErrors } from './cli-refusals.js';

/** Exit code per `cli-conventions.md` §6. */
const EXIT_USER_ERROR = 1;

/** What each table that names a subscriber holds, as the preview counts it. */
const MOVING_LABELS: Record<SubscriberOwnedTable, string> = {
    subscriber_tenants: 'tenant links',
    subscriber_corrections: 'corrections',
    subscriber_tax_origin_changes: 'changes of the tax origin',
    subscriber_vat_id_checks: 'checks of the VAT id',
    subscriber_payment_methods: 'payment methods',
    subscriber_payment_method_setups: 'payment method set-ups',
    subscriber_ledger_entries: 'charges',
    subscription_contracts: 'contracts',
    subscription_invoices: 'invoices',
    subscriber_payments: 'payments',
    subscriber_credits: 'credits',
    subscriber_refunds: 'refunds',
    subscriber_reversals: 'reversals',
    subscriber_reconciliation_cases: 'cases to reconcile',
};

export interface SubscriberJoinOptions {
    as?: string;
    yes?: boolean;
    /** The customer number of the subscriber with the live tenant. */
    from?: string;
    /** The customer number of the earlier subscriber. */
    into?: string;
    /** Why they are joined; the record keeps it. */
    reason?: string;
    /** Join them; without it nothing is written. */
    apply?: boolean;
}

/** A join made from the command line: what was recorded, and both subscribers it names. */
export interface JoinedSubscribers {
    join: SubscriberJoinRecord;
    from: SubscriberRecord;
    into: SubscriberRecord;
}

@Injectable()
export class SubscriberJoinCliFlow {
    constructor(
        @Inject(CliContextService) private readonly ctx: CliContextService,
        @Inject(SubscriberJoinService) private readonly joins: SubscriberJoinService,
    ) {}

    /**
     * What joining the two would do. Writes nothing; asks for the operator's
     * identity, because it reads two subscribers' records, and for neither the
     * second factor nor a confirmation.
     */
    async preview(options: SubscriberJoinOptions): Promise<SubscriberJoinDecision> {
        await this.ctx.ensureSuperAdmin(this.ctx.resolveIdentity(options.as));
        const { from, into } = await this.subscribersOf(options);
        return refusalsAsCliErrors('SUBSCRIBER_JOIN_REFUSED', () =>
            this.joins.preview(from.id, into.id),
        );
    }

    /**
     * Joins them, with the second factor and, against production, a
     * confirmation, and records it in the audit log under the operator.
     * Refused as the route refuses: exit code 6 where the subscribers are not
     * what a join needs, 1 for what the command was given.
     */
    async apply(options: SubscriberJoinOptions): Promise<JoinedSubscribers> {
        const reason = required(options.reason, '--reason "<why>"');
        const identity = this.ctx.resolveIdentity(options.as);
        const user = await this.ctx.ensureSuperAdmin(identity);
        const { from, into } = await this.subscribersOf(options);
        await this.ctx.requireMfa(user.id);
        await this.ctx.ensureProductionConfirmation({ yes: options.yes });
        const outcome = await refusalsAsCliErrors('SUBSCRIBER_JOIN_REFUSED', () =>
            this.joins.join(from.id, into.id, { kind: 'same-entity', reason }, identity.actor),
        );
        await this.ctx.log({
            identity,
            userId: user.id,
            entity: 'Subscriber',
            entityId: outcome.join.intoSubscriberId,
            action: 'SUBSCRIBER_JOINED',
            changes: {
                fromSubscriberId: outcome.join.fromSubscriberId,
                intoSubscriberId: outcome.join.intoSubscriberId,
                reason: outcome.join.reason,
                moved: outcome.join.moved,
            },
        });
        return { join: outcome.join, from, into };
    }

    /** What the preview shows, for the terminal. */
    formatPreview(decision: SubscriberJoinDecision): string {
        const { from, into } = decision.state;
        const lines = [
            `${described(from)} would be joined into ${described(into)} — nothing is written yet.`,
            `Moves: ${movedOf(decision.plan)}`,
            ...replacedOf(decision.plan),
            ...correctedOf(decision.plan),
            vatIdCheckOf(decision.plan),
        ];
        if (decision.plan.paymentMethodsOutOfUse > 0) {
            lines.push(
                `The payment method in use at ${into.subscriber.customerNumber} goes out of use; ` +
                    'the one given at sign-up is used from now on.',
            );
        }
        lines.push(
            'Joining declares that both are one legal entity, and is not undone.',
            'Run again with --apply to join them.',
        );
        return lines.join('\n');
    }

    /** What the join wrote, for the terminal. */
    formatJoined(joined: JoinedSubscribers): string {
        return [
            `Joined ${joined.from.customerNumber} into ${joined.into.customerNumber} ` +
                `(${joined.into.legalName}): ${movedOf({ moving: joined.join.moved })}.`,
            `The record of ${joined.from.customerNumber} names ${joined.into.customerNumber} ` +
                'from now on, and takes no change.',
        ].join('\n');
    }

    /** Both subscribers, by the customer numbers the options name. */
    private async subscribersOf(
        options: SubscriberJoinOptions,
    ): Promise<{ from: SubscriberRecord; into: SubscriberRecord }> {
        return {
            from: await this.numbered(required(options.from, '--from <customer number>')),
            into: await this.numbered(required(options.into, '--into <customer number>')),
        };
    }

    private async numbered(customerNumber: string): Promise<SubscriberRecord> {
        const subscriber = await this.joins.subscriberNumbered(customerNumber);
        if (subscriber) return subscriber;
        throw new CliError(
            'SUBSCRIBER_NOT_FOUND',
            `No subscriber has the customer number ${customerNumber}.`,
            EXIT_USER_ERROR,
        );
    }
}

function required(value: string | undefined, flag: string): string {
    if (value !== undefined && value.trim() !== '') return value;
    throw new CliError('CLI_OPTION_REQUIRED', `${flag} is required.`, EXIT_USER_ERROR);
}

/** A subscriber as the preview names it: its number, its name and its live tenant. */
function described(side: SubscriberJoinSide): string {
    const live = side.links.find((link) => link.unlinkedAt === null);
    return (
        `${side.subscriber.customerNumber} ${side.subscriber.legalName}` +
        (live ? ` (tenant ${live.tenantId})` : ' (no live tenant)')
    );
}

function movedOf(plan: Pick<SubscriberJoinPlan, 'moving'>): string {
    const counted = SUBSCRIBER_OWNED_TABLES.flatMap(({ table }) => {
        const count = plan.moving[table] ?? 0;
        return count > 0 ? [`${count} ${MOVING_LABELS[table]}`] : [];
    });
    return counted.length > 0 ? counted.join(', ') : 'nothing';
}

function replacedOf(plan: SubscriberJoinPlan): string[] {
    return plan.replaced.map(
        ({ field, previous, next }) => `Replaced: ${field} ${shown(previous)} → ${shown(next)}`,
    );
}

function correctedOf(plan: SubscriberJoinPlan): string[] {
    if (!plan.identity) return [];
    const { previous, corrected } = plan.identity;
    return LEGAL_IDENTITY_FIELDS.filter((field) => corrected[field] !== undefined).map(
        (field) =>
            `Corrected as the same legal entity: ${field} ${shown(previous[field] ?? null)} → ` +
            shown(corrected[field] ?? null),
    );
}

function vatIdCheckOf(plan: SubscriberJoinPlan): string {
    if (plan.vatIdCheck === 'adopted') {
        return 'VAT id: the check made for the subscriber joined counts for the number taken over.';
    }
    if (plan.vatIdCheck === 'ended') {
        return 'VAT id: the number changes and no check comes with it; none counts until the next one.';
    }
    return 'VAT id: the number stays, and so does the check that counts for it.';
}

function shown(value: string | boolean | null): string {
    return value === null ? '—' : String(value);
}
