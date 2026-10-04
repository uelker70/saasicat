// Where an installation's rate comes from: the file's `vatRate`, or the tax
// adapter the file names under `tax` and the application binds by its factory
// — one of the two, never both and never neither — and the time zone its days
// count in. Each refusal names the line to change, and a misconfiguration stops
// the start rather than the first customer's contract.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import {
    PlanCatalogModule,
    PlanCatalogValidationError,
    TAX_TREATMENTS_TOKEN,
    loadPlanCatalogFromString,
} from '../dist/billing/index.js';

const BASE = `
schemaVersion: 1
app: { name: Demo App }
currency: EUR
tenantBilling:
  cancellationNoticeDays: { monthly: 0, yearly: 0 }
  selfServiceBlockedPlans: { asTarget: [], asSource: [] }
  orderlyRetirement: { termsConfirmed: false }
issuer: { legalName: Example GmbH, country: DE, vatId: DE123456789 }
plans:
  - { id: BASIC, name: Basic, monthlyNet: 10, yearlyNet: 100, features: [], quotas: { users: 1 } }
`;
const TAX = 'tax: { adapter: test-tax, options: { smallBusiness: false } }\n';
const ZONE = 'timeZone: Europe/Berlin\n';

const load = (extra, opts = {}) =>
    loadPlanCatalogFromString(BASE + extra, { source: 'saas.yaml', ...opts });

/** The lines a refusal names, as `field: message`. */
function refusal(fn) {
    try {
        fn();
    } catch (error) {
        assert.ok(error instanceof PlanCatalogValidationError, String(error));
        return error.message;
    }
    assert.fail('the file loaded');
}

/** A test adapter: 19 % in Germany, every other case not supported. */
function testAdapter(name = 'test-tax') {
    return {
        name,
        version: '2.1.0',
        decide: ({ origin }) =>
            origin.country === 'DE'
                ? {
                      supported: true,
                      treatment: {
                          kind: 'standard',
                          rate: 19,
                          note: null,
                          adapter: { name, version: '2.1.0' },
                      },
                  }
                : { supported: false, reason: `nothing decided for ${origin.country}` },
        checkVatId: async () => ({ completed: false, reason: 'not asked' }),
    };
}

const factoryOf = (adapter = testAdapter(), adapterName = 'test-tax') => ({
    adapterName,
    create: () => adapter,
});

/** Boots the catalogue alone and answers its TaxTreatments, or the start's error. */
async function bootWith(catalog, taxAdapter) {
    const moduleRef = await Test.createTestingModule({
        imports: [PlanCatalogModule.forRootWithCatalog(catalog, { taxAdapter })],
    }).compile();
    return moduleRef.get(TAX_TREATMENTS_TOKEN);
}

// @requirement SC-PRIC-066 — An installation sells in one currency, and its rate comes from one source named once
describe('a file names its rate or its tax adapter, one of the two', () => {
    test('vatRate alone loads, as it always did', () => {
        assert.equal(load('vatRate: 19\n').vatRate, 19);
    });

    test('tax with a time zone loads, without vatRate', () => {
        const catalog = load(TAX + ZONE);
        assert.equal(catalog.tax.adapter, 'test-tax');
        assert.equal(catalog.vatRate, undefined);
    });

    test('both are refused, naming the vatRate line', () => {
        assert.match(
            refusal(() => load('vatRate: 19\n' + TAX + ZONE)),
            /vatRate: is not allowed beside `tax`/,
        );
    });

    test('neither is refused, naming vatRate as Ajv did while it was required', () => {
        assert.match(
            refusal(() => load('')),
            /vatRate: must have required property 'vatRate'/,
        );
    });

    test('tax without a time zone is refused, naming timeZone', () => {
        assert.match(
            refusal(() => load(TAX)),
            /timeZone/,
        );
    });

    test('a time zone the runtime does not know is refused, naming it', () => {
        assert.match(
            refusal(() => load(TAX + 'timeZone: Mars/Olympus_Mons\n')),
            /timeZone: names no time zone/,
        );
    });

    test('the refusals hold when the caller skips the cross-field checks', () => {
        assert.match(
            refusal(() => load('vatRate: 19\n' + TAX + ZONE, { crossFieldChecks: false })),
            /vatRate: is not allowed/,
        );
    });
});

// @requirement SC-PRIC-066 — An installation sells in one currency, and its rate comes from one source named once
describe('the bound adapter is the one the file names, and it can decide', () => {
    test('a file with vatRate and no bound adapter takes the file rate', async () => {
        const taxes = await bootWith(load('vatRate: 7\n'));
        assert.equal(taxes.adapter, null);
        assert.deepEqual(taxes.shown(new Date(), 'MONTHLY'), { rate: 7, treatment: null });
    });

    test('a file naming tax with the factory bound shows the adapter rate for the issuer country', async () => {
        const taxes = await bootWith(load(TAX + ZONE), factoryOf());
        assert.deepEqual(taxes.adapter, { name: 'test-tax', version: '2.1.0' });
        const shown = taxes.shown(new Date('2026-05-01T00:00:00Z'), 'monthly');
        assert.equal(shown.rate, 19);
        assert.equal(shown.treatment.kind, 'standard');
    });

    const refusals = [
        [
            'the file names an adapter and none is bound',
            () => [load(TAX + ZONE), undefined],
            /binds none/,
        ],
        [
            'a factory is bound and the file names none',
            () => [load('vatRate: 19\n'), factoryOf()],
            /names none/,
        ],
        [
            'the names differ',
            () => [load(TAX + ZONE), factoryOf(testAdapter('other'), 'other')],
            /binds other/,
        ],
        [
            'the factory refuses the options',
            () => [
                load(TAX + ZONE),
                {
                    adapterName: 'test-tax',
                    create: () => {
                        throw new Error('no such option');
                    },
                },
            ],
            /cannot be built from config\/saas\.yaml#tax\.options: no such option/,
        ],
        [
            'the factory builds an adapter of another name',
            () => [load(TAX + ZONE), factoryOf(testAdapter('renamed'))],
            /builds an adapter named renamed/,
        ],
    ];
    for (const [name, args, expected] of refusals) {
        test(`the start is refused when ${name}`, async () => {
            await assert.rejects(() => bootWith(...args()), expected);
        });
    }

    test('the start is refused when the adapter cannot decide a charge in the issuer country', async () => {
        const abroad = load(TAX + ZONE.replace('Europe/Berlin', 'Europe/Vienna')).valueOf();
        abroad.issuer = { ...abroad.issuer, country: 'AT' };
        await assert.rejects(
            () => bootWith(abroad, factoryOf()),
            /cannot decide a charge to a subscriber in the issuer's country: nothing decided for AT/,
        );
    });

    test('a case the adapter does not support is refused with 422 and its sentence', async () => {
        const taxes = await bootWith(load(TAX + ZONE), factoryOf());
        const origin = { country: 'FR', business: false, vatId: null, validatedVatId: null };
        const period = {
            from: new Date('2026-05-01T00:00:00Z'),
            until: new Date('2026-06-01T00:00:00Z'),
        };
        assert.throws(
            () => taxes.decide(origin, period),
            (error) =>
                error.getStatus() === 422 &&
                error.getResponse().code === 'TAX_TREATMENT_NOT_SUPPORTED' &&
                error.getResponse().params.reason === 'nothing decided for FR' &&
                error.getResponse().params.adapter === 'test-tax',
        );
    });
});
