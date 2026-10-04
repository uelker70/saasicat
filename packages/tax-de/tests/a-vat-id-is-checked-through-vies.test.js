// The check of a VAT identification number through VIES, against a local
// server that answers the way VIES does: HTTP 200 for a number found valid or
// invalid, and for a failure too, which says so in its body. The adapter's own
// fetch reaches it, so the timeout and a refused connection run for real.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { GermanTaxAdapter } from '../dist/index.js';

const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
const CHECKED_AT = new Date('2026-10-04T08:30:00.000Z');
const ISSUER = { country: 'DE', vatId: 'DE123456789' };

/**
 * What the next request is answered with: a status and a body, or no answer at
 * all. With `bodyAfterMs` the headers go out at once and the body that long
 * after them — `null` for a body that never follows.
 */
let answer = { status: 200, body: {} };
const received = [];
/** When the server last finished sending a body. */
let bodySentAt = null;
const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
        received.push({ method: request.method, body: JSON.parse(body) });
        if (answer === 'never') return;
        const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
        response.writeHead(answer.status, { 'content-type': 'application/json' });
        const finish = () => {
            bodySentAt = Date.now();
            response.end(text);
        };
        if (answer.bodyAfterMs === undefined) return finish();
        response.flushHeaders();
        if (answer.bodyAfterMs !== null) setTimeout(finish, answer.bodyAfterMs);
    });
});
let local;

before(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    local = `http://127.0.0.1:${server.address().port}/`;
});
after(() => {
    server.closeAllConnections();
    server.close();
});

/** An adapter whose fetch sends what it would send to VIES to the local server. */
function adapterAnswering(next, options = {}) {
    answer = next;
    received.length = 0;
    const calledWith = [];
    const adapter = new GermanTaxAdapter({
        now: () => CHECKED_AT,
        fetch: (url, init) => {
            calledWith.push(url);
            return fetch(options.target ?? local, init);
        },
        ...options.adapter,
    });
    return { adapter, calledWith };
}

const VALID = {
    countryCode: 'AT',
    vatNumber: 'U12345678',
    requestDate: '2026-10-04T08:29:59.512Z',
    valid: true,
    requestIdentifier: 'WAPIAAAAZ1x2y3',
    name: 'Wien Handel GmbH',
    address: 'Ringstrasse 1, 1010 Wien',
    traderNameMatch: 'NOT_PROCESSED',
};

// @requirement SC-PRIC-064 — The German tax adapter decides Germany, businesses abroad and small businesses
describe('the request names the number, and the issuer as requester where it has a number', () => {
    test('with the number of the issuer: prefix and rest of both', async () => {
        const { adapter, calledWith } = adapterAnswering({ status: 200, body: VALID });
        await adapter.checkVatId('ATU12345678', ISSUER);
        assert.deepEqual(calledWith, [VIES_URL]);
        assert.deepEqual(received, [
            {
                method: 'POST',
                body: {
                    countryCode: 'AT',
                    vatNumber: 'U12345678',
                    requesterMemberStateCode: 'DE',
                    requesterNumber: '123456789',
                },
            },
        ]);
    });

    test('without one: the number alone', async () => {
        const { adapter } = adapterAnswering({ status: 200, body: VALID });
        await adapter.checkVatId('ATU12345678', { country: 'DE', vatId: null });
        assert.deepEqual(received[0].body, { countryCode: 'AT', vatNumber: 'U12345678' });
    });
});

// @requirement SC-PRIC-040 — A tax identifier is validated before a tax treatment depends on it
describe('an answer about the number is a completed check, kept as the service sent it', () => {
    test('found valid, with the request identifier that confirms it', async () => {
        const { adapter } = adapterAnswering({ status: 200, body: VALID });
        const outcome = await adapter.checkVatId('ATU12345678', ISSUER);
        assert.deepEqual(outcome, {
            completed: true,
            check: {
                vatId: 'ATU12345678',
                checkedAt: CHECKED_AT,
                valid: true,
                service: 'VIES',
                confirmation: {
                    countryCode: 'AT',
                    vatNumber: 'U12345678',
                    requestDate: '2026-10-04T08:29:59.512Z',
                    requestIdentifier: 'WAPIAAAAZ1x2y3',
                    name: 'Wien Handel GmbH',
                    address: 'Ringstrasse 1, 1010 Wien',
                    traderNameMatch: 'NOT_PROCESSED',
                },
            },
        });
    });

    test('dated when the whole answer has arrived, not when its headers did', async () => {
        const { adapter } = adapterAnswering(
            { status: 200, body: VALID, bodyAfterMs: 300 },
            { adapter: { now: () => new Date() } },
        );
        const outcome = await adapter.checkVatId('ATU12345678', ISSUER);
        assert.equal(outcome.completed, true);
        assert.ok(
            outcome.check.checkedAt.getTime() >= bodySentAt,
            `dated ${outcome.check.checkedAt.toISOString()}, before the body went out at ${new Date(bodySentAt).toISOString()}`,
        );
    });

    test('found invalid', async () => {
        const { adapter } = adapterAnswering({
            status: 200,
            body: { ...VALID, valid: false, requestIdentifier: '', name: '---', address: '---' },
        });
        const outcome = await adapter.checkVatId('ATU12345678', ISSUER);
        assert.equal(outcome.completed, true);
        assert.equal(outcome.check.valid, false);
        assert.equal(outcome.check.confirmation.name, '---');
    });

    test('a number VIES cannot read as one is found invalid', async () => {
        const { adapter } = adapterAnswering({
            status: 200,
            body: { actionSucceed: false, errorWrappers: [{ error: 'INVALID_INPUT' }] },
        });
        assert.deepEqual(await adapter.checkVatId('XX123', ISSUER), {
            completed: true,
            check: {
                vatId: 'XX123',
                checkedAt: CHECKED_AT,
                valid: false,
                service: 'VIES',
                confirmation: { error: 'INVALID_INPUT' },
            },
        });
    });
});

/** The reason of a check that did not complete, or a failure naming what came back instead. */
function notCompleted(outcome) {
    assert.equal(outcome.completed, false, `completed: ${JSON.stringify(outcome)}`);
    return outcome.reason;
}

// @requirement SC-PRIC-040 — A tax identifier is validated before a tax treatment depends on it
describe('no answer about the number is a check that did not complete, never a valid one', () => {
    test('a failure VIES reports, such as a member state that cannot answer', async () => {
        const { adapter } = adapterAnswering({
            status: 200,
            body: { actionSucceed: false, errorWrappers: [{ error: 'MS_UNAVAILABLE' }] },
        });
        assert.match(
            notCompleted(await adapter.checkVatId('ATU12345678', ISSUER)),
            /MS_UNAVAILABLE/,
        );
    });

    test('a failure without an error code', async () => {
        const { adapter } = adapterAnswering({ status: 200, body: { actionSucceed: false } });
        assert.match(
            notCompleted(await adapter.checkVatId('ATU12345678', ISSUER)),
            /no error code/,
        );
    });

    test('an HTTP error', async () => {
        const { adapter } = adapterAnswering({ status: 500, body: VALID });
        assert.match(notCompleted(await adapter.checkVatId('ATU12345678', ISSUER)), /HTTP 500/);
    });

    test('a body that is not JSON, or JSON that says nothing about validity', async () => {
        const { adapter } = adapterAnswering({ status: 200, body: '<html>maintenance</html>' });
        assert.match(notCompleted(await adapter.checkVatId('ATU12345678', ISSUER)), /cannot read/);
        const second = adapterAnswering({ status: 200, body: { countryCode: 'AT' } });
        assert.match(
            notCompleted(await second.adapter.checkVatId('ATU12345678', ISSUER)),
            /cannot read/,
        );
    });

    test('no answer within the time allowed', async () => {
        const { adapter } = adapterAnswering('never', { adapter: { viesTimeoutMs: 100 } });
        assert.match(
            notCompleted(await adapter.checkVatId('ATU12345678', ISSUER)),
            /within 100 ms/,
        );
    });

    test('headers within the time allowed, but no body', async () => {
        const { adapter } = adapterAnswering(
            { status: 200, body: VALID, bodyAfterMs: null },
            { adapter: { viesTimeoutMs: 100 } },
        );
        assert.match(
            notCompleted(await adapter.checkVatId('ATU12345678', ISSUER)),
            /within 100 ms/,
        );
    });

    test('a service that cannot be reached', async () => {
        const { adapter } = adapterAnswering(
            { status: 200, body: VALID },
            { target: 'http://127.0.0.1:1/' },
        );
        assert.match(
            notCompleted(await adapter.checkVatId('ATU12345678', ISSUER)),
            /could not be reached/,
        );
    });
});

describe('the adapter is configured once', () => {
    test('a VIES timeout is a whole number of milliseconds above zero', () => {
        for (const viesTimeoutMs of [0, -1, 1.5]) {
            assert.throws(
                () => new GermanTaxAdapter({ viesTimeoutMs }),
                RangeError,
                String(viesTimeoutMs),
            );
        }
        assert.doesNotThrow(() => new GermanTaxAdapter({ viesTimeoutMs: 1 }));
    });
});
