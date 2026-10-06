// The operator corrects a tenant's subscriber in the administration: its legal
// identity and its business status, each with a reason, and checks its VAT
// number again. Asked through the platform as an application composes it, so
// what is asserted is what the routes do — the record they leave, the audit
// entry they write, the frame they run in and the subscriber they answer.
// That the two corrections ask for the second factor is held by
// `lasting-operator-actions-require-the-second-factor.test.js`, which walks
// every route the platform mounts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { BILLING_ERROR_CODES } from '@saasicat/core';

import { aPlatform } from './helpers/operator-subscriber-platform.js';

const IDENTITY_ROUTE = 'POST admin/tenants/:slug/subscriber/identity';
const BUSINESS_ROUTE = 'POST admin/tenants/:slug/subscriber/business-status';
const CHECK_ROUTE = 'POST admin/tenants/:slug/subscriber/vat-id-check';
const HISTORY_ROUTE = 'GET admin/tenants/:slug/subscriber/history';

/** The operator's request, as the application's guards leave it. */
const REQUEST = { user: { sub: 'op-1', email: 'anna@ops.example' }, headers: {} };
/** Who the records name, derived from the request as the audit log derives it. */
const ANNA = 'web:anna@ops.example:admin';

const invalidAnswer = (vatId) => ({
    completed: true,
    check: { vatId, checkedAt: new Date(), valid: false, service: 'VIES', confirmation: {} },
});
const unreachable = () => ({ completed: false, reason: 'VIES timed out after 10 s.' });

/** The platform, with the operator's routes as functions. */
async function anAdministration(options) {
    const platform = await aPlatform(options);
    return {
        ...platform,
        correct: (slug, body) => platform.call(IDENTITY_ROUTE)(slug, body, REQUEST),
        changeBusiness: (slug, body) => platform.call(BUSINESS_ROUTE)(slug, body, REQUEST),
        check: (slug) => platform.call(CHECK_ROUTE)(slug, REQUEST),
        history: async (slug) => (await platform.call(HISTORY_ROUTE)(slug)).entries,
        auditedActions: () => platform.seen.audited.map((entry) => entry.action),
    };
}

const refusedWith = (code) => (error) => error.getResponse?.().code === code;

// @requirement SC-SUB-041 — The operator corrects a subscriber's identity and business status, with a reason
describe("the operator corrects a subscriber's legal identity", () => {
    test('the corrected values are what the subscriber now shows, recorded with who and why, and audited', async () => {
        const admin = await anAdministration();

        const { subscriber, vatIdCheck } = await admin.correct('northwind', {
            kind: 'correction',
            legalName: 'Northwind Handel GmbH',
            taxNumber: '12/345/67890',
            reason: 'Name as registered in the trade register',
        });

        assert.deepEqual(
            [subscriber.subscriber.legalName, subscriber.subscriber.taxNumber],
            ['Northwind Handel GmbH', '12/345/67890'],
        );
        assert.equal(vatIdCheck, null, 'no number moved, so none was checked');
        assert.deepEqual(admin.seen.checked, []);
        const [entry] = await admin.history('northwind');
        assert.deepEqual(
            [entry.kind, entry.by, entry.reason, entry.corrected],
            [
                'identity-corrected',
                ANNA,
                'Name as registered in the trade register',
                { legalName: 'Northwind Handel GmbH', taxNumber: '12/345/67890' },
            ],
        );
        assert.deepEqual(admin.auditedActions(), ['SUBSCRIBER_IDENTITY_CORRECTED']);
        assert.deepEqual(admin.seen.audited[0].changes, {
            tenantId: 't-northwind',
            fields: ['legalName', 'taxNumber'],
            reason: 'Name as registered in the trade register',
            actor: ANNA,
        });
    });

    // @requirement SC-PRIC-071 — A VAT number the operator corrects or checks is checked, and every outcome kept
    test('a VAT number it gives is checked right after, and a valid answer releases the next contract', async () => {
        const admin = await anAdministration();

        const { subscriber, vatIdCheck } = await admin.correct('contoso', {
            kind: 'correction',
            vatId: 'fr 123 456 789 01',
            reason: 'Customer handed in its VAT number',
        });

        assert.deepEqual(admin.seen.checked, [{ vatId: 'FR12345678901', bypassed: true }]);
        assert.deepEqual(
            [vatIdCheck.completed, vatIdCheck.valid, vatIdCheck.counts, vatIdCheck.service],
            [true, true, true, 'VIES'],
        );
        assert.deepEqual(
            [subscriber.subscriber.vatId, subscriber.subscriber.vatIdValidated],
            ['FR12345678901', true],
        );
    });

    // @requirement SC-PRIC-071 — A VAT number the operator corrects or checks is checked, and every outcome kept
    for (const [answered, answer, expected] of [
        ['invalid', invalidAnswer, { completed: true, valid: false }],
        ['not answered', unreachable, { completed: false, reason: 'VIES timed out after 10 s.' }],
    ]) {
        test(`a number the service found ${answered} is kept, and so is the hold on the next contract`, async () => {
            const admin = await anAdministration({ checkVatId: answer });

            const { subscriber, vatIdCheck } = await admin.correct('wien', {
                kind: 'correction',
                vatId: 'ATU99999999',
                reason: 'Customer gave a new number',
            });

            assert.equal(subscriber.subscriber.vatId, 'ATU99999999');
            assert.equal(subscriber.subscriber.vatIdValidated, false);
            assert.equal(subscriber.readiness.taxRefusal, 'No validated VAT number.');
            for (const [key, value] of Object.entries(expected)) {
                assert.equal(vatIdCheck[key], value, key);
            }
        });
    }

    test('declared as another legal entity taking over, it is refused, nothing changes and nothing is audited', async () => {
        const admin = await anAdministration();

        await assert.rejects(
            admin.correct('northwind', {
                kind: 'takeover',
                legalName: 'Käufer AG',
                reason: 'Sold',
            }),
            refusedWith('SUBSCRIBER_TAKEOVER_IS_A_TRANSFER'),
        );
        assert.equal(
            (await admin.subscriberOf('northwind')).subscriber.legalName,
            'Northwind GmbH',
        );
        assert.deepEqual(admin.auditedActions(), []);
    });

    test('that changes nothing is refused as such', async () => {
        const admin = await anAdministration();

        await assert.rejects(
            admin.correct('northwind', {
                kind: 'correction',
                legalName: 'Northwind GmbH',
                reason: 'Checked against the register',
            }),
            refusedWith('SUBSCRIBER_CORRECTION_CHANGES_NOTHING'),
        );
    });

    test('where no tax adapter decides, a VAT number is corrected and not checked', async () => {
        const admin = await anAdministration({ adapter: false });

        const { subscriber, vatIdCheck } = await admin.correct('northwind', {
            kind: 'correction',
            vatId: 'DE123456789',
            reason: 'Customer handed in its VAT number',
        });

        assert.equal(subscriber.subscriber.vatId, 'DE123456789');
        assert.equal(vatIdCheck, null);
        assert.deepEqual(admin.seen.checked, []);
    });
});

// @requirement SC-SUB-041 — The operator corrects a subscriber's identity and business status, with a reason
describe('the operator changes whether a subscriber acts as a business', () => {
    test('with a reason it is recorded, answered as it now stands, and audited', async () => {
        const admin = await anAdministration();

        const { subscriber, vatIdCheck } = await admin.changeBusiness('contoso', {
            business: true,
            reason: 'Trade register extract handed in',
        });

        assert.equal(subscriber.subscriber.business, true);
        assert.equal(vatIdCheck, null);
        assert.equal(
            subscriber.readiness.taxRefusal,
            'No validated VAT number.',
            'a business elsewhere in the Union now needs its number checked',
        );
        const [entry] = await admin.history('contoso');
        assert.deepEqual(
            [entry.kind, entry.changed, entry.previous, entry.reason, entry.by],
            [
                'tax-origin-changed',
                { business: true },
                { business: false },
                'Trade register extract handed in',
                ANNA,
            ],
        );
        assert.deepEqual(admin.auditedActions(), ['SUBSCRIBER_BUSINESS_STATUS_CHANGED']);
    });

    test('to the status it has, nothing is recorded and nothing audited', async () => {
        const admin = await anAdministration();

        await admin.changeBusiness('contoso', { business: false, reason: 'Checked again' });

        assert.deepEqual(await admin.history('contoso'), []);
        assert.deepEqual(admin.auditedActions(), []);
    });

    test('without a reason it is refused', async () => {
        const admin = await anAdministration();

        await assert.rejects(
            admin.changeBusiness('contoso', { business: true, reason: '  ' }),
            refusedWith('SUBSCRIBER_BUSINESS_STATUS_REASON_REQUIRED'),
        );
        assert.equal((await admin.subscriberOf('contoso')).subscriber.business, false);
    });
});

// @requirement SC-PRIC-071 — A VAT number the operator corrects or checks is checked, and every outcome kept
describe('the operator checks the VAT number held, again', () => {
    test('the answer is recorded, counts for the number, and is audited', async () => {
        const admin = await anAdministration();

        const { subscriber, vatIdCheck } = await admin.check('wien');

        assert.deepEqual(admin.seen.checked, [{ vatId: 'ATU12345678', bypassed: true }]);
        assert.deepEqual(
            [vatIdCheck.completed, vatIdCheck.valid, vatIdCheck.counts],
            [true, true, true],
        );
        assert.equal(subscriber.subscriber.vatIdValidated, true);
        assert.deepEqual(admin.auditedActions(), ['SUBSCRIBER_VAT_ID_CHECKED']);
        assert.deepEqual(admin.seen.audited[0].changes, {
            tenantId: 't-wien',
            completed: true,
            valid: true,
            actor: ANNA,
        });
    });

    test('an answer that did not come is said, and the earlier valid check still counts', async () => {
        const admin = await anAdministration({ checkVatId: unreachable });

        const { subscriber, vatIdCheck } = await admin.check('wien');

        assert.deepEqual(vatIdCheck, { completed: false, reason: 'VIES timed out after 10 s.' });
        assert.equal(subscriber.subscriber.vatIdValidated, true);
    });

    test('a subscriber without a number has none to check', async () => {
        const admin = await anAdministration();

        await assert.rejects(admin.check('northwind'), refusedWith('SUBSCRIBER_VAT_ID_MISSING'));
        assert.deepEqual(admin.seen.checked, []);
    });

    test('without a tax adapter there is no service to check with', async () => {
        const admin = await anAdministration({ adapter: false });

        await assert.rejects(admin.check('wien'), refusedWith('TAX_VAT_ID_CHECK_NOT_AVAILABLE'));
    });
});

// @requirement SC-ADM-032 — The operator reads a subscriber's history, with who, when and why
describe("the subscriber's history", () => {
    test('names each correction, change and check once, the latest first, with who and why', async () => {
        const admin = await anAdministration();
        const wien = await admin.repo.findByTenantId('t-wien');
        await admin.repo.updateContact(wien.id, { country: 'DE' }, 'web:owner@wien.example:tenant');
        await admin.changeBusiness('wien', { business: false, reason: 'Sole trader, no company' });
        await admin.correct('wien', {
            kind: 'correction',
            vatId: 'DE987654321',
            reason: 'German number after the move',
        });

        const entries = await admin.history('wien');

        assert.deepEqual(
            entries.map((entry) => [entry.kind, entry.reason ?? null, entry.counts ?? null]),
            [
                ['vat-id-checked', null, true],
                ['identity-corrected', 'German number after the move', null],
                ['tax-origin-changed', 'Sole trader, no company', null],
                ['tax-origin-changed', null, null],
                ['vat-id-checked', null, false],
            ],
            'the change of the number is named once, as its correction',
        );
        assert.deepEqual(
            entries.filter((entry) => entry.kind === 'vat-id-checked').map((entry) => entry.vatId),
            ['DE987654321', 'ATU12345678'],
        );
        for (const entry of entries) assert.ok(!Number.isNaN(Date.parse(entry.at)), entry.at);
    });

    test('a tenant without a subscriber has none', async () => {
        const admin = await anAdministration();

        assert.deepEqual(await admin.history('empty'), []);
    });
});

describe('every subscriber route', () => {
    for (const [what, act] of [
        [
            'a correction',
            (admin, slug) =>
                admin.correct(slug, { kind: 'correction', legalName: 'X', reason: 'Why' }),
        ],
        [
            'a change of business status',
            (admin, slug) => admin.changeBusiness(slug, { business: true, reason: 'Why' }),
        ],
        ['a check', (admin, slug) => admin.check(slug)],
    ]) {
        test(`${what}: an unknown tenant is not found, by code, and a tenant without a subscriber has none to correct`, async () => {
            const admin = await anAdministration();

            await assert.rejects(
                act(admin, 'nowhere'),
                (error) =>
                    error instanceof NotFoundException &&
                    error.getResponse().code === BILLING_ERROR_CODES.TENANT_NOT_FOUND,
            );
            await assert.rejects(act(admin, 'empty'), refusedWith('SUBSCRIBER_REQUIRED'));
            assert.deepEqual(admin.auditedActions(), []);
        });

        // @requirement SC-SEC-015 — An operator's route runs across tenants, and no other route does
        test(`${what}: the tenant is found and its subscriber read outside the tenants' row-level policy`, async () => {
            const admin = await anAdministration();

            await act(admin, 'wien');

            assert.ok(admin.seen.lookups.length > 0);
            assert.ok(admin.seen.lookups.every(({ bypassed }) => bypassed));
            assert.ok(admin.seen.reads.every(({ bypassed }) => bypassed));
        });
    }

    // @requirement SC-ADM-015 — The administration only offers what the application actually has
    test('the corrections are announced beside the subscriber view, and only there', async () => {
        const served = await anAdministration();
        const without = await anAdministration({ subscribers: false });

        assert.equal(served.manifest.capabilities['subscribers.correct'], true);
        assert.equal(without.manifest.capabilities['subscribers.correct'], undefined);
        assert.equal(without.served(IDENTITY_ROUTE), undefined);
    });
});

/** A request body, as the application's global `ValidationPipe` hands it to the route. */
async function throughThePipe(route, body) {
    const admin = await anAdministration();
    const served = admin.served(route);
    const [, metatype] = Reflect.getMetadata(
        'design:paramtypes',
        served.controller.prototype,
        served.name,
    );
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    return pipe.transform(body, { type: 'body', metatype });
}

describe('what the correction routes take', () => {
    test('a correction declares what it is, states a reason, and may clear a tax identifier', async () => {
        const taken = await throughThePipe(IDENTITY_ROUTE, {
            kind: 'correction',
            vatId: null,
            reason: 'Number withdrawn',
            customerNumber: 'K-99999',
        });
        // What reaches the route: the fields sent, a field left out unset, the unknown one stripped.
        assert.deepEqual(JSON.parse(JSON.stringify(taken)), {
            kind: 'correction',
            vatId: null,
            reason: 'Number withdrawn',
        });

        for (const body of [
            { vatId: 'ATU12345678', reason: 'Why' },
            { kind: 'merger', reason: 'Why' },
            { kind: 'correction', legalName: 'X' },
            { kind: 'correction', legalName: 'X', reason: 'x'.repeat(501) },
            { kind: 'correction', vatId: 42, reason: 'Why' },
        ]) {
            await assert.rejects(
                throughThePipe(IDENTITY_ROUTE, body),
                BadRequestException,
                JSON.stringify(body),
            );
        }
        await throughThePipe(IDENTITY_ROUTE, {
            kind: 'correction',
            legalName: 'X',
            reason: 'x'.repeat(500),
        });
    });

    test('a change of business status says yes, no or not stated, and why', async () => {
        for (const business of [true, false, null]) {
            await throughThePipe(BUSINESS_ROUTE, { business, reason: 'Why' });
        }
        for (const body of [
            { business: 'yes', reason: 'Why' },
            { reason: 'Why' },
            { business: true },
        ]) {
            await assert.rejects(
                throughThePipe(BUSINESS_ROUTE, body),
                BadRequestException,
                JSON.stringify(body),
            );
        }
    });
});
