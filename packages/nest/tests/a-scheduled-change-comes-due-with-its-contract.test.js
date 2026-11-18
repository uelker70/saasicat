// @requirement SC-CHG-026 — A scheduled plan change takes effect with its contract, or stays due

// A plan change scheduled for the end of the term is applied by a run. It ends
// in the contract that records it, or the subscription stays as it was and the
// change stays due for the next run. Applied without its contract, the
// subscription would name the new plan while the contract in force — what the
// entitlements read first and the journal charges from — names the old one: a
// downgrade charged at the old price, an upgrade granted nothing it paid for.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { UnprocessableEntityException } from '@nestjs/common';
import { SUBSCRIBER_ERROR_CODES } from '@saasicat/core';

import { PLATFORM_CORE_MANIFEST_CONTRIBUTION } from '../dist/admin/index.js';
import { PendingPlanMaterializationService } from '../dist/billing/index.js';
import { usageRecord } from './helpers/subscription-fixtures.js';

const NOW = new Date('2026-06-09T00:00:00.000Z');
const AGREED = {
    termsVersion: '2026-04',
    cancellationNoticeDays: 30,
    agreedAt: new Date('2026-04-02T08:00:00.000Z'),
};

/** STANDARD, yearly, with a downgrade to STARTER at the version it was quoted at now due. */
function standardDowngrading(overrides = {}) {
    return usageRecord({
        id: 'sub-1',
        plan: 'STANDARD',
        billingCycle: 'YEARLY',
        status: 'ACTIVE',
        currentPeriodStart: new Date('2025-06-09T00:00:00.000Z'),
        currentPeriodEnd: NOW,
        billingAnchorDay: 9,
        pendingPlan: 'STARTER',
        pendingBillingCycle: 'MONTHLY',
        pendingEffectiveAt: NOW,
        pendingChangeVersionId: 'pv-starter-2',
        pendingAgreement: AGREED,
        planVersion: { id: 'pv-standard-1', planId: 'STANDARD', version: 1 },
        ...overrides,
    });
}

function dueOf(sub, tenantId = 't1') {
    return {
        tenantId,
        pendingPlan: sub.pendingPlan,
        pendingBillingCycle: sub.pendingBillingCycle,
        pendingChangeVersionId: sub.pendingChangeVersionId,
        canceledAt: sub.canceledAt,
        canceledEffectiveAt: sub.canceledEffectiveAt,
    };
}

const identityIncomplete = () => {
    throw new UnprocessableEntityException({
        code: SUBSCRIBER_ERROR_CODES.SUBSCRIBER_IDENTITY_INCOMPLETE,
        message: 'The subscriber’s address is incomplete.',
        params: { missing: ['street'] },
    });
};

/** A store that fails, as a database does. */
const storeDown = () => {
    throw new Error('connection reset');
};

/**
 * The run over the subscriptions in `byTenant`, every port it writes to
 * recorded. `check` is what asking the contract first does, `freeze` what
 * writing it does, `takeBack` whether a write that puts a row back claims it.
 */
function theRun(
    byTenant,
    { check = async () => {}, freeze = async () => {}, takeBack = () => true, audit } = {},
) {
    const calls = {
        checked: [],
        written: [],
        frozen: [],
        audited: [],
        errors: [],
        invalidated: [],
    };
    const run = new PendingPlanMaterializationService(
        {
            findDuePendingPlanChanges: async () =>
                Object.keys(byTenant).map((t) => dueOf(byTenant[t], t)),
        },
        {
            async changePlanImmediate(tenantId, input) {
                calls.written.push({ tenantId, input });
                const claimed = input.putsBack ? takeBack() : true;
                return { plan: input.planId, billingCycle: input.cycle, claimed };
            },
        },
        { invalidateTenant: (tenantId) => calls.invalidated.push(tenantId) },
        {
            async assertContractFor(...args) {
                calls.checked.push(args);
                await check(...args);
            },
            async freezeOnPlanChange(...args) {
                calls.frozen.push(args);
                await freeze(...args);
            },
        },
        null,
        { findForTenant: async (tenantId) => byTenant[tenantId] ?? null },
        audit ?? { log: async (entry) => calls.audited.push(entry) },
    );
    run.logger = { error: (line) => calls.errors.push(line), log() {} };
    return { calls, run };
}

describe('a scheduled change whose contract is written', () => {
    test('is applied, and its contract records what was agreed when it was scheduled', async () => {
        const { calls, run } = theRun({ t1: standardDowngrading() });

        const result = await run.materializeDuePlanChanges(NOW);

        assert.equal(result.applied, 1);
        assert.equal(calls.written.length, 1, 'the change alone was written');
        assert.equal(calls.written[0].input.putsBack, undefined);
        const [[tenantId, plan, cycle, from, endsAt, terms]] = calls.frozen;
        assert.deepEqual(
            [tenantId, plan, cycle, from, endsAt],
            ['t1', 'STARTER', 'MONTHLY', NOW, null],
        );
        assert.deepEqual(terms, { agreed: AGREED });
        assert.deepEqual(calls.audited, []);
    });

    test('is asked of its whole contract first: the plan, the version quoted, the rhythm, from the run', async () => {
        const { calls, run } = theRun({ t1: standardDowngrading() });

        await run.materializeDuePlanChanges(NOW);

        assert.deepEqual(calls.checked, [
            [
                't1',
                { plan: 'STARTER', planVersionId: 'pv-starter-2' },
                { effectiveFrom: NOW, cycle: 'MONTHLY', endsAt: null },
            ],
        ]);
    });
});

describe('a scheduled change whose contract is refused before it is written', () => {
    test('is not written, stays due, and is audited with the contract’s reason', async () => {
        const { calls, run } = theRun({ t1: standardDowngrading() }, { check: identityIncomplete });

        const result = await run.materializeDuePlanChanges(NOW);

        assert.equal(result.applied, 0);
        assert.deepEqual(calls.written, [], 'nothing was written, so the change is still due');
        assert.deepEqual(calls.frozen, []);
        assert.equal(calls.audited.length, 1);
        const [entry] = calls.audited;
        assert.equal(entry.action, 'SCHEDULED_PLAN_CHANGE_FAILED');
        assert.deepEqual(entry.actor, {
            userId: null,
            email: 'platform',
            source: 'job',
            context: 'scheduled-plan-changes',
        });
        assert.equal(entry.entity, 'Subscription');
        assert.equal(entry.entityId, 'sub-1');
        assert.equal(entry.tenantId, 't1');
        assert.deepEqual(entry.changes, {
            tenantId: 't1',
            fromPlan: 'STANDARD',
            toPlan: 'STARTER',
            toCycle: 'MONTHLY',
            toPlanVersionId: 'pv-starter-2',
            reason: 'contract-refused',
            code: SUBSCRIBER_ERROR_CODES.SUBSCRIBER_IDENTITY_INCOMPLETE,
            params: { missing: ['street'] },
        });
        assert.equal(calls.errors.length, 1, 'said once in this run');
        assert.match(calls.errors[0], /t1/);
    });

    test('is tried again by every run, and audited once', async () => {
        const { calls, run } = theRun({ t1: standardDowngrading() }, { check: identityIncomplete });

        await run.materializeDuePlanChanges(NOW);
        await run.materializeDuePlanChanges(new Date(NOW.getTime() + 15 * 60_000));

        assert.equal(calls.checked.length, 2, 'the second run asked again');
        assert.equal(calls.audited.length, 1);
        assert.equal(calls.errors.length, 2, 'each run says it once');
    });

    test('is audited again by the next run where the audit entry could not be written', async () => {
        let attempts = 0;
        const { calls, run } = theRun(
            { t1: standardDowngrading() },
            {
                check: identityIncomplete,
                audit: {
                    async log() {
                        attempts += 1;
                        if (attempts === 1) throw new Error('audit store down');
                    },
                },
            },
        );

        await run.materializeDuePlanChanges(NOW);
        await run.materializeDuePlanChanges(NOW);

        assert.equal(attempts, 2);
        assert.ok(calls.errors.some((line) => line.includes('SCHEDULED_PLAN_CHANGE_FAILED')));
    });

    test('holds no other tenant back', async () => {
        const { calls, run } = theRun(
            { t1: standardDowngrading(), t2: standardDowngrading({ id: 'sub-2' }) },
            { check: (tenantId) => (tenantId === 't1' ? identityIncomplete() : undefined) },
        );

        const result = await run.materializeDuePlanChanges(NOW);

        assert.equal(result.applied, 1);
        assert.deepEqual(
            calls.written.map(({ tenantId }) => tenantId),
            ['t2'],
        );
    });
});

describe('a scheduled change whose contract cannot be written after it', () => {
    test('is put back as it was read, still due, and audited as not written', async () => {
        const read = standardDowngrading();
        const { calls, run } = theRun({ t1: read }, { freeze: storeDown });

        const result = await run.materializeDuePlanChanges(NOW);

        assert.equal(result.applied, 0);
        assert.equal(calls.written.length, 2, 'the change, then the take-back');
        const { input: back } = calls.written[1];
        assert.equal(back.planId, 'STANDARD');
        assert.equal(back.cycle, 'YEARLY');
        assert.equal(back.quotedPlanVersionId, 'pv-standard-1');
        assert.equal(
            back.expectedPlanVersionId,
            'pv-starter-2',
            'claimed on what the change bound',
        );
        assert.deepEqual(back.putsBack, {
            status: 'ACTIVE',
            currentPeriodStart: read.currentPeriodStart,
            currentPeriodEnd: read.currentPeriodEnd,
            billingAnchorDay: 9,
            scheduledChange: {
                pendingPlan: 'STARTER',
                pendingBillingCycle: 'MONTHLY',
                pendingEffectiveAt: NOW,
                pendingChangeVersionId: 'pv-starter-2',
                pendingTermsVersion: AGREED.termsVersion,
                pendingCancellationNoticeDays: AGREED.cancellationNoticeDays,
                pendingAgreedAt: AGREED.agreedAt,
            },
        });
        assert.deepEqual(
            calls.audited.map(({ action, changes }) => [action, changes.reason, changes.putBack]),
            [['SCHEDULED_PLAN_CHANGE_FAILED', 'contract-not-written', true]],
        );
        assert.ok(calls.invalidated.includes('t1'));
    });

    test('a change that keeps its version is claimed back on the version it kept', async () => {
        const { calls, run } = theRun(
            { t1: standardDowngrading({ pendingPlan: 'STANDARD', pendingChangeVersionId: null }) },
            { freeze: storeDown },
        );

        await run.materializeDuePlanChanges(NOW);

        assert.equal(calls.written[1].input.expectedPlanVersionId, 'pv-standard-1');
    });

    test('where it cannot be put back either, the audit says so', async () => {
        const { calls, run } = theRun(
            { t1: standardDowngrading() },
            { freeze: storeDown, takeBack: () => false },
        );

        const result = await run.materializeDuePlanChanges(NOW);

        assert.equal(result.applied, 0);
        assert.deepEqual(
            calls.audited.map(({ changes }) => [changes.reason, changes.putBack]),
            [['contract-not-written', false]],
        );
        assert.ok(calls.errors.some((line) => line.includes('could not be taken back')));
    });
});

describe('a scheduled change the run finds no subscription for', () => {
    test('writes nothing where contracts are frozen, since nothing could be put back', async () => {
        const { calls, run } = theRun({});
        // Due, and gone by the time the run reads it.
        run.query = { findDuePendingPlanChanges: async () => [dueOf(standardDowngrading())] };

        const result = await run.materializeDuePlanChanges(NOW);

        assert.equal(result.applied, 0);
        assert.deepEqual(calls.written, []);
        assert.equal(calls.errors.length, 1);
    });
});

describe('the audit entry of a scheduled change not made', () => {
    test('is declared, so the audit page can name it', () => {
        const declared = PLATFORM_CORE_MANIFEST_CONTRIBUTION.audit.actions.find(
            ({ key }) => key === 'SCHEDULED_PLAN_CHANGE_FAILED',
        );
        assert.ok(declared?.label);
        assert.equal(declared.severity, 'high');
    });
});
