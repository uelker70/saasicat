// What the start check of joining subscribers asks of the database: a trigger
// on every table that names a subscriber, and one on the subscribers' own,
// each named where it does not fire.

// @requirement SC-ADM-050 — A join moves everything in one step, and a subscriber joined is given nothing afterwards

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SUBSCRIBER_JOIN_ROW_GUARD,
    subscriberJoinGuardOf,
    subscriberJoinProtectionProblem,
} from '../dist/index.js';

const TABLES = ['subscriber_tenants', 'subscriber_payments'];

/** The enabled triggers of a database that has every guard but those of `without`. */
const enabledWithout =
    (...without) =>
    (table) => {
        const guard =
            table === SUBSCRIBER_JOIN_ROW_GUARD.table
                ? SUBSCRIBER_JOIN_ROW_GUARD.trigger
                : subscriberJoinGuardOf(table);
        return without.includes(table) ? ['an_unrelated_trigger'] : [guard, 'an_unrelated_trigger'];
    };

test('nothing is named where every trigger fires', () => {
    assert.equal(subscriberJoinProtectionProblem(TABLES, enabledWithout()), null);
});

test("the subscribers' own table is named where its trigger does not fire", () => {
    const problem = subscriberJoinProtectionProblem(TABLES, enabledWithout('subscribers'));

    assert.ok(problem?.startsWith('subscribers lacks its trigger, which refuses'), problem);
});

test('every table whose trigger does not fire is named, the subscribers first', () => {
    const problem = subscriberJoinProtectionProblem(
        TABLES,
        enabledWithout('subscriber_payments', 'subscribers'),
    );

    assert.ok(
        problem?.startsWith('subscribers, subscriber_payments lack their triggers, which refuse'),
        problem,
    );
});
