import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditTailFlow } from '../dist/index.js';

function buildHarness(stubEntries = []) {
    const calls = [];
    const port = {
        list: async (filter) => {
            calls.push(filter);
            return stubEntries;
        },
    };
    return { flow: new AuditTailFlow(port), calls };
}

const SAMPLE = {
    id: 'a1',
    createdAt: '2026-05-08T12:00:00Z',
    tenantId: null,
    userId: 'u1',
    userEmail: 'taci@example.com',
    entity: 'PromoCode',
    entityId: 'pc-12345-very-long-id',
    action: 'PROMO_CODE_CREATED',
    changes: { code: 'BLACK25' },
    actorTag: 'cli:taci@example.com:laptop',
    ipAddress: null,
    userAgent: null,
};

describe('AuditTailFlow.run — filter mapping', () => {
    test('empty filter → empty query object', async () => {
        const { flow, calls } = buildHarness();
        await flow.run();
        assert.deepEqual(calls[0], {});
    });

    test('actor → actorTag', async () => {
        const { flow, calls } = buildHarness();
        await flow.run({ actor: 'taci@example.com' });
        assert.equal(calls[0].actorTag, 'taci@example.com');
    });

    test('action + entity', async () => {
        const { flow, calls } = buildHarness();
        await flow.run({ action: 'PROMO_CODE_CREATED', entity: 'PromoCode' });
        assert.equal(calls[0].action, 'PROMO_CODE_CREATED');
        assert.equal(calls[0].entity, 'PromoCode');
    });

    test('since → from', async () => {
        const { flow, calls } = buildHarness();
        await flow.run({ since: '2026-05-01' });
        assert.equal(calls[0].from, '2026-05-01');
    });

    test('limit → pageSize', async () => {
        const { flow, calls } = buildHarness();
        await flow.run({ limit: 100 });
        assert.equal(calls[0].pageSize, 100);
    });
});

describe('AuditTailFlow.formatRows', () => {
    test('maps fields + truncated entityId', () => {
        const { flow } = buildHarness([SAMPLE]);
        const rows = flow.formatRows([SAMPLE]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].entity, 'PromoCode');
        assert.equal(rows[0].action, 'PROMO_CODE_CREATED');
        assert.match(rows[0].entityId, /…$/); // truncated
        assert.equal(rows[0].actor, 'cli:taci@example.com:laptop');
    });

    test('null-actorTag → "—"', () => {
        const { flow } = buildHarness();
        const rows = flow.formatRows([{ ...SAMPLE, actorTag: null }]);
        assert.equal(rows[0].actor, '—');
    });

    test('short entityId not truncated', () => {
        const { flow } = buildHarness();
        const rows = flow.formatRows([{ ...SAMPLE, entityId: 'pc-1' }]);
        assert.equal(rows[0].entityId, 'pc-1');
    });
});
