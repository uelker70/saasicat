// How an invoice's standing reads in the administration: the replacement that
// took its place beside what it corrects and what cancelled it, and where its
// payment stands, each kind in the catalogue's own words. The platform decides
// the standing; these only word it, with the page's own way of writing a day
// and an amount.

// @requirement SC-ADM-051 — An invoice in the record names its replacement and says where its payment stands

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { SA_MESSAGES, invoicePaymentOf, invoiceStandingOf } from '../dist/index.js';

const EN = SA_MESSAGES.en.subscribers.payments;
const DE = SA_MESSAGES.de.subscribers.payments;
const WRITE = { day: (day) => `[${day}]`, money: (amount) => amount.toFixed(2) };

describe('an invoice cancelled', () => {
    const cancelledBy = { invoiceId: 'i-2', number: 'R-2' };

    test('names its replacement after the cancellation invoice', () => {
        const replacedBy = { invoiceId: 'i-3', number: 'R-3' };
        assert.equal(
            invoiceStandingOf({ correction: null, cancelledBy, replacedBy }, EN),
            'Cancelled by R-2 · Replaced by R-3',
        );
        assert.equal(
            invoiceStandingOf({ correction: null, cancelledBy, replacedBy }, DE),
            'Storniert durch R-2 · Ersetzt durch R-3',
        );
    });

    test('names none where no replacement took its place, or the list does not know it', () => {
        assert.equal(
            invoiceStandingOf({ correction: null, cancelledBy, replacedBy: null }, EN),
            'Cancelled by R-2',
        );
        assert.equal(invoiceStandingOf({ correction: null, cancelledBy }, EN), 'Cancelled by R-2');
    });
});

describe("where an invoice's payment stands", () => {
    for (const [why, totalGross, payment, en, de] of [
        ['nothing is paid', 49, { kind: 'open', owed: 49, overdue: false }, 'Open', 'Offen'],
        [
            'nothing is paid past its due date',
            49,
            { kind: 'open', owed: 49, overdue: true },
            'Overdue',
            'Überfällig',
        ],
        [
            'it is paid in part',
            49,
            { kind: 'open', owed: 20, overdue: false },
            'Open: 20.00 of 49.00',
            'Offen: 20.00 von 49.00',
        ],
        [
            'it is paid in part past its due date',
            49,
            { kind: 'open', owed: 20, overdue: true },
            'Overdue: 20.00 of 49.00',
            'Überfällig: 20.00 von 49.00',
        ],
        [
            'its payment was reversed',
            49,
            { kind: 'reversed', on: '2026-07-08', owed: 49, overdue: false },
            'Payment reversed on [2026-07-08] · Open',
            'Zahlung am [2026-07-08] zurückgebucht · Offen',
        ],
        [
            'its payment was reversed past its due date',
            49,
            { kind: 'reversed', on: '2026-07-08', owed: 49, overdue: true },
            'Payment reversed on [2026-07-08] · Overdue',
            'Zahlung am [2026-07-08] zurückgebucht · Überfällig',
        ],
        [
            'it is paid',
            49,
            { kind: 'paid', on: '2026-07-01' },
            'Paid on [2026-07-01]',
            'Bezahlt am [2026-07-01]',
        ],
        [
            'its total is negative and nothing is paid out',
            -20,
            { kind: 'to-be-refunded', open: 20 },
            'To be refunded',
            'Wird erstattet',
        ],
        [
            'its total is negative and part is paid out',
            -20,
            { kind: 'to-be-refunded', open: 5 },
            'To be refunded: 5.00 of 20.00',
            'Wird erstattet: 5.00 von 20.00',
        ],
        [
            'its credit is paid out',
            -20,
            { kind: 'refunded', on: '2026-07-03' },
            'Refunded on [2026-07-03]',
            'Erstattet am [2026-07-03]',
        ],
        ['it is not paid at all', 49, null, '', ''],
    ]) {
        test(`reads ${JSON.stringify(en)} where ${why}`, () => {
            assert.equal(invoicePaymentOf({ payment, totalGross }, EN, WRITE), en);
            assert.equal(invoicePaymentOf({ payment, totalGross }, DE, WRITE), de);
        });
    }

    test('its sentences never call a credit a Gutschrift', () => {
        const sentences = Object.values(DE).join(' ');
        assert.equal(sentences.includes('Gutschrift'), false);
    });
});
