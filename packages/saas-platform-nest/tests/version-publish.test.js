import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PublishValidationError,
    assertBaseVersionFresh,
    assertChangeNote,
    assertDraftPublishable,
    assertOptimisticLockHeld,
} from '../dist/billing/index.js';

describe('assertChangeNote', () => {
    test('accepts a non-empty note (trimmed)', () => {
        assert.equal(assertChangeNote('  Preis-Update  '), 'Preis-Update');
    });

    test('rejects an empty note', () => {
        assert.throws(() => assertChangeNote(''), {
            name: 'PublishValidationError',
            code: 'CHANGE_NOTE_REQUIRED',
        });
    });

    test('rejects null/undefined', () => {
        assert.throws(() => assertChangeNote(null), { code: 'CHANGE_NOTE_REQUIRED' });
        assert.throws(() => assertChangeNote(undefined), { code: 'CHANGE_NOTE_REQUIRED' });
    });

    test('rejects whitespace-only', () => {
        assert.throws(() => assertChangeNote('   \n\t  '), { code: 'CHANGE_NOTE_REQUIRED' });
    });
});

describe('assertDraftPublishable', () => {
    const ok = {
        id: 'pv-1',
        publishedAt: null,
        supersededAt: null,
        baseVersionId: 'pv-base',
    };

    test('accepts a fresh draft', () => {
        assert.doesNotThrow(() => assertDraftPublishable(ok, 'pv-1'));
    });

    test('null draft → NOT_FOUND', () => {
        assert.throws(() => assertDraftPublishable(null, 'pv-1'), { code: 'NOT_FOUND' });
    });

    test('published draft → ALREADY_PUBLISHED', () => {
        assert.throws(() => assertDraftPublishable({ ...ok, publishedAt: new Date() }, 'pv-1'), {
            code: 'ALREADY_PUBLISHED',
        });
    });

    test('draft without baseVersionId → NO_BASE_VERSION', () => {
        assert.throws(() => assertDraftPublishable({ ...ok, baseVersionId: null }, 'pv-1'), {
            code: 'NO_BASE_VERSION',
        });
    });
});

describe('assertBaseVersionFresh', () => {
    const ok = {
        id: 'pv-base',
        publishedAt: new Date('2026-01-01'),
        supersededAt: null,
        baseVersionId: null,
    };

    test('accepts a non-superseded base', () => {
        assert.doesNotThrow(() => assertBaseVersionFresh(ok, 'pv-base', 'STANDARD v3'));
    });

    test('null base → BASE_NOT_FOUND', () => {
        assert.throws(() => assertBaseVersionFresh(null, 'pv-base', 'STANDARD v3'), {
            code: 'BASE_NOT_FOUND',
        });
    });

    test('superseded base → BASE_SUPERSEDED', () => {
        assert.throws(
            () =>
                assertBaseVersionFresh(
                    { ...ok, supersededAt: new Date() },
                    'pv-base',
                    'STANDARD v3',
                ),
            { code: 'BASE_SUPERSEDED' },
        );
    });
});

describe('assertOptimisticLockHeld', () => {
    test('accepts exactly 1 update', () => {
        assert.doesNotThrow(() => assertOptimisticLockHeld(1, 'pv-1'));
    });

    test('0 updates → OPTIMISTIC_LOCK_CONFLICT', () => {
        assert.throws(() => assertOptimisticLockHeld(0, 'pv-1'), {
            code: 'OPTIMISTIC_LOCK_CONFLICT',
        });
    });

    test('multiple updates → OPTIMISTIC_LOCK_CONFLICT', () => {
        assert.throws(() => assertOptimisticLockHeld(2, 'pv-1'), {
            code: 'OPTIMISTIC_LOCK_CONFLICT',
        });
    });
});

describe('PublishValidationError', () => {
    test('has name + code', () => {
        const e = new PublishValidationError('NOT_FOUND', 'msg');
        assert.equal(e.name, 'PublishValidationError');
        assert.equal(e.code, 'NOT_FOUND');
        assert.equal(e.message, 'msg');
    });
});
