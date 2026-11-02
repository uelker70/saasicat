// A subscription whose plan has no version on sale is refused by the platform's
// own check, before anything is written, naming the day it asked about — the
// installation's day, said to be a day so the tenant's page writes it in the
// application's format.

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { EntitlementService } from '../dist/entitlement/index.js';
import { entitlementServiceFor, subscriptionRecord } from './helpers/subscription-fixtures.js';

/** Half past midnight on 1 July in Berlin: still 30 June in UTC. */
const AFTER_MIDNIGHT_IN_BERLIN = new Date('2026-06-30T22:30:00.000Z');

/** A trial granted a plan the catalogue has no version of on sale. */
const TRIAL_ON_A_PLAN_OFF_SALE = subscriptionRecord({
    status: 'TRIAL',
    trialEntitlementPlan: 'RETIRED_PLAN',
});

async function refusalIn(settings) {
    const service = entitlementServiceFor(EntitlementService, TRIAL_ON_A_PLAN_OFF_SALE, {
        settings,
    });
    try {
        await service.computeLimits('t1', AFTER_MIDNIGHT_IN_BERLIN);
    } catch (error) {
        return error.getResponse();
    }
    assert.fail('the limits of a plan off sale were computed');
}

describe('a plan with no version on sale', () => {
    test('is refused naming the installation’s day, as a day', async () => {
        const refusal = await refusalIn({ timeZone: 'Europe/Berlin' });
        assert.equal(refusal.code, 'NO_ACTIVE_PLAN_VERSION');
        assert.deepEqual(refusal.params, { planId: 'RETIRED_PLAN', asOf: '2026-07-01' });
        assert.deepEqual(refusal.dayParams, ['asOf']);
    });

    test('in UTC where the settings name none', async () => {
        const refusal = await refusalIn(null);
        assert.equal(refusal.params.asOf, '2026-06-30');
    });
});
