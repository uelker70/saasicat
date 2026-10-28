// `<app> subscribers join`, as an operator runs it: first to see what joining a
// returning customer's subscriber into the one it had would move, then with
// `--apply` to join them, with the second factor and, against production, a
// confirmation.
//
// The join itself is `@saasicat/nest`'s and tested there and in the
// persistence contract. Here it is stood in for, so that a test can tell what
// the command asked for, what it passed on, what it recorded in the audit log,
// what it printed and which exit code a script sees.

// @requirement SC-ADM-027 — An operator joins a returning customer's new tenant to the subscriber it had

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import { SubscriberJoinCliFlow, SubscribersJoinCommand } from '../dist/index.js';
import { cliErrorOf, printed, recordingContext } from './helpers/operator-cli.js';

const OPTIONS = { from: '10234', into: '10045', reason: 'Returning customer, confirmed by phone' };

const SUBSCRIBERS = {
    10234: { id: 'subscriber-new', customerNumber: '10234', legalName: 'Muster GmbH' },
    10045: { id: 'subscriber-old', customerNumber: '10045', legalName: 'Muster GmbH' },
};

/** What the preview decides for the two: a link, a check and a charge move, the city is replaced. */
const DECISION = {
    state: {
        from: {
            subscriber: SUBSCRIBERS[10234],
            links: [{ tenantId: 'muster-neu', linkedAt: new Date(), unlinkedAt: null }],
        },
        into: {
            subscriber: SUBSCRIBERS[10045],
            links: [{ tenantId: 'muster-alt', linkedAt: new Date(), unlinkedAt: new Date() }],
        },
        moving: {},
    },
    plan: {
        moving: {
            subscriber_tenants: 1,
            subscriber_vat_id_checks: 1,
            subscriber_ledger_entries: 2,
        },
        replaced: [{ field: 'city', previous: 'Hamburg', next: 'Berlin' }],
        identity: { previous: { vatId: null }, corrected: { vatId: 'DE123456789' } },
        vatIdCheck: 'adopted',
        paymentMethodsOutOfUse: 1,
    },
    digest: 'f'.repeat(64),
};

const JOIN = {
    id: 'join-1',
    fromSubscriberId: 'subscriber-new',
    intoSubscriberId: 'subscriber-old',
    reason: OPTIONS.reason,
    moved: DECISION.plan.moving,
};

function setUp({ refusal = null } = {}) {
    const calls = [];
    const joins = {
        async subscriberNumbered(customerNumber) {
            calls.push(['numbered', customerNumber]);
            return SUBSCRIBERS[customerNumber] ?? null;
        },
        async preview(fromId, intoId) {
            calls.push(['preview', fromId, intoId]);
            if (refusal) throw refusal;
            return DECISION;
        },
        async join(fromId, intoId, request, joinedBy) {
            calls.push(['join', fromId, intoId, request, joinedBy]);
            if (refusal) throw refusal;
            return { ...DECISION, join: JOIN };
        },
    };
    const ctx = recordingContext();
    return { ctx, calls, flow: new SubscriberJoinCliFlow(ctx, joins) };
}

describe('the preview is the command, and the join the second one', () => {
    test('without --apply it previews the two so numbered, and asks for neither factor nor confirmation', async () => {
        const { flow, calls, ctx } = setUp();

        const decision = await flow.preview(OPTIONS);

        assert.deepEqual(calls, [
            ['numbered', '10234'],
            ['numbered', '10045'],
            ['preview', 'subscriber-new', 'subscriber-old'],
        ]);
        assert.deepEqual(ctx.asked, ['identity', 'super-admin']);
        assert.equal(
            flow.formatPreview(decision),
            [
                '10234 Muster GmbH (tenant muster-neu) would be joined into 10045 Muster GmbH (no live tenant) — nothing is written yet.',
                'Moves: 1 tenant links, 1 checks of the VAT id, 2 charges',
                'Replaced: city Hamburg → Berlin',
                'Corrected as the same legal entity: vatId — → DE123456789',
                'VAT id: the check made for the subscriber joined counts for the number taken over.',
                'The payment method in use at 10045 goes out of use; the one given at sign-up is used from now on.',
                'Joining declares that both are one legal entity, and is not undone.',
                'Run again with --apply to join them.',
            ].join('\n'),
        );
    });

    // @requirement SC-ADM-019 — Early deletion, cancelling an invoice and joining a subscriber need a second factor
    // @requirement SC-ADM-020 — Six actions require a written reason, cancelling an invoice among them
    test('with --apply it asks for the second factor and the confirmation, joins as the operator and records it', async () => {
        const { flow, calls, ctx } = setUp();

        const joined = await flow.apply({ ...OPTIONS, yes: true });

        assert.deepEqual(ctx.asked, [
            'identity',
            'super-admin',
            'second factor of user-ops',
            'confirmed with --yes',
            'audit',
        ]);
        assert.deepEqual(calls.at(-1), [
            'join',
            'subscriber-new',
            'subscriber-old',
            { kind: 'same-entity', reason: OPTIONS.reason },
            'cli:ops@example.com:deploy-host',
        ]);
        assert.deepEqual(
            ctx.logged.map(({ entity, entityId, action, changes }) => ({
                entity,
                entityId,
                action,
                changes,
            })),
            [
                {
                    entity: 'Subscriber',
                    entityId: 'subscriber-old',
                    action: 'SUBSCRIBER_JOINED',
                    changes: {
                        fromSubscriberId: 'subscriber-new',
                        intoSubscriberId: 'subscriber-old',
                        reason: OPTIONS.reason,
                        moved: DECISION.plan.moving,
                    },
                },
            ],
        );
        assert.equal(
            flow.formatJoined(joined),
            [
                'Joined 10234 into 10045 (Muster GmbH): 1 tenant links, 1 checks of the VAT id, 2 charges.',
                'The record of 10234 names 10045 from now on, and takes no change.',
            ].join('\n'),
        );
    });
});

describe('the command is refused', () => {
    test('for a customer number no subscriber has, before anything is previewed', async () => {
        const { flow, calls } = setUp();

        const error = await cliErrorOf(() => flow.preview({ ...OPTIONS, into: '99999' }));

        assert.deepEqual([error.code, error.exitCode], ['SUBSCRIBER_NOT_FOUND', 1]);
        assert.ok(!calls.some(([call]) => call === 'preview'), 'it previewed anyway');
    });

    test('with --apply and no reason, before it asks for anything', async () => {
        const { flow, ctx, calls } = setUp();

        const error = await cliErrorOf(() => flow.apply({ ...OPTIONS, reason: ' ' }));

        assert.deepEqual([error.code, error.exitCode], ['CLI_OPTION_REQUIRED', 1]);
        assert.deepEqual([ctx.asked, calls], [[], []]);
    });

    test('as the platform refuses the join: 6 where the subscribers are not what a join needs, 1 for what was given', async () => {
        const conflict = setUp({
            refusal: new ConflictException({
                code: 'SUBSCRIBER_JOIN_INTO_HAS_LIVE_TENANT',
                message: 'Subscriber 10045 still has a live tenant.',
            }),
        });
        const invalid = setUp({
            refusal: new UnprocessableEntityException({
                code: 'SUBSCRIBER_JOIN_SAME_SUBSCRIBER',
                message: 'A subscriber cannot be joined into itself.',
            }),
        });

        const refused = await cliErrorOf(() => conflict.flow.apply({ ...OPTIONS, yes: true }));
        const wrong = await cliErrorOf(() => invalid.flow.preview(OPTIONS));

        assert.deepEqual(
            [refused.code, refused.exitCode, wrong.code, wrong.exitCode],
            ['SUBSCRIBER_JOIN_INTO_HAS_LIVE_TENANT', 6, 'SUBSCRIBER_JOIN_SAME_SUBSCRIBER', 1],
        );
        assert.ok(!conflict.ctx.asked.includes('audit'), 'a refused join was audited');
    });
});

describe('subscribers join', () => {
    test('prints the preview without --apply, and what was joined with it', async () => {
        const { flow } = setUp();
        const command = new SubscribersJoinCommand(flow);

        const previewed = await printed(command, OPTIONS);
        const joined = await printed(command, { ...OPTIONS, apply: true, yes: true });

        assert.match(previewed, /would be joined into 10045 .* nothing is written yet\./);
        assert.match(joined, /^Joined 10234 into 10045 \(Muster GmbH\)/);
    });
});
