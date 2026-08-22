import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPromoCodeAdminController } from '../dist/promo/index.js';

test('standard promo Admin controller exposes list, create, edit and delete', async () => {
    const calls = [];
    const audits = [];
    const promos = {
        async findAll(filter) {
            calls.push(['list', filter]);
            return [];
        },
        async create(data) {
            calls.push(['create', data]);
            return { id: 'promo-1', code: data.code };
        },
        async update(id, data) {
            calls.push(['update', id, data]);
            return { id, code: 'WELCOME', ...data };
        },
        async softDelete(id) {
            calls.push(['delete', id]);
        },
    };
    const Controller = buildPromoCodeAdminController([]);
    const controller = new Controller(promos, {
        async log(entry) {
            audits.push(entry);
        },
    });
    const request = {
        user: {
            userId: 'admin-1',
            email: 'admin@example.com',
            sessionId: 'session-1',
        },
    };

    await controller.findAll({ status: 'ACTIVE', search: 'WELCOME' });
    await controller.create(request, {
        code: 'WELCOME',
        valueType: 'PERCENT',
        value: 10,
        durationType: 'ONCE',
        validUntil: '2026-12-31T00:00:00.000Z',
    });
    await controller.update(request, 'promo-1', {
        status: 'PAUSED',
        validUntil: null,
        appliesToPlans: ['PRO'],
    });
    await controller.remove(request, 'promo-1');

    assert.deepEqual(calls[0], ['list', { status: 'ACTIVE', search: 'WELCOME' }]);
    assert.equal(calls[1][0], 'create');
    assert.equal(calls[1][1].createdById, 'admin-1');
    assert.equal(calls[1][1].validUntil.toISOString(), '2026-12-31T00:00:00.000Z');
    assert.deepEqual(calls[2], [
        'update',
        'promo-1',
        { status: 'PAUSED', validUntil: null, appliesToPlans: ['PRO'] },
    ]);
    assert.deepEqual(calls[3], ['delete', 'promo-1']);
    assert.deepEqual(
        audits.map(({ action }) => action),
        ['PROMO_CODE_CREATE', 'PROMO_CODE_UPDATE', 'PROMO_CODE_DELETE'],
    );
});
