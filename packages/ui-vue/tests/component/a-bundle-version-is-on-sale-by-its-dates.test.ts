import { describe, expect, test } from 'vitest';
import type { BundleVersionRow } from '@saasicat/core';

import {
    bundleAggregate,
    bundleVersionStatus,
} from '../../src/features/bundle/internal/bundle-version-status.js';

// The admin names a bundle version the way the platform sells it. Version 1
// sells from January; version 2 is published in May with a start in June,
// which supersedes version 1 at once and gives it 31 May as its last day.
// Until then version 1 is the one a tenant books, so it is on sale here too.

const at = (instant: string): Date => new Date(instant);

function version(fields: Partial<BundleVersionRow> & { id: string }): BundleVersionRow {
    return {
        bundleId: 'b-1',
        bundleKey: 'REPORTS',
        label: 'Reports',
        version: 1,
        features: [],
        quotas: {},
        compatibility: {},
        pricingOverrides: [],
        monthlyNet: '9.90',
        yearlyNet: null,
        marketed: true,
        publishedAt: '2026-01-01T00:00:00.000Z',
        supersededAt: null,
        validFrom: null,
        validUntil: null,
        ...fields,
    } as BundleVersionRow;
}

const PREDECESSOR = version({
    id: 'bv-1',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-05-31T00:00:00.000Z',
    supersededAt: '2026-05-10T00:00:00.000Z',
});
const SUCCESSOR = version({ id: 'bv-2', version: 2, validFrom: '2026-06-01T00:00:00.000Z' });

// @requirement SC-PLAN-028 — The admin says whether a version is on sale by the rule a booking follows
describe('a bundle version in the admin', () => {
    test('is on sale, though a successor has superseded it', () => {
        expect(bundleVersionStatus(PREDECESSOR, at('2026-05-15T12:00:00Z'))).toBe('on-sale');
        expect(bundleVersionStatus(SUCCESSOR, at('2026-05-15T12:00:00Z'))).toBe('scheduled');
        expect(bundleAggregate([PREDECESSOR, SUCCESSOR], null, at('2026-05-15T12:00:00Z'))).toEqual(
            {
                status: 'on-sale',
                version: PREDECESSOR,
            },
        );
    });

    test('stays on sale for the whole of its last day', () => {
        expect(bundleVersionStatus(PREDECESSOR, at('2026-05-31T23:00:00Z'))).toBe('on-sale');
    });

    test('is off sale once its successor has started', () => {
        expect(bundleVersionStatus(PREDECESSOR, at('2026-06-01T00:00:00Z'))).toBe('off-sale');
        expect(bundleVersionStatus(SUCCESSOR, at('2026-06-01T00:00:00Z'))).toBe('on-sale');
    });

    test('is off sale when it was superseded without a last day', () => {
        const legacy = version({ id: 'bv-0', supersededAt: '2026-05-10T00:00:00.000Z' });
        expect(bundleVersionStatus(legacy, at('2026-05-15T12:00:00Z'))).toBe('off-sale');
    });

    test('is not scheduled when it was superseded before it ever started', () => {
        // Its window closed on 30 April, a month before its own start.
        const never = version({
            id: 'bv-x',
            validFrom: '2026-06-01T00:00:00.000Z',
            validUntil: '2026-04-30T00:00:00.000Z',
            supersededAt: '2026-04-20T00:00:00.000Z',
        });
        expect(bundleVersionStatus(never, at('2026-04-25T12:00:00Z'))).not.toBe('scheduled');
    });

    test('is a draft until it is published', () => {
        const draft = version({ id: 'bv-d', publishedAt: null });
        expect(bundleVersionStatus(draft, at('2026-05-15T12:00:00Z'))).toBe('draft');
    });

    test('names the bundle by the version that decides its state', () => {
        const now = at('2026-05-15T12:00:00Z');
        expect(bundleAggregate([SUCCESSOR], null, now)).toEqual({
            status: 'scheduled',
            version: SUCCESSOR,
        });
        const draft = version({ id: 'bv-d', publishedAt: null });
        expect(bundleAggregate([draft], null, now)).toEqual({ status: 'draft', version: draft });
        const ended = version({ id: 'bv-e', supersededAt: '2026-05-10T00:00:00.000Z' });
        expect(bundleAggregate([ended], null, now)).toEqual({ status: 'off-sale', version: ended });
        expect(bundleAggregate([PREDECESSOR], '2026-05-01T00:00:00.000Z', now).status).toBe(
            'retired',
        );
    });
});
