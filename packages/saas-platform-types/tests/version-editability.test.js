import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isVersionEditable } from '../dist/index.js';

const NOW = new Date('2026-05-25T12:00:00Z');

function version(overrides = {}) {
    return {
        id: 'version-1',
        publishedAt: '2026-05-01T00:00:00Z',
        supersededAt: null,
        validFrom: '2026-06-01T00:00:00Z',
        validUntil: null,
        isLatestInChain: true,
        subscriptionCount: 0,
        ...overrides,
    };
}

describe('isVersionEditable', () => {
    test('Drafts bleiben editierbar', () => {
        assert.deepEqual(isVersionEditable(version({ publishedAt: null }), NOW), {
            editable: true,
            reason: 'draft',
        });
    });

    test('published-but-future ist nur latest-in-chain ohne Subscription editierbar', () => {
        assert.deepEqual(isVersionEditable(version(), NOW), {
            editable: true,
            reason: 'pre-active',
        });
    });

    test('subscriptionCount undefined blockiert fail-closed', () => {
        assert.equal(
            isVersionEditable(version({ subscriptionCount: undefined }), NOW).editable,
            false,
        );
    });

    test('referenzierte Versionen bleiben eingefroren', () => {
        assert.equal(isVersionEditable(version({ subscriptionCount: 1 }), NOW).editable, false);
    });

    test('nicht-latest, superseded und bereits aktive Versionen bleiben eingefroren', () => {
        assert.equal(isVersionEditable(version({ isLatestInChain: false }), NOW).editable, false);
        assert.equal(
            isVersionEditable(version({ supersededAt: '2026-05-20T00:00:00Z' }), NOW).editable,
            false,
        );
        assert.equal(
            isVersionEditable(version({ validFrom: '2026-05-25T12:00:00Z' }), NOW).editable,
            false,
        );
    });
});
