// The one check every eraser of a tenant's data or files runs first.
//
// An eraser deletes "everything of the tenant named", so a name that names no
// tenant — nothing, an empty text, a list — reaches every tenant at once in a
// query that filters by it. The platform checks the identifier before each call
// and refuses the deletion; an eraser calls the same check as its first line,
// because the platform cannot hold the application's own code to it. Nothing
// is trimmed: an identifier with a space around it is not the tenant without
// the space, and repairing it would erase a tenant nobody named.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    TENANT_ID_MAX_LENGTH,
    TenantIdRefused,
    assertOneTenant,
    tenantIdProblem,
} from '../dist/index.js';

// @requirement SC-PRIV-016 — Erasing a tenant's data or files is refused unless exactly one tenant is named
describe('a tenant identifier is checked as it was given', () => {
    test('nothing given is missing', () => {
        assert.equal(tenantIdProblem(undefined), 'missing');
        assert.equal(tenantIdProblem(null), 'missing');
    });

    test('a value that is not text is named as such, a list of one tenant included', () => {
        assert.equal(tenantIdProblem(42), 'not-a-string');
        assert.equal(tenantIdProblem(['t1']), 'not-a-string');
        assert.equal(tenantIdProblem({}), 'not-a-string');
    });

    test('empty text and spaces alone are blank', () => {
        assert.equal(tenantIdProblem(''), 'blank');
        assert.equal(tenantIdProblem('   '), 'blank');
    });

    test('a space or a line break around it is refused, not trimmed', () => {
        assert.equal(tenantIdProblem(' t1'), 'surrounding-space');
        assert.equal(tenantIdProblem('t1 '), 'surrounding-space');
        assert.equal(tenantIdProblem('t1\n'), 'surrounding-space');
    });

    test('the longest identifier is allowed, one character more is not', () => {
        assert.equal(TENANT_ID_MAX_LENGTH, 200);
        assert.equal(tenantIdProblem('a'.repeat(200)), null);
        assert.equal(tenantIdProblem('a'.repeat(201)), 'too-long');
    });

    test('a slug or a uuid names one tenant', () => {
        assert.equal(tenantIdProblem('t1'), null);
        assert.equal(tenantIdProblem('5f0c7a52-2f4e-4c1a-9a43-0b6e9d1c2e11'), null);
    });
});

// @requirement SC-PRIV-016 — Erasing a tenant's data or files is refused unless exactly one tenant is named
describe('an eraser asks first', () => {
    test('one tenant named passes', () => {
        assert.doesNotThrow(() => assertOneTenant('t1'));
    });

    test('anything else is refused, naming the problem', () => {
        assert.throws(
            () => assertOneTenant(''),
            (error) => error instanceof TenantIdRefused && error.problem === 'blank',
        );
        assert.throws(
            () => assertOneTenant(undefined),
            (error) => error instanceof TenantIdRefused && error.problem === 'missing',
        );
    });

    test('the refusal does not repeat the value, which may be anything', () => {
        assert.throws(
            () => assertOneTenant(' secret@x'),
            (error) =>
                error instanceof TenantIdRefused &&
                error.problem === 'surrounding-space' &&
                error.name === 'TenantIdRefused' &&
                !error.message.includes('secret'),
        );
    });
});
