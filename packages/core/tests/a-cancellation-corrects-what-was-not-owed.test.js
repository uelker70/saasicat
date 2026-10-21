// What a cancellation corrects of the invoice it cancels, line by line: a
// charge named as not owed, or owed in part, moves by a counter-entry, each
// discount follows what it reduced in the share that fell, and the replacement
// carries what is still owed with the correction lines that say why.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    draftCorrectedReplacementInvoice,
    isCorrectableLine,
    lineCorrectionsOf,
    replacementLinesOf,
    standingCentsOf,
    taxPerRate,
    writtenReplacementOf,
} from '../dist/index.js';

const PERIOD_START = new Date('2026-02-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-03-01T00:00:00.000Z');
const CORRECTED_AT = new Date('2026-03-10T08:00:00.000Z');
const REASON = 'Half the month was not owed.';

/** A charge of the journal, a plan's renewal of February unless `overrides` says otherwise. */
const charge = (id, amountNet, overrides = {}) => ({
    id,
    subscriberId: 'subscriber-1',
    tenantId: 'tenant-1',
    subscriptionId: 'sub-1',
    contractId: 'contract-1',
    contractLineItemId: `item-${id}`,
    origin: 'renewal',
    source: 'plan',
    sourceRef: 'sub-1',
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    currency: 'EUR',
    amountNet,
    bookedAt: PERIOD_START,
    correction: null,
    createdAt: PERIOD_START,
    ...overrides,
});

/** The line of an invoice invoicing `of`, at `position`. */
const lineOf = (position, of, overrides = {}) => ({
    id: `line-${position}`,
    invoiceId: 'invoice-1',
    position,
    chargeId: of.id,
    contractLineItemId: of.contractLineItemId,
    title: `Line ${position}`,
    origin: of.origin,
    source: of.source,
    periodFrom: '2026-02-01',
    periodUntil: '2026-02-28',
    amountNet: of.amountNet,
    taxRate: 19,
    correctedPosition: null,
    correctsPosition: null,
    ...overrides,
});

const PLAN = charge('plan', 19.9);
const DISCOUNT = charge('discount', -3.98, { source: 'discount', sourceRef: 'WELCOME20' });
const ADD_ON = charge('add-on', 10, { source: 'bundle', sourceRef: 'booking-1' });
const HELD = charge('held', -2, { source: 'discount', sourceRef: 'HOLD-booking-1' });
const SEATS = charge('seats', 0, { title: 'Included seats' });

/** An invoice of `charges`, one line each, in their order. */
const invoiceOf = (charges, overrides = {}) => ({
    id: 'invoice-1',
    number: 'AHP-2026-000001',
    subscriptionId: 'sub-1',
    lines: charges.map((each, index) => lineOf(index + 1, each)),
    ...overrides,
});

/** A held price reduces its booking; every other discount the plan. */
const reduces = (discount) =>
    discount.id === HELD.id
        ? { source: 'bundle', subscriptionBundleId: 'booking-1' }
        : { source: 'plan' };

const corrections = (invoice, owed, journal) =>
    lineCorrectionsOf(invoice, owed, { journal, reduces, reason: REASON, bookedAt: CORRECTED_AT });

/** What each line becomes, in currency, by position. */
const becomes = (corrected) =>
    Object.fromEntries(corrected.lines.map((line) => [line.position, line.becomes / 100]));

// @requirement SC-PRIC-095 — An issued invoice is never edited; its cancellation corrects what was not owed
describe('a line named as not owed, or owed in part', () => {
    const invoice = invoiceOf([PLAN, DISCOUNT]);
    const journal = [PLAN, DISCOUNT];

    test('becomes what is owed of it, by a counter-entry that names it, the invoice and the reason', () => {
        const corrected = corrections(invoice, [{ position: 1, owed: 9.95 }], journal);

        assert.equal(becomes(corrected)[1], 9.95);
        assert.deepEqual(
            corrected.counterEntries[0] && {
                amountNet: corrected.counterEntries[0].amountNet,
                correction: corrected.counterEntries[0].correction,
                sourceRef: corrected.counterEntries[0].sourceRef,
                bookedAt: corrected.counterEntries[0].bookedAt,
            },
            {
                amountNet: -9.95,
                correction: { chargeId: 'plan', invoiceId: 'invoice-1', reason: REASON },
                sourceRef: 'invoice-1/plan',
                bookedAt: CORRECTED_AT,
            },
        );
    });

    for (const [what, owed] of [
        ['owed for a cent', 0.01],
        ['owed for a cent less than all of it', 19.89],
        ['owed not at all', 0],
    ]) {
        test(`${what}, moves by what is not owed`, () => {
            const corrected = corrections(invoice, [{ position: 1, owed }], journal);

            assert.equal(becomes(corrected)[1], owed);
            assert.equal(
                corrected.counterEntries[0]?.amountNet,
                -Math.round((19.9 - owed) * 100) / 100,
            );
        });
    }

    test('left out, stands as it stood, and no counter-entry is written', () => {
        const corrected = corrections(invoice, [], journal);

        assert.deepEqual(becomes(corrected), { 1: 19.9, 2: -3.98 });
        assert.deepEqual(corrected.counterEntries, []);
    });
});

// @requirement SC-PRIC-095 — An issued invoice is never edited; its cancellation corrects what was not owed
describe('a discount, when what it reduced falls', () => {
    test('falls in the same share, a counter-entry giving back what it no longer takes off', () => {
        const corrected = corrections(
            invoiceOf([PLAN, DISCOUNT]),
            [{ position: 1, owed: 9.95 }],
            [PLAN, DISCOUNT],
        );

        assert.equal(becomes(corrected)[2], -1.99);
        assert.equal(corrected.counterEntries[1]?.amountNet, 1.99);
        assert.equal(corrected.counterEntries[1]?.correction?.chargeId, 'discount');
    });

    test('falls entirely with a plan owed no more', () => {
        const corrected = corrections(
            invoiceOf([PLAN, DISCOUNT]),
            [{ position: 1, owed: 0 }],
            [PLAN, DISCOUNT],
        );

        assert.deepEqual(becomes(corrected), { 1: 0, 2: 0 });
        assert.equal(corrected.counterEntries[1]?.amountNet, 3.98);
    });

    test('is rounded to the cent, the remainder its own', () => {
        // 3.98 × 6.63 / 19.90 = 1.3260…
        const corrected = corrections(
            invoiceOf([PLAN, DISCOUNT]),
            [{ position: 1, owed: 6.63 }],
            [PLAN, DISCOUNT],
        );

        assert.equal(becomes(corrected)[2], -1.33);
        assert.equal(corrected.counterEntries[1]?.amountNet, 2.65);
    });

    test('on half a cent, keeps the cent: away from nothing', () => {
        // 1.00 × 0.01 / 2.00 = 0.005
        const plan = charge('plan', 2);
        const discount = charge('discount', -1, { source: 'discount' });
        const corrected = corrections(
            invoiceOf([plan, discount]),
            [{ position: 1, owed: 0.01 }],
            [plan, discount],
        );

        assert.equal(becomes(corrected)[2], -0.01);
    });

    test('held on a booking, follows the booking and leaves the plan’s discount alone', () => {
        const corrected = corrections(
            invoiceOf([PLAN, DISCOUNT, ADD_ON, HELD]),
            [{ position: 3, owed: 0 }],
            [PLAN, DISCOUNT, ADD_ON, HELD],
        );

        assert.deepEqual(becomes(corrected), { 1: 19.9, 2: -3.98, 3: 0, 4: 0 });
    });

    test('of the plan, follows the plan and leaves a booking’s held price alone', () => {
        const corrected = corrections(
            invoiceOf([PLAN, DISCOUNT, ADD_ON, HELD]),
            [{ position: 1, owed: 0 }],
            [PLAN, DISCOUNT, ADD_ON, HELD],
        );

        assert.deepEqual(becomes(corrected), { 1: 0, 2: 0, 3: 10, 4: -2 });
    });

    test('of another period, stays what it stands at', () => {
        const march = charge('march-discount', -3.98, {
            source: 'discount',
            periodStart: PERIOD_END,
            periodEnd: new Date('2026-04-01T00:00:00.000Z'),
        });
        const corrected = corrections(
            invoiceOf([PLAN, march]),
            [{ position: 1, owed: 0 }],
            [PLAN, march],
        );

        assert.equal(becomes(corrected)[2], -3.98);
        assert.equal(corrected.counterEntries.length, 1);
    });
});

// @requirement SC-PRIC-095 — An issued invoice is never edited; its cancellation corrects what was not owed
describe('a line corrected before, along the chain', () => {
    const earlier = charge('earlier', -10, {
        origin: 'correction',
        sourceRef: 'invoice-0/plan',
        correction: { chargeId: 'plan', invoiceId: 'invoice-0', reason: 'Not owed.' },
    });
    const journal = [PLAN, earlier];

    test('stands at its charge and every correction of it', () => {
        assert.equal(standingCentsOf(PLAN, journal), 990);
    });

    test('moves from where it stands, so the corrections of a charge never take it below nothing', () => {
        const invoice = invoiceOf([PLAN, earlier], {
            lines: [lineOf(1, PLAN), lineOf(2, earlier, { correctsPosition: 1 })],
        });
        const corrected = corrections(invoice, [{ position: 1, owed: 4 }], journal);

        assert.deepEqual(becomes(corrected), { 1: 4 });
        assert.equal(corrected.counterEntries[0]?.amountNet, -5.9);
    });
});

describe('which line the operator may correct', () => {
    for (const [what, line, standsAt, correctable] of [
        ['a charge that asks for something', lineOf(1, PLAN), 1990, true],
        ['a discount', lineOf(2, DISCOUNT), -398, false],
        ['a charge of nothing', lineOf(3, SEATS), 0, false],
        ['a charge corrected down to nothing', lineOf(1, PLAN), 0, false],
        ['a correction', lineOf(4, PLAN, { origin: 'correction' }), 1000, false],
    ]) {
        test(`${what}: ${correctable ? 'yes' : 'no'}`, () => {
            assert.equal(isCorrectableLine(line, standsAt), correctable);
        });
    }
});

// @requirement SC-PRIC-095 — An issued invoice is never edited; its cancellation corrects what was not owed
describe('the replacement’s lines', () => {
    const invoice = invoiceOf([PLAN, DISCOUNT, SEATS]);
    const journal = [PLAN, DISCOUNT, SEATS];
    const shape = (lines) =>
        lines.map((line) => [
            line.position,
            line.origin,
            line.amountNet,
            line.correctedPosition,
            line.correctsPosition,
            line.counterEntry,
        ]);

    test('carry a line owed in part with its counter-entry after it, naming it', () => {
        const lines = replacementLinesOf(
            invoice,
            corrections(invoice, [{ position: 1, owed: 9.95 }], journal),
            19,
        );

        assert.deepEqual(shape(lines), [
            [1, 'renewal', 19.9, 1, null, null],
            [2, 'correction', -9.95, null, 1, 0],
            [3, 'renewal', -3.98, 2, null, null],
            [4, 'correction', 1.99, null, 3, 1],
            [5, 'renewal', 0, 3, null, null],
        ]);
    });

    test('leave out a line owed no more and what follows it, and keep a line that was nothing', () => {
        const withAddOn = invoiceOf([PLAN, DISCOUNT, ADD_ON, SEATS]);
        const lines = replacementLinesOf(
            withAddOn,
            corrections(withAddOn, [{ position: 1, owed: 0 }], [PLAN, DISCOUNT, ADD_ON, SEATS]),
            19,
        );

        assert.deepEqual(shape(lines), [
            [1, 'renewal', 10, 3, null, null],
            [2, 'renewal', 0, 4, null, null],
        ]);
    });

    test('are none where nothing is owed any more, a line of nothing aside', () => {
        assert.deepEqual(
            replacementLinesOf(
                invoice,
                corrections(invoice, [{ position: 1, owed: 0 }], journal),
                19,
            ),
            [],
        );
    });

    test('renumber a correction line carried over, still naming its charge’s line', () => {
        const earlier = charge('earlier', -10, {
            origin: 'correction',
            sourceRef: 'invoice-0/plan',
            correction: { chargeId: 'plan', invoiceId: 'invoice-0', reason: 'Not owed.' },
        });
        const chained = invoiceOf([], {
            lines: [
                lineOf(1, DISCOUNT),
                lineOf(2, PLAN),
                lineOf(3, earlier, { correctsPosition: 2 }),
            ],
        });
        const lines = replacementLinesOf(
            chained,
            corrections(chained, [{ position: 2, owed: 4 }], [DISCOUNT, PLAN, earlier]),
            19,
        );

        assert.deepEqual(shape(lines), [
            // The discount falls with the plan: 3.98 × 4 / 9.90 = 1.6080…, so it gives back 2.37.
            [1, 'renewal', -3.98, 1, null, null],
            [2, 'correction', 2.37, null, 1, 0],
            [3, 'renewal', 19.9, 2, null, null],
            [4, 'correction', -10, 3, 3, null],
            [5, 'correction', -5.9, null, 3, 1],
        ]);
    });
});

describe('the corrected replacement', () => {
    const invoice = {
        ...invoiceOf([PLAN, DISCOUNT]),
        tenantId: 'tenant-1',
        subscriberId: 'subscriber-1',
        contractId: 'contract-1',
        servicePeriodFrom: '2026-02-01',
        servicePeriodUntil: '2026-02-28',
        currency: 'EUR',
    };
    const issue = {
        issuedAt: CORRECTED_AT,
        timeZone: 'Europe/Berlin',
        numberPrefix: 'AHP',
        subscriber: { legalName: 'Customer GmbH' },
        issuer: { legalName: 'Issuer GmbH' },
        footer: [],
        treatment: { kind: 'standard', rate: 19, note: null },
        tax: taxPerRate,
        paymentTermDays: 14,
        directDebitLeadDays: 5,
        payment: null,
        paid: 0,
    };

    test('asks for what is still owed, its figures from its lines', () => {
        const planned = draftCorrectedReplacementInvoice(
            invoice,
            issue,
            corrections(invoice, [{ position: 1, owed: 9.95 }], [PLAN, DISCOUNT]),
        );

        assert.deepEqual(
            [planned?.totalNet, planned?.totalTax, planned?.totalGross],
            [7.96, 1.51, 9.47],
        );
    });

    test('is none where nothing is owed any more', () => {
        assert.equal(
            draftCorrectedReplacementInvoice(
                invoice,
                issue,
                corrections(invoice, [{ position: 1, owed: 0 }], [PLAN, DISCOUNT]),
            ),
            null,
        );
    });

    test('names each counter-entry by its charge once it is written, and refuses one that was not', () => {
        const planned = draftCorrectedReplacementInvoice(
            invoice,
            issue,
            corrections(invoice, [{ position: 1, owed: 9.95 }], [PLAN, DISCOUNT]),
        );
        assert.ok(planned);

        assert.deepEqual(
            writtenReplacementOf(planned, ['ce-1', 'ce-2']).lines.map((line) => line.chargeId),
            ['plan', 'ce-1', 'discount', 'ce-2'],
        );
        assert.throws(
            () => writtenReplacementOf(planned, ['ce-1']),
            /Counter-entry 1 of the replacement was not written/,
        );
    });
});
