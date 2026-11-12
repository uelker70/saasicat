// What a tenant's users may do follows from the open reasons it is held back
// for, and nothing else: the strictest of them applies, and lifting one leaves
// the others standing. Pure, so every state and every request is asked here
// rather than through a database.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    KINDS_HOLDING_EVERYONE_BACK,
    holdsEveryoneBack,
    requestWrites,
    tenantAccessOf,
    tenantAccessRefusal,
    toTenantAccessHold,
} from '../dist/index.js';

const SINCE = new Date('2026-11-02T08:30:00.000Z');
const LIFTED = new Date('2026-11-05T16:45:00.000Z');

let ids = 0;
const hold = (kind, overrides = {}) => ({
    id: `hold-${++ids}`,
    tenantId: 't-1',
    kind,
    reference: kind === 'suspended' ? null : `ref-${ids}`,
    note: null,
    since: SINCE,
    recordedBy: 'web:ops@example.com:s1',
    liftedAt: null,
    liftedBy: null,
    ...overrides,
});
const stateOf = (...holds) => tenantAccessOf(holds).state;

// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave
describe('the strictest open reason decides the state', () => {
    test('no reason leaves the tenant open', () => {
        assert.deepEqual(tenantAccessOf([]), { state: 'open', holds: [] });
    });

    test('each reason on its own puts the tenant where it belongs', () => {
        assert.equal(stateOf(hold('overdue')), 'read-only');
        assert.equal(stateOf(hold('ended')), 'read-only');
        assert.equal(stateOf(hold('suspended')), 'suspended');
        assert.equal(stateOf(hold('deleting')), 'deleting');
    });

    test('a deletion before a suspension, a suspension before read-only', () => {
        assert.equal(stateOf(hold('overdue'), hold('suspended')), 'suspended');
        assert.equal(stateOf(hold('suspended'), hold('overdue')), 'suspended');
        assert.equal(stateOf(hold('suspended'), hold('deleting'), hold('ended')), 'deleting');
    });

    test('lifting one reason lifts only that one', () => {
        const paid = hold('overdue', { liftedAt: LIFTED, liftedBy: 'run:collection' });
        const access = tenantAccessOf([paid, hold('suspended')]);
        assert.equal(access.state, 'suspended');
        assert.deepEqual(
            access.holds.map((open) => open.kind),
            ['suspended'],
            'a lifted reason is not among the open ones',
        );
        assert.equal(stateOf(paid), 'open');
    });
});

// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave
describe('a request writes by its method, unless its route says otherwise', () => {
    test('GET, HEAD and OPTIONS read, in any case', () => {
        for (const method of ['GET', 'HEAD', 'OPTIONS', 'get', 'Head']) {
            assert.equal(requestWrites(method, null), false, method);
        }
    });

    test('every other method writes', () => {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'PROPFIND']) {
            assert.equal(requestWrites(method, null), true, method);
        }
    });

    test('a mark wins over the method, both ways', () => {
        assert.equal(requestWrites('POST', 'writes-nothing'), false);
        assert.equal(requestWrites('GET', 'writes'), true);
        assert.equal(requestWrites('POST', 'writes'), true);
        assert.equal(requestWrites('GET', 'writes-nothing'), false);
    });

    test('replacing the payment method is a write, whatever the method', () => {
        assert.equal(requestWrites('GET', 'starts-payment'), true);
        assert.equal(requestWrites('POST', 'starts-payment'), true);
    });

    test('leaving is a write, whatever the method', () => {
        assert.equal(requestWrites('GET', 'leaves'), true);
        assert.equal(requestWrites('DELETE', 'leaves'), true);
    });

    // @requirement SC-ADM-054 — A tenant's users read why it is held back
    test("reading the tenant's own state is a read, whatever the method", () => {
        assert.equal(requestWrites('GET', 'reads-its-state'), false);
        assert.equal(requestWrites('POST', 'reads-its-state'), false);
    });
});

// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave
describe('who is refused, and for what', () => {
    const refusalOf = (holds, writes, actor) =>
        tenantAccessRefusal(tenantAccessOf(holds), writes, actor);

    test('an open tenant is refused nothing', () => {
        assert.equal(refusalOf([], false), null);
        assert.equal(refusalOf([], true), null);
    });

    test('read-only refuses a write and lets a read through', () => {
        assert.equal(refusalOf([hold('overdue')], false), null);
        assert.equal(refusalOf([hold('overdue')], true), 'read-only');
    });

    test('a suspension refuses reading as well', () => {
        assert.equal(refusalOf([hold('suspended')], false), 'suspended');
        assert.equal(refusalOf([hold('suspended')], true), 'suspended');
    });

    test('the operator acting as the tenant is held back only by a deletion', () => {
        const operator = { actingAsOperator: true };
        assert.equal(refusalOf([hold('suspended')], true, operator), null);
        assert.equal(refusalOf([hold('overdue')], true, operator), null);
        assert.equal(refusalOf([hold('deleting')], false, operator), 'deleting');
        assert.equal(refusalOf([hold('deleting'), hold('suspended')], false, operator), 'deleting');
    });
});

describe('a stored reason is read back only as a kind the platform knows', () => {
    test('a known kind comes back as written', () => {
        const row = { ...hold('ended'), createdAt: SINCE };
        assert.deepEqual(
            toTenantAccessHold(row),
            hold('ended', { id: row.id, reference: row.reference }),
        );
    });

    test('an unknown kind is refused rather than read as some other one', () => {
        assert.throws(
            () => toTenantAccessHold({ ...hold('suspended'), kind: 'paused' }),
            /kind 'paused', which is none of suspended, overdue, ended, deleting/,
        );
    });
});

describe('which reasons stop everybody, reading included', () => {
    test('exactly the kinds whose state holds everybody back', () => {
        // Derived from the state each kind puts a tenant in, so the list and
        // the order of strictness cannot say different things.
        for (const kind of ['suspended', 'overdue', 'ended', 'deleting']) {
            assert.equal(
                KINDS_HOLDING_EVERYONE_BACK.includes(kind),
                holdsEveryoneBack(tenantAccessOf([hold(kind)]).state),
                kind,
            );
        }
        assert.equal(holdsEveryoneBack('open'), false);
        assert.equal(holdsEveryoneBack('read-only'), false);
    });
});
