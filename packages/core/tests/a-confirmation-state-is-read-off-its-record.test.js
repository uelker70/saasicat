// Where a contract's confirmation stands, as the operator reads it: what its
// record says, and for a contract without one, whether it is due one. One case
// per state, and the one the model does not produce — a record on a contract
// not due — read as what the record says.

// @requirement SC-AUD-016 — Concluding or changing a contract gives the subscriber a confirmation to keep

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { confirmationStateOf } from '../dist/index.js';

const AT = new Date('2026-10-23T05:00:00.000Z');
const RECORD = {
    contractId: 'contract-1',
    checksum: 'a'.repeat(64),
    mediaType: 'application/pdf',
    fileName: 'contract-confirmation-contract-1.pdf',
    size: 1024,
    renderedAt: AT,
    archivedAt: null,
    deliveryClaimedAt: null,
    deliveredAt: null,
    deliveredTo: null,
};
const standing = (due, confirmation) => ({ contractId: 'contract-1', due, confirmation });

describe('the state of a contract’s confirmation', () => {
    for (const [what, given, state] of [
        ['a contract written before confirmations', standing(false, null), 'not-due'],
        ['a contract due one, not rendered yet', standing(true, null), 'being-made'],
        ['a rendering not archived yet', standing(true, RECORD), 'being-made'],
        [
            'an archived one, claimed and not mailed yet',
            standing(true, { ...RECORD, archivedAt: AT, deliveryClaimedAt: AT }),
            'awaiting-mail',
        ],
        [
            'one handed to the mail',
            standing(true, { ...RECORD, archivedAt: AT, deliveredAt: AT, deliveredTo: 'a@b.de' }),
            'sent',
        ],
        [
            'a record on a contract not due, read as the record says',
            standing(false, RECORD),
            'being-made',
        ],
    ]) {
        test(`${what} is ${state}`, () => {
            assert.equal(confirmationStateOf(given), state);
        });
    }
});
