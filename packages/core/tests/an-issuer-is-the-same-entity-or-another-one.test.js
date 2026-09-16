// Whether the issuer in `config/saas.yaml` is the legal entity the installation
// recorded, or another one.
//
// The whole rule lives in one pure function, so the cases are enumerated here
// rather than through a booted application: the file says one thing, the record
// says another, and each combination has exactly one right answer. What the
// start then DOES about that answer is
// `packages/nest/tests/an-operator-corrects-its-own-details.test.js`.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    LEGAL_IDENTITY_FIELDS,
    classifyIssuerChange,
    contractPartiesOf,
    issuerIdentityOf,
    movedIdentityFields,
    recordedIssuerIdentity,
    sameLegalIdentity,
} from '../dist/index.js';

const planCatalogSchema = JSON.parse(
    readFileSync(new URL('../../spec/schemas/plan-catalog.schema.json', import.meta.url), 'utf8'),
);

const GMBH = { legalName: 'Example Software GmbH', vatId: 'DE123456789', taxNumber: null };

/** A subscriber as its record stands, for the copies a contract takes. */
const SUBSCRIBER = {
    id: 'subscriber-1',
    customerNumber: 'K-10001',
    legalName: 'Meier GmbH',
    vatId: null,
    taxNumber: null,
    addressLine1: null,
    addressLine2: null,
    postalCode: null,
    city: null,
    country: null,
};

/** The issuer block as the file carries it: optional members absent, not null. */
const issuerBlock = (overrides = {}) => ({
    legalName: 'Example Software GmbH',
    addressLine1: 'Werkstraße 5',
    postalCode: '80331',
    city: 'München',
    country: 'DE',
    vatId: 'DE123456789',
    ...overrides,
});

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued
describe('the identity of an issuer', () => {
    test('is the three fields a contract names it by, and nothing about how it is reached', () => {
        assert.deepEqual(issuerIdentityOf(issuerBlock()), GMBH);
    });

    test('reads an absent tax identifier as unknown rather than as absent', () => {
        // The contract copy and the record both hold `null` there, so the
        // comparison has to see the same shape from the file.
        assert.deepEqual(issuerIdentityOf({ legalName: 'Solo e.K.' }), {
            legalName: 'Solo e.K.',
            vatId: null,
            taxNumber: null,
        });
    });

    test('is nothing where the file names no issuer', () => {
        assert.equal(issuerIdentityOf(undefined), null);
    });

    test('is settled the same way on both sides, so a stray space is not another entity', () => {
        // The record is a verbatim copy of the file. Settle one side and not the
        // other and a trailing space makes a value differ from itself: the first
        // start records it, the second refuses, and no declaration stops that
        // recurring — the file never changed.
        const spaced = issuerBlock({
            legalName: '  Example Software GmbH ',
            vatId: 'DE123456789 ',
        });
        assert.deepEqual(issuerIdentityOf(spaced), GMBH);
        assert.deepEqual(
            classifyIssuerChange(recordedIssuerIdentity({ issuer: spaced }), issuerBlock()),
            { kind: 'unchanged', identity: GMBH },
        );
    });

    test('and a declaration is settled with them', () => {
        const change = classifyIssuerChange(
            GMBH,
            issuerBlock({
                legalName: 'Example Software AG',
                correctionOf: { legalName: ' Example Software GmbH ', reason: 'Change of form' },
            }),
        );
        assert.equal(change.kind, 'corrected');
    });

    test('is the same as another when every field matches, and not otherwise', () => {
        assert.equal(sameLegalIdentity(GMBH, { ...GMBH }), true);
        for (const field of LEGAL_IDENTITY_FIELDS) {
            const moved = { ...GMBH, [field]: 'something else' };
            assert.equal(sameLegalIdentity(GMBH, moved), false, field);
            assert.deepEqual(movedIdentityFields(GMBH, moved), [field]);
        }
    });

    test('is exactly what `issuer.correctionOf` can name in the file', () => {
        // Derived rather than listed: a fourth identity field added to the
        // schema without being nameable in a declaration would be a field that
        // moves and can never be declared, so the start could never be repaired.
        const declarable = Object.keys(
            planCatalogSchema.properties.issuer.properties.correctionOf.properties,
        ).filter((name) => name !== 'reason');
        assert.deepEqual(declarable.sort(), [...LEGAL_IDENTITY_FIELDS].sort());
    });
});

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued
// @requirement SC-AUD-012 — A contract carries both parties as they were when it was concluded
describe('the copy a contract takes of the issuer', () => {
    test('carries the same three fields the start compares, and the address beside them', () => {
        const { issuer } = contractPartiesOf(SUBSCRIBER, issuerBlock());
        assert.deepEqual(issuer, {
            ...GMBH,
            addressLine1: 'Werkstraße 5',
            addressLine2: null,
            postalCode: '80331',
            city: 'München',
            country: 'DE',
        });
    });

    test('never loses all three because one of them could not be read', () => {
        // `issuerIdentityOf` answers nothing for a block whose name is blank —
        // which the schema keeps out of the file, and a catalogue handed in as
        // an object does not go through. Spread, that nothing would leave the
        // copy without any of the three: a contract naming a party it does not
        // name. An empty name is what a copy has always carried for "not
        // stated", and it is what reading one back produces.
        const { issuer } = contractPartiesOf(SUBSCRIBER, { legalName: '   ', city: 'Berlin' });
        assert.deepEqual(issuer, {
            legalName: '',
            vatId: null,
            taxNumber: null,
            addressLine1: null,
            addressLine2: null,
            postalCode: null,
            city: 'Berlin',
            country: null,
        });
    });

    test('does not carry the declaration, which is about the change and not the party', () => {
        const declared = issuerBlock({
            correctionOf: { legalName: 'Example Software OHG', reason: 'Renamed' },
        });
        assert.deepEqual(Object.keys(contractPartiesOf(SUBSCRIBER, declared).issuer).sort(), [
            'addressLine1',
            'addressLine2',
            'city',
            'country',
            'legalName',
            'postalCode',
            'taxNumber',
            'vatId',
        ]);
    });
});

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued
describe('the identity a record holds', () => {
    test('is read back out of the settings tree the last start wrote', () => {
        assert.deepEqual(recordedIssuerIdentity({ currency: 'EUR', issuer: issuerBlock() }), GMBH);
    });

    test('is nothing where the tree names no issuer, or names one without a name', () => {
        assert.equal(recordedIssuerIdentity({ currency: 'EUR' }), null);
        assert.equal(recordedIssuerIdentity(undefined), null);
        assert.equal(recordedIssuerIdentity({ issuer: null }), null);
        assert.equal(recordedIssuerIdentity({ issuer: 'Example Software GmbH' }), null);
        assert.equal(recordedIssuerIdentity({ issuer: { legalName: '  ' } }), null);
    });
});

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued
describe('what a start finds when it compares the two', () => {
    test('nothing named on either side is nothing to compare', () => {
        assert.deepEqual(classifyIssuerChange(null, undefined), { kind: 'none-named' });
    });

    test('a first issuer where none was recorded is the first naming, declared for nothing', () => {
        // No contract can have been concluded under another identity, because
        // there was none to conclude one under.
        assert.deepEqual(classifyIssuerChange(null, issuerBlock()), {
            kind: 'first-naming',
            identity: GMBH,
        });
    });

    test('a moved address is not a moved identity', () => {
        const moved = issuerBlock({ addressLine1: 'Hauptstraße 1', city: 'Berlin' });
        assert.deepEqual(classifyIssuerChange(GMBH, moved), { kind: 'unchanged', identity: GMBH });
    });

    test('a changed legal name with nothing declared is refused', () => {
        const change = classifyIssuerChange(GMBH, issuerBlock({ legalName: 'Other Software AG' }));
        assert.equal(change.kind, 'undeclared');
        assert.deepEqual(change.fault, { kind: 'absent' });
        assert.deepEqual(change.moved, ['legalName']);
        assert.deepEqual(change.recorded, GMBH);
    });

    test('a changed legal name declared against the recorded one is a correction', () => {
        const change = classifyIssuerChange(
            GMBH,
            issuerBlock({
                legalName: 'Example Software AG',
                correctionOf: {
                    legalName: 'Example Software GmbH',
                    reason: 'Change of legal form, registered 2026-07-01',
                },
            }),
        );
        assert.equal(change.kind, 'corrected');
        assert.deepEqual(change.moved, ['legalName']);
        assert.equal(change.reason, 'Change of legal form, registered 2026-07-01');
        assert.deepEqual(change.current.legalName, 'Example Software AG');
    });

    test('a tax number that was missing is declared as the nothing it replaces', () => {
        // The motivating case: an operator whose tax office assigns a number
        // later. There is no previous value to name, so the declaration names
        // `null` — and saying nothing at all would leave the field undeclared.
        const withNumber = issuerBlock({
            taxNumber: '12/345/67890',
            correctionOf: { taxNumber: null, reason: 'Assigned by the tax office on 2026-07-01' },
        });
        assert.equal(classifyIssuerChange(GMBH, withNumber).kind, 'corrected');

        const undeclared = issuerBlock({
            taxNumber: '12/345/67890',
            correctionOf: { reason: 'Assigned by the tax office on 2026-07-01' },
        });
        assert.deepEqual(classifyIssuerChange(GMBH, undeclared).fault, {
            kind: 'leaves-a-field-out',
            field: 'taxNumber',
            recorded: null,
            current: '12/345/67890',
        });
    });

    test('a declaration naming a value the record does not hold covers nothing', () => {
        // The shape a declaration left over from an earlier correction has: it
        // still names the identity before that one, which the record no longer
        // holds.
        const change = classifyIssuerChange(
            GMBH,
            issuerBlock({
                legalName: 'Example Software SE',
                correctionOf: { legalName: 'Example Software OHG', reason: 'Renamed again' },
            }),
        );
        assert.equal(change.kind, 'undeclared');
        assert.deepEqual(change.fault, {
            kind: 'names-another-value',
            field: 'legalName',
            declared: 'Example Software OHG',
            recorded: 'Example Software GmbH',
        });
    });

    test('a declaration covering half a change covers nothing', () => {
        const change = classifyIssuerChange(
            GMBH,
            issuerBlock({
                legalName: 'Example Software AG',
                vatId: 'DE999999999',
                correctionOf: {
                    legalName: 'Example Software GmbH',
                    reason: 'Change of legal form',
                },
            }),
        );
        assert.equal(change.kind, 'undeclared');
        assert.deepEqual(change.moved, ['legalName', 'vatId']);
        assert.deepEqual(change.fault, {
            kind: 'leaves-a-field-out',
            field: 'vatId',
            recorded: 'DE123456789',
            current: 'DE999999999',
        });
    });

    test('a declaration fuller than it had to be is still a declaration', () => {
        // Naming a field that did not move says what it replaces, which is the
        // value it still has. Refusing that would be pedantry met at a restart.
        const change = classifyIssuerChange(
            GMBH,
            issuerBlock({
                legalName: 'Example Software AG',
                correctionOf: {
                    legalName: 'Example Software GmbH',
                    vatId: 'DE123456789',
                    taxNumber: null,
                    reason: 'Change of legal form',
                },
            }),
        );
        assert.equal(change.kind, 'corrected');
    });

    test('dropping the issuer block while one is recorded is refused, declaration and all', () => {
        // The declaration lives inside the block, so removing the block removes
        // it: there is no way to declare this, and no reading under which the
        // contracts stop naming the entity they were concluded with.
        const change = classifyIssuerChange(GMBH, undefined);
        assert.equal(change.kind, 'undeclared');
        assert.equal(change.current, null);
        assert.deepEqual(change.fault, { kind: 'absent' });
        assert.deepEqual(
            change.moved,
            ['legalName', 'vatId'],
            'the fields the record held a value for',
        );
    });

    test('a declaration left in the file after its correction landed changes nothing', () => {
        // `correctionOf` may stay: the record now holds the corrected identity,
        // so the file and the record agree and nothing is compared against the
        // declaration at all.
        const corrected = { ...GMBH, legalName: 'Example Software AG' };
        const file = issuerBlock({
            legalName: 'Example Software AG',
            correctionOf: { legalName: 'Example Software GmbH', reason: 'Change of legal form' },
        });
        assert.deepEqual(classifyIssuerChange(corrected, file), {
            kind: 'unchanged',
            identity: corrected,
        });
    });

    test('and it does not license the next change', () => {
        // The counter-check for the case above: the declaration that is spent
        // names the identity before the correction, and the record holds the one
        // after it, so a second move finds no declaration that matches.
        const corrected = { ...GMBH, legalName: 'Example Software AG' };
        const file = issuerBlock({
            legalName: 'Third Party Holding SE',
            correctionOf: { legalName: 'Example Software GmbH', reason: 'Change of legal form' },
        });
        assert.equal(classifyIssuerChange(corrected, file).kind, 'undeclared');
    });
});
