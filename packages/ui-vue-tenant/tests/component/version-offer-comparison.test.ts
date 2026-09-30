// What the offer card compares, read off an offer: the rules apart from the
// drawing, so a row that goes missing is found here rather than on a screen.

import { describe, expect, test } from 'vitest';
import type { VersionOfferView } from '@saasicat/core';

import {
    offerAsksFirst,
    offerFeatureChanges,
    offerPriceRows,
    offerQuotaRows,
    offerTone,
} from '../../src/tenant-plan-section/version-offer-comparison.js';

const side = (overrides: Partial<VersionOfferView['bound']> = {}): VersionOfferView['bound'] => ({
    planVersionId: 'pv-1',
    version: 1,
    features: ['DASHBOARD', 'EXPORT'],
    quotas: { users: 5, vehicles: 100 },
    monthlyNet: 49,
    yearlyNet: 490,
    validUntil: null,
    endsAt: null,
    ...overrides,
});

const offer = (offered: Partial<VersionOfferView['offered']>): VersionOfferView => ({
    plan: 'STANDARD',
    bound: side(),
    offered: side({ planVersionId: 'pv-2', version: 2, ...offered }),
    class: 'improvement',
    changes: [],
    takesEffectAt: '2026-10-15T09:00:00.000Z',
});

describe('the rows compared', () => {
    test('a price per rhythm, null where a version is not sold in it', () => {
        expect(offerPriceRows(offer({ monthlyNet: 59, yearlyNet: null }))).toEqual([
            { rhythm: 'MONTHLY', bound: 49, offered: 59 },
            { rhythm: 'YEARLY', bound: 490, offered: null },
        ]);
    });

    test("every quota either carries, the bound version's first, one it lacks allowing nothing", () => {
        expect(offerQuotaRows(offer({ quotas: { storage: 10, users: 8 } }))).toEqual([
            { key: 'users', bound: 5, offered: 8 },
            { key: 'vehicles', bound: 100, offered: 0 },
            { key: 'storage', bound: 0, offered: 10 },
        ]);
    });

    test('the features added and the ones no longer there, in their own order', () => {
        expect(offerFeatureChanges(offer({ features: ['API', 'DASHBOARD'] }))).toEqual({
            added: ['API'],
            removed: ['EXPORT'],
        });
    });

    test('the same set of features, reordered, is no change', () => {
        expect(offerFeatureChanges(offer({ features: ['EXPORT', 'DASHBOARD'] }))).toEqual({
            added: [],
            removed: [],
        });
    });
});

describe('the kind of offer', () => {
    test('is shown in a tone of its own, and says the same in words', () => {
        expect(offerTone('improvement')).toBe('positive');
        expect(offerTone('more-for-more')).toBe('info');
        expect(offerTone('takes-something-away')).toBe('warning');
    });

    test('asks first where it costs more or takes something away, not for an improvement', () => {
        expect(offerAsksFirst('improvement')).toBe(false);
        expect(offerAsksFirst('more-for-more')).toBe(true);
        expect(offerAsksFirst('takes-something-away')).toBe(true);
    });
});
