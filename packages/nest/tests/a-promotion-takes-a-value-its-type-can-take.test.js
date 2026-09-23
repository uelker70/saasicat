// @requirement SC-MKT-026 — A promotion is saved only with a value its type can take

// What an operator may save as a promotion's value. Only the bounds no price
// could make sense of are refused here; whether an intro price or an amount
// fits a line depends on the price it meets, and that is held where the
// promotion is resolved.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG_ERROR_CODES } from '@saasicat/core';
import { PromotionsService } from '../dist/catalog/index.js';

function fakePromotionRepo(rows = []) {
    const byId = new Map(rows.map((row) => [row.id, structuredClone(row)]));
    let seq = 0;
    return {
        byId,
        async list() {
            return [...byId.values()];
        },
        async findById(id) {
            return byId.get(id) ?? null;
        },
        async create(data) {
            const row = { id: `promotion-${++seq}`, ...structuredClone(data) };
            byId.set(row.id, row);
            return row;
        },
        async update(id, data) {
            const row = { ...byId.get(id), ...structuredClone(data) };
            byId.set(id, row);
            return row;
        },
        async delete(id) {
            byId.delete(id);
        },
    };
}

const DRAFT = {
    internalLabel: 'Spring',
    validFrom: '2026-03-01',
    validTo: '2026-05-31',
};

function refusedFor(type) {
    return (error) => {
        assert.equal(error.getResponse().code, CATALOG_ERROR_CODES.PROMOTION_VALUE_INVALID);
        assert.equal(error.getResponse().params.type, type);
        return true;
    };
}

const REFUSED = [
    ['percent', 100.01],
    ['percent', 150],
    ['percent', 0],
    ['percent', -5],
    ['percent', '10'],
    ['percent', { price: 10, months: 1 }],
    ['amount', 0],
    ['amount', -0.01],
    ['amount', Number.NaN],
    ['intro', { price: -0.01, months: 1 }],
    ['intro', { price: 10, months: 0 }],
    ['intro', { price: 10, months: 1.5 }],
    ['intro', { price: 10 }],
    ['intro', 10],
    ['intro', null],
    ['freeMonths', 0],
    ['freeMonths', 1.5],
    ['freeMonths', -1],
];

const ACCEPTED = [
    ['percent', 100],
    ['percent', 0.01],
    ['amount', 0.01],
    ['intro', { price: 0, months: 1 }],
    ['intro', { price: 9.99, months: 3 }],
    ['freeMonths', 1],
];

describe('creating a promotion', () => {
    for (const [type, value] of REFUSED) {
        test(`a ${type} of ${JSON.stringify(value)} is refused, and nothing is stored`, async () => {
            const repo = fakePromotionRepo();
            const service = new PromotionsService(repo);
            await assert.rejects(() => service.create({ ...DRAFT, type, value }), refusedFor(type));
            assert.equal(repo.byId.size, 0);
        });
    }

    for (const [type, value] of ACCEPTED) {
        test(`a ${type} of ${JSON.stringify(value)} is saved`, async () => {
            const service = new PromotionsService(fakePromotionRepo());
            const saved = await service.create({ ...DRAFT, type, value });
            assert.deepEqual(saved.value, value);
        });
    }
});

describe('changing a promotion', () => {
    const TWENTY_PER_CENT = { id: 'spring', ...DRAFT, type: 'percent', value: 20 };

    test('a value its type does not take is refused, and the stored one stays', async () => {
        const repo = fakePromotionRepo([TWENTY_PER_CENT]);
        const service = new PromotionsService(repo);
        await assert.rejects(() => service.update('spring', { value: 150 }), refusedFor('percent'));
        assert.equal(repo.byId.get('spring').value, 20);
    });

    test('a change of type alone meets the value already stored', async () => {
        // An amount of 150 is fine; a percentage of 150 is not, whichever of the
        // two fields the change named.
        const repo = fakePromotionRepo([{ ...TWENTY_PER_CENT, type: 'amount', value: 150 }]);
        const service = new PromotionsService(repo);
        await assert.rejects(
            () => service.update('spring', { type: 'percent' }),
            refusedFor('percent'),
        );
        assert.equal(repo.byId.get('spring').type, 'amount');
    });

    for (const [field, change] of [
        ['value', { value: null }],
        ['type', { type: null }],
    ]) {
        test(`a ${field} sent as null is judged as null, not as the one stored, and nothing is written`, async () => {
            const repo = fakePromotionRepo([TWENTY_PER_CENT]);
            const service = new PromotionsService(repo);
            await assert.rejects(
                () => service.update('spring', change),
                (error) => error.getResponse().code === CATALOG_ERROR_CODES.PROMOTION_VALUE_INVALID,
            );
            assert.deepEqual(repo.byId.get('spring'), { ...TWENTY_PER_CENT });
        });
    }

    test('a change of both to a pair that fits is saved', async () => {
        const service = new PromotionsService(fakePromotionRepo([TWENTY_PER_CENT]));
        const saved = await service.update('spring', {
            type: 'intro',
            value: { price: 9, months: 2 },
        });
        assert.deepEqual(saved.value, { price: 9, months: 2 });
    });

    test('a change of another field leaves a valid value alone', async () => {
        const service = new PromotionsService(fakePromotionRepo([TWENTY_PER_CENT]));
        const saved = await service.update('spring', { internalLabel: 'Spring sale' });
        assert.equal(saved.internalLabel, 'Spring sale');
    });
});
