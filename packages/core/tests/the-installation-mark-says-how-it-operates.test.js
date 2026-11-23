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

describe('what the status of a database says', () => {
    test('whose database it is, and how it operates', () => {
        assert.deepEqual(installationStatus('INT', markOf('INT', true)), {
            kind: 'matches',
            identifier: 'INT',
            operation: 'test',
        });
        assert.deepEqual(installationStatus('INT', markOf('PROD', false)), {
            kind: 'differs',
            expected: 'INT',
            marked: 'PROD',
            operation: 'live',
        });
    });

    test('an unmarked database is live', () => {
        assert.deepEqual(installationStatus('PROD', null), {
            kind: 'unmarked',
            expected: 'PROD',
            operation: 'live',
        });
    });
});
