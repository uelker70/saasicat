// The previews of ending at once after a feature was withdrawn are open to
// every signed-in user of the tenant, and say whether the reader may end:
// ending is the administrator's (`SC-ADM-026`).

// @requirement SC-ADM-026 — The administrator changes what the tenant pays; billing needs the billing permission

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';

import { FeatureWithdrawalTenantController } from '../dist/billing/index.js';

const PREVIEW = { creditNet: 14.2, currency: 'EUR' };

/** The route, over endings that answer `PREVIEW` and record what they were asked. */
function route() {
    const asked = [];
    const endings = {
        preview: async (tenantId, withdrawalId, bookingId) => {
            asked.push([tenantId, withdrawalId, bookingId]);
            return PREVIEW;
        },
    };
    return { controller: new FeatureWithdrawalTenantController(endings), asked };
}

const as = (role) => ({ user: { tenantId: 't1', sub: 'u1', role } });

describe('an end-at-once preview', () => {
    test('says the administrator may end the subscription', async () => {
        const { controller } = route();
        assert.deepEqual(await controller.previewEnd(as('TENANT_ADMIN'), 'w-1'), {
            ...PREVIEW,
            mayEnd: true,
        });
    });

    test('shows another user what ending would credit, and says they may not end it', async () => {
        const { controller, asked } = route();
        assert.deepEqual(await controller.previewEnd(as('TENANT_USER'), 'w-1'), {
            ...PREVIEW,
            mayEnd: false,
        });
        assert.deepEqual(asked, [['t1', 'w-1', null]]);
    });

    test('of one booking says the same', async () => {
        const { controller } = route();
        const preview = await controller.previewBookingEnd(as('TENANT_USER'), 'w-1', 'b-1');
        assert.equal(preview.mayEnd, false);
    });
});
