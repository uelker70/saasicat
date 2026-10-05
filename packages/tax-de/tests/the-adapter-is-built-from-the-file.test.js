// The factory an application binds: it carries the name `config/saas.yaml`
// has to give, builds the adapter from the options the file names, and refuses
// an option the adapter does not take rather than ignoring it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { germanTaxAdapterFactory } from '../dist/index.js';

const DOMESTIC = {
    issuer: { country: 'DE', vatId: 'DE123456789' },
    origin: { country: 'DE', business: false, vatId: null, validatedVatId: null },
    period: {
        from: new Date('2026-04-30T22:00:00.000Z'),
        until: new Date('2026-05-31T22:00:00.000Z'),
    },
    timeZone: 'Europe/Berlin',
};

describe('the factory builds the adapter from the file', () => {
    test('carries the name the file has to give', () => {
        assert.equal(germanTaxAdapterFactory().adapterName, '@saasicat/tax-de');
    });

    test('without options the issuer is not a small business', () => {
        const adapter = germanTaxAdapterFactory().create({});
        assert.equal(adapter.decide(DOMESTIC).treatment.kind, 'standard');
        assert.equal(adapter.name, '@saasicat/tax-de');
    });

    test('smallBusiness from the file makes the issuer one', () => {
        const adapter = germanTaxAdapterFactory().create({ smallBusiness: true });
        assert.equal(adapter.decide(DOMESTIC).treatment.kind, 'small-business');
        assert.equal(
            germanTaxAdapterFactory().create({ smallBusiness: false }).decide(DOMESTIC).treatment
                .kind,
            'standard',
        );
    });

    test('an option the adapter does not take is an error naming it, not a default', () => {
        assert.throws(
            () => germanTaxAdapterFactory().create({ smallBusines: true }),
            /names smallBusines/,
        );
        assert.throws(
            () => germanTaxAdapterFactory().create({ viesTimeoutMs: 5000 }),
            /names viesTimeoutMs/,
        );
    });

    test('smallBusiness that is not true or false is an error', () => {
        assert.throws(
            () => germanTaxAdapterFactory().create({ smallBusiness: 'yes' }),
            /true or false/,
        );
    });

    test('what only code can give reaches the adapter', async () => {
        assert.throws(() => germanTaxAdapterFactory({ viesTimeoutMs: 0 }).create({}), RangeError);
        const checkedAt = new Date('2026-10-04T08:30:00.000Z');
        const adapter = germanTaxAdapterFactory({
            now: () => checkedAt,
            fetch: async () =>
                new Response(JSON.stringify({ valid: true, requestIdentifier: 'R1' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
        }).create({});
        const outcome = await adapter.checkVatId('ATU12345678', DOMESTIC.issuer);
        assert.equal(outcome.completed, true);
        assert.equal(outcome.check.checkedAt.getTime(), checkedAt.getTime());
    });
});
