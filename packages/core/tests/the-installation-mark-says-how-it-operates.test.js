// How an installation operates: as a test, whose documents are all marked as
// tests, or live. The operator says so on the mark of the database, so the
// operation travels with the data the documents are made from. A database
// nobody marked, or marked before a mark said how it operates, is live: a
// test operation is always somebody's deliberate step.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    INSTALLATION_OPERATIONS,
    installationOperationOf,
    installationStatus,
} from '../dist/index.js';

const MARKED_AT = new Date('2026-11-22T09:00:00.000Z');
const markOf = (identifier, testOperation) => ({
    identifier,
    testOperation,
    markedAt: MARKED_AT,
    markedBy: 'cli:ops@example.com:host',
});

describe('the operation a mark says', () => {
    test('an operator names one of two', () => {
        assert.deepEqual([...INSTALLATION_OPERATIONS], ['test', 'live']);
    });

    test('a database nobody marked is live', () => {
        assert.equal(installationOperationOf(null), 'live');
    });

    test('a mark says test or live', () => {
        assert.equal(installationOperationOf(markOf('INT', true)), 'test');
        assert.equal(installationOperationOf(markOf('PROD', false)), 'live');
    });
});

const NONE_ISSUED = { test: false, live: false };

describe('what the status of a database says', () => {
    test('whose database it is, how it operates, and what its documents recorded', () => {
        assert.deepEqual(installationStatus('INT', markOf('INT', true), NONE_ISSUED), {
            kind: 'matches',
            identifier: 'INT',
            operation: 'test',
            issued: NONE_ISSUED,
        });
        assert.deepEqual(
            installationStatus('INT', markOf('PROD', false), { test: true, live: false }),
            {
                kind: 'differs',
                expected: 'INT',
                marked: 'PROD',
                operation: 'live',
                issued: { test: true, live: false },
            },
        );
    });

    test('an unmarked database is live, and documents nobody could read are unknown', () => {
        assert.deepEqual(installationStatus('PROD', null, null), {
            kind: 'unmarked',
            expected: 'PROD',
            operation: 'live',
            issued: null,
        });
    });
});
