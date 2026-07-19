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
    test('akzeptiert nicht-leere Note (getrimmt)', () => {
        assert.equal(assertChangeNote('  Preis-Update  '), 'Preis-Update');
    });

    test('lehnt leere Note ab', () => {
        assert.throws(() => assertChangeNote(''), {
            name: 'PublishValidationError',
            code: 'CHANGE_NOTE_REQUIRED',
        });
    });

    test('lehnt null/undefined ab', () => {
        assert.throws(() => assertChangeNote(null), { code: 'CHANGE_NOTE_REQUIRED' });
        assert.throws(() => assertChangeNote(undefined), { code: 'CHANGE_NOTE_REQUIRED' });
    });

    test('lehnt nur-Whitespace ab', () => {
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

    test('akzeptiert frischen Draft', () => {
        assert.doesNotThrow(() => assertDraftPublishable(ok, 'pv-1'));
    });

    test('null-Draft → NOT_FOUND', () => {
        assert.throws(() => assertDraftPublishable(null, 'pv-1'), { code: 'NOT_FOUND' });
    });

    test('publizierter Draft → ALREADY_PUBLISHED', () => {
        assert.throws(() => assertDraftPublishable({ ...ok, publishedAt: new Date() }, 'pv-1'), {
            code: 'ALREADY_PUBLISHED',
        });
    });

    test('Draft ohne baseVersionId → NO_BASE_VERSION', () => {
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

    test('akzeptiert nicht-abgelöste Base', () => {
        assert.doesNotThrow(() => assertBaseVersionFresh(ok, 'pv-base', 'STANDARD v3'));
    });

    test('null-Base → BASE_NOT_FOUND', () => {
        assert.throws(() => assertBaseVersionFresh(null, 'pv-base', 'STANDARD v3'), {
            code: 'BASE_NOT_FOUND',
        });
    });

    test('abgelöste Base → BASE_SUPERSEDED', () => {
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
    test('akzeptiert genau 1 Update', () => {
        assert.doesNotThrow(() => assertOptimisticLockHeld(1, 'pv-1'));
    });

    test('0 Updates → OPTIMISTIC_LOCK_CONFLICT', () => {
        assert.throws(() => assertOptimisticLockHeld(0, 'pv-1'), {
            code: 'OPTIMISTIC_LOCK_CONFLICT',
        });
    });

    test('mehrere Updates → OPTIMISTIC_LOCK_CONFLICT', () => {
        assert.throws(() => assertOptimisticLockHeld(2, 'pv-1'), {
            code: 'OPTIMISTIC_LOCK_CONFLICT',
        });
    });
});

describe('PublishValidationError', () => {
    test('hat name + code', () => {
        const e = new PublishValidationError('NOT_FOUND', 'msg');
        assert.equal(e.name, 'PublishValidationError');
        assert.equal(e.code, 'NOT_FOUND');
        assert.equal(e.message, 'msg');
    });
});
