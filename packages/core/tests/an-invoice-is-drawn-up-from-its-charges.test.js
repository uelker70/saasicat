// What an invoice says, drawn up from the charges it issues — before its number
// is drawn. Pure functions over charges, a contract's lines, the parties and
// the adapter's decision, so each rule is enumerated here: which charges go on
// one invoice, the order and the titles of its lines, its days in the
// installation's zone, its due date, its tax, and its number's form.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    addDaysToDay,
    dayInZone,
    draftSubscriptionInvoice,
    formatInvoiceNumber,
    invoiceContentDraftOf,
    invoiceGroupsOf,
    lastDayInZone,
    taxPerRate,
    yearOfDay,
} from '../dist/index.js';

const BERLIN = 'Europe/Berlin';

/** Midnight of `day` in Berlin in winter, as the journal writes a period's start there. */
const berlin = (day) => new Date(`${day}T00:00:00.000+01:00`);

let ids = 0;
function charge(overrides = {}) {
    ids += 1;
    return {
        id: `charge-${ids}`,
        subscriberId: 'subscriber-1',
        tenantId: 'tenant-1',
        subscriptionId: 'sub-1',
        contractId: 'contract-1',
        contractLineItemId: 'line-plan',
        origin: 'renewal',
        source: 'plan',
        sourceRef: 'sub-1',
        periodStart: berlin('2026-02-01'),
        periodEnd: berlin('2026-03-01'),
        currency: 'EUR',
        amountNet: 49,
        bookedAt: berlin('2026-02-01'),
        createdAt: berlin('2026-02-01'),
        ...overrides,
    };
}

const CONTRACT_LINES = [
    { id: 'line-plan', titleSnapshot: 'Standard, monthly' },
    { id: 'line-archive', titleSnapshot: 'Archive add-on' },
    { id: 'line-discount', titleSnapshot: 'Welcome discount' },
];

const TREATMENT = {
    kind: 'standard',
    rate: 19,
    note: null,
    adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
};

const PARTY = {
    legalName: 'Customer GmbH',
    vatId: null,
    taxNumber: null,
    addressLine1: 'Main Street 1',
    addressLine2: null,
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
};

function draft(charges, overrides = {}) {
    return draftSubscriptionInvoice({
        group: { contractId: 'contract-1', bookedAt: charges[0].bookedAt, charges },
        contractLines: CONTRACT_LINES,
        tenantId: 'tenant-1',
        subscriberId: 'subscriber-1',
        subscriber: { ...PARTY, customerNumber: 'K-10001' },
        issuer: { ...PARTY, legalName: 'Issuer GmbH', vatId: 'DE123456789' },
        treatment: TREATMENT,
        tax: taxPerRate,
        issuedAt: berlin('2026-02-01'),
        timeZone: BERLIN,
        numberPrefix: 'AHP',
        paymentTermDays: 14,
        ...overrides,
    });
}

// @requirement SC-PRIC-022 — Every charge of a subscription is invoiced once, on that subscription's invoice
// @requirement SC-PRIC-048 — A billing period whose charges are all zero issues no invoice
describe('the charges one invoice issues', () => {
    test('are those booked at the same moment under the same contract', () => {
        const opening = [charge(), charge({ contractLineItemId: 'line-archive', amountNet: 10 })];
        const later = charge({ bookedAt: berlin('2026-02-14'), amountNet: 5 });
        const otherContract = charge({ contractId: 'contract-2' });

        const groups = invoiceGroupsOf([...opening, later, otherContract]);

        assert.deepEqual(
            groups.map((group) => [
                group.contractId,
                group.bookedAt.toISOString(),
                group.charges.map((c) => c.id),
            ]),
            [
                ['contract-1', berlin('2026-02-01').toISOString(), opening.map((c) => c.id)],
                ['contract-2', berlin('2026-02-01').toISOString(), [otherContract.id]],
                ['contract-1', berlin('2026-02-14').toISOString(), [later.id]],
            ],
        );
    });

    test('come the oldest first, whatever order the journal hands them in', () => {
        const march = charge({ bookedAt: berlin('2026-03-01') });
        const february = charge();

        assert.deepEqual(
            invoiceGroupsOf([march, february]).map((group) => group.charges[0].id),
            [february.id, march.id],
        );
    });

    test('issue nothing where all of them are zero', () => {
        const free = [
            charge({ amountNet: 0 }),
            charge({ contractLineItemId: 'line-archive', amountNet: 0 }),
        ];

        assert.deepEqual(invoiceGroupsOf(free), []);
        assert.deepEqual(invoiceGroupsOf([]), []);
    });

    test('keep a zero beside an amount, and a discount that brings the total to zero', () => {
        const zeroBeside = [
            charge({ amountNet: 0 }),
            charge({ contractLineItemId: 'line-archive', amountNet: 10 }),
        ];
        const discounted = [
            charge({ bookedAt: berlin('2026-03-01') }),
            charge({
                bookedAt: berlin('2026-03-01'),
                contractLineItemId: 'line-discount',
                amountNet: -49,
            }),
        ];

        assert.deepEqual(
            invoiceGroupsOf([...zeroBeside, ...discounted]).map((group) => group.charges.length),
            [2, 2],
        );
    });
});

// @requirement SC-AUD-013 — Every invoice line can be traced to the charge and the contract line it came from
describe('the lines of an invoice', () => {
    test('follow the contract’s lines, each naming its charge and its contract line, titled as the contract titles it', () => {
        const discount = charge({
            contractLineItemId: 'line-discount',
            source: 'discount',
            amountNet: -4.9,
        });
        const archive = charge({
            contractLineItemId: 'line-archive',
            source: 'bundle',
            amountNet: 10,
        });
        const plan = charge();

        const invoice = draft([discount, archive, plan]);

        assert.deepEqual(
            invoice.lines.map((line) => [
                line.position,
                line.chargeId,
                line.contractLineItemId,
                line.title,
            ]),
            [
                [1, plan.id, 'line-plan', 'Standard, monthly'],
                [2, archive.id, 'line-archive', 'Archive add-on'],
                [3, discount.id, 'line-discount', 'Welcome discount'],
            ],
        );
        assert.deepEqual(
            invoice.lines.map((line) => [line.origin, line.source, line.amountNet, line.taxRate]),
            [
                ['renewal', 'plan', 49, 19],
                ['renewal', 'bundle', 10, 19],
                ['renewal', 'discount', -4.9, 19],
            ],
        );
    });

    test('of the same contract line come in the order of their periods', () => {
        const later = charge({
            periodStart: berlin('2026-02-15'),
            origin: 'planChange',
            amountNet: 5,
        });
        const earlier = charge();

        assert.deepEqual(
            draft([later, earlier]).lines.map((line) => line.chargeId),
            [earlier.id, later.id],
        );
    });

    test('refuse a charge whose contract line the contract does not have', () => {
        assert.throws(
            () => draft([charge({ contractLineItemId: 'line-gone' })]),
            /names contract line line-gone, which contract contract-1 does not have/,
        );
    });

    test('refuse charges in two currencies, which no invoice states', () => {
        assert.throws(
            () =>
                draft([charge(), charge({ contractLineItemId: 'line-archive', currency: 'CHF' })]),
            /in EUR and CHF; an invoice is in one currency/,
        );
    });
});

// @requirement SC-PRIC-045 — Invoice dates and tax periods count in the installation's time zone
// @requirement SC-PRIC-046 — An invoice states the day it is due
describe('the days an invoice states', () => {
    test('are read in the installation’s zone: a month starting at midnight in Berlin is that month', () => {
        const invoice = draft([charge()]);

        assert.deepEqual(
            [invoice.lines[0].periodFrom, invoice.lines[0].periodUntil],
            ['2026-02-01', '2026-02-28'],
        );
        assert.deepEqual(
            [invoice.servicePeriodFrom, invoice.servicePeriodUntil],
            ['2026-02-01', '2026-02-28'],
        );
    });

    test('span every line: from the first day any covers to the last', () => {
        const yearly = charge({
            contractLineItemId: 'line-archive',
            periodEnd: berlin('2027-02-01'),
        });
        const late = charge({ periodStart: berlin('2026-02-10') });

        const invoice = draft([late, yearly]);

        assert.deepEqual(
            [invoice.servicePeriodFrom, invoice.servicePeriodUntil],
            ['2026-02-01', '2027-01-31'],
        );
    });

    test('belong to the new year half an hour after midnight on 1 January, whatever UTC says', () => {
        const invoice = draft([charge()], { issuedAt: new Date('2026-12-31T23:30:00.000Z') });

        assert.equal(invoice.issueDate, '2027-01-01');
        assert.equal(invoice.numberYear, 2027);
    });

    test('belong to the old year until midnight in the zone', () => {
        const invoice = draft([charge()], { issuedAt: new Date('2026-12-31T22:59:59.999Z') });

        assert.equal(invoice.issueDate, '2026-12-31');
        assert.equal(invoice.numberYear, 2026);
    });

    test('fall due the payment term after the issue date, across a month and a year', () => {
        const due = (issuedAt, paymentTermDays) =>
            draft([charge()], { issuedAt: new Date(issuedAt), paymentTermDays }).dueDate;

        assert.equal(due('2026-02-01T08:00:00.000Z', 0), '2026-02-01');
        assert.equal(due('2026-02-01T08:00:00.000Z', 14), '2026-02-15');
        assert.equal(due('2026-02-20T08:00:00.000Z', 14), '2026-03-06');
        assert.equal(due('2026-12-25T08:00:00.000Z', 14), '2027-01-08');
    });
});

// @requirement SC-PRIC-041 — An invoice computes its tax once per rate, by the rule its tax adapter names
describe('the tax an invoice states', () => {
    test('is the rate applied once to the net of its lines, not the sum of each line’s rounded tax', () => {
        const lines = Array.from({ length: 10 }, (_, index) =>
            charge({
                contractLineItemId: 'line-archive',
                sourceRef: `b-${index}`,
                amountNet: 12.34,
            }),
        );

        const invoice = draft(lines);

        assert.deepEqual(invoice.taxes, [{ rate: 19, net: 123.4, tax: 23.45 }]);
        assert.deepEqual(
            [invoice.totalNet, invoice.totalTax, invoice.totalGross],
            [123.4, 23.45, 146.85],
        );
    });

    test('is the adapter’s, whatever rule it names', () => {
        const flat = () => ({ rates: [{ rate: 19, net: 49, tax: 1 }], net: 49, tax: 1, gross: 50 });

        const invoice = draft([charge()], { tax: flat });

        assert.deepEqual([invoice.totalTax, invoice.totalGross], [1, 50]);
    });

    test('carries the treatment the adapter decided, and its rate on every line', () => {
        const reverseCharge = {
            ...TREATMENT,
            kind: 'reverse-charge',
            rate: 0,
            note: 'Reverse charge',
        };

        const invoice = draft([charge()], { treatment: reverseCharge });

        assert.deepEqual(invoice.taxTreatment, reverseCharge);
        assert.deepEqual(
            invoice.lines.map((line) => line.taxRate),
            [0],
        );
        assert.deepEqual([invoice.totalTax, invoice.totalGross], [0, 49]);
    });

    test('is computed per rate, the lowest rate first, and a discount lowers its rate’s net', () => {
        assert.deepEqual(
            taxPerRate([
                { net: 39.2, rate: 19 },
                { net: 10, rate: 7 },
                { net: -4.9, rate: 19 },
            ]),
            {
                rates: [
                    { rate: 7, net: 10, tax: 0.7 },
                    { rate: 19, net: 34.3, tax: 6.52 },
                ],
                net: 44.3,
                tax: 7.22,
                gross: 51.52,
            },
        );
        assert.deepEqual(taxPerRate([]), { rates: [], net: 0, tax: 0, gross: 0 });
    });
});

describe('what the adapter is asked to check', () => {
    test('is what the invoice states, line by line', () => {
        const invoice = draft([charge()]);

        assert.deepEqual(invoiceContentDraftOf(invoice), {
            issuer: invoice.issuer,
            subscriber: invoice.subscriber,
            treatment: TREATMENT,
            issueDate: '2026-02-01',
            dueDate: '2026-02-15',
            servicePeriod: { from: '2026-02-01', until: '2026-02-28' },
            lines: [{ title: 'Standard, monthly', net: 49, rate: 19 }],
        });
    });
});

// @requirement SC-PRIC-072 — Invoice numbers run without gaps in one range per issuer, restarting each year
describe('an invoice number', () => {
    test('is the prefix, the year and the sequence in six digits at least', () => {
        assert.equal(formatInvoiceNumber('AHP', 2026, 1), 'AHP-2026-000001');
        assert.equal(formatInvoiceNumber('AHP', 2026, 123), 'AHP-2026-000123');
        assert.equal(formatInvoiceNumber('AHP', 2026, 999_999), 'AHP-2026-999999');
        assert.equal(formatInvoiceNumber('AHP', 2026, 1_000_000), 'AHP-2026-1000000');
    });

    test('has no sequence below 1, and no fraction of one', () => {
        for (const sequence of [0, -1, 1.5, Number.NaN]) {
            assert.throws(() => formatInvoiceNumber('AHP', 2026, sequence), RangeError);
        }
    });

    test('takes the prefix the invoice is drawn up with', () => {
        assert.equal(draft([charge()]).numberPrefix, 'AHP');
    });
});

// @requirement SC-PRIC-045 — Invoice dates and tax periods count in the installation's time zone
describe('a calendar day in a zone', () => {
    test('is the day the instant falls on there, on either side of midnight', () => {
        assert.equal(dayInZone(new Date('2026-06-30T21:59:59.999Z'), BERLIN), '2026-06-30');
        assert.equal(dayInZone(new Date('2026-06-30T22:00:00.000Z'), BERLIN), '2026-07-01');
    });

    test('is read in a named zone only', () => {
        assert.throws(() => dayInZone(new Date(), ''), RangeError);
        assert.throws(() => dayInZone(new Date(), 'Mars/Olympus'), RangeError);
    });

    test('ends a period on the day before the moment it ends', () => {
        assert.equal(
            lastDayInZone(
                { from: berlin('2026-10-01'), until: new Date('2026-11-01T00:00:00.000+01:00') },
                BERLIN,
            ),
            '2026-10-31',
        );
        assert.throws(
            () =>
                lastDayInZone({ from: berlin('2026-10-01'), until: berlin('2026-10-01') }, BERLIN),
            RangeError,
        );
    });

    test('moves on by whole days, through the end of February in a leap year', () => {
        assert.equal(addDaysToDay('2028-02-28', 1), '2028-02-29');
        assert.equal(addDaysToDay('2027-02-28', 1), '2027-03-01');
        assert.equal(addDaysToDay('2026-12-31', 1), '2027-01-01');
        assert.throws(() => addDaysToDay('2026-12-31', 0.5), RangeError);
        assert.throws(() => addDaysToDay('not a day', 1), RangeError);
    });

    test('belongs to its year', () => {
        assert.equal(yearOfDay('2027-01-01'), 2027);
    });
});
