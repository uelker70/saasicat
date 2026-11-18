// @requirement SC-PRIC-105 — No plan period is charged while the contract names a version not bound

// A plan change written without its contract leaves the subscription bound to
// one version while the contract in force names another: the onboarding whose
// store failed after the write, or a change that could not be put back. The
// contract is what the journal prices from, so it would charge the plan the
// tenant left. No plan period is charged while that holds, and the journal
// writes the missing contract the way the change would have: a late invoice,
// never a wrong one.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { anAccount, line, utc } from './helpers/charge-journal.js';

const STANDARD = () => line('plan', 'STANDARD', 49, { sourceVersionId: 'pv-standard' });
const STARTER = () => line('plan', 'STARTER', 19, { sourceVersionId: 'pv-starter' });

/** Bound to STARTER from the window opened on `windowStart`, under a contract still naming STANDARD. */
function anAccountLeftOnStandard({ windowStart = utc('2026-03-10'), freeze = null } = {}) {
    const end = new Date(windowStart);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return anAccount({
        subscription: {
            plan: 'STARTER',
            planVersion: { id: 'pv-starter', planId: 'STARTER' },
            currentPeriodStart: windowStart,
            currentPeriodEnd: end,
        },
        freeze,
    });
}

const planCharges = (account) => account.ledger.rows.filter((row) => row.source === 'plan');

describe('a plan period under a contract naming another version than the one bound', () => {
    test('is not charged', async () => {
        const account = anAccountLeftOnStandard();
        await account.contract({
            effectiveFrom: utc('2026-01-01'),
            lineItems: [STANDARD()],
            binds: false,
        });

        await account.charge(utc('2026-03-12'));

        assert.deepEqual(planCharges(account), []);
    });

    test('is charged once the contract in force names the version bound', async () => {
        const account = anAccountLeftOnStandard();
        await account.contract({ effectiveFrom: utc('2026-03-10'), lineItems: [STARTER()] });

        await account.charge(utc('2026-03-12'));

        assert.deepEqual(
            planCharges(account).map(({ amountNet }) => amountNet),
            [19],
        );
    });

    test('is charged where the contract’s plan line names no version: there is nothing to compare', async () => {
        const account = anAccountLeftOnStandard();
        await account.contract({
            effectiveFrom: utc('2026-03-10'),
            lineItems: [line('plan', 'STARTER', 19)],
        });

        await account.charge(utc('2026-03-12'));

        assert.equal(planCharges(account).length, 1);
    });

    test('waits for a contract naming the version bound that takes effect a moment after now', async () => {
        const account = anAccountLeftOnStandard();
        await account.contract({
            effectiveFrom: utc('2026-01-01'),
            until: new Date(utc('2026-03-12').getTime() + 1),
            lineItems: [STANDARD()],
            binds: false,
        });
        await account.contract({
            effectiveFrom: new Date(utc('2026-03-12').getTime() + 1),
            lineItems: [STARTER()],
        });

        await account.charge(utc('2026-03-12'));

        assert.deepEqual(planCharges(account), [], 'the contract in force now names STANDARD');
    });

    test('is charged where that contract takes effect at the very moment', async () => {
        const account = anAccountLeftOnStandard();
        await account.contract({
            effectiveFrom: utc('2026-01-01'),
            until: utc('2026-03-12'),
            lineItems: [STANDARD()],
            binds: false,
        });
        await account.contract({ effectiveFrom: utc('2026-03-12'), lineItems: [STARTER()] });

        await account.charge(utc('2026-03-12'));

        assert.equal(planCharges(account).length, 1);
    });
});

describe('the contract the journal writes for the version bound', () => {
    /** A freeze that writes the contract for the version bound, recording what it was asked. */
    function freezeOf(accountRef, asked) {
        return {
            async freezeOnPlanChange(tenantId, plan, cycle, effectiveFrom, endsAt) {
                asked.push({ tenantId, plan, cycle, effectiveFrom, endsAt });
                const account = accountRef();
                await account.supersede(effectiveFrom);
                await account.contract({ effectiveFrom, lineItems: [STARTER()] });
            },
        };
    }

    test('takes effect when the window the change opened began, and its period is charged at its price', async () => {
        const asked = [];
        let account;
        account = anAccountLeftOnStandard({ freeze: freezeOf(() => account, asked) });
        await account.contract({
            effectiveFrom: utc('2026-01-01'),
            lineItems: [STANDARD()],
            binds: false,
        });

        await account.charge(utc('2026-03-12'));

        assert.deepEqual(asked, [
            {
                tenantId: 't1',
                plan: 'STARTER',
                cycle: 'MONTHLY',
                effectiveFrom: utc('2026-03-10'),
                endsAt: null,
            },
        ]);
        assert.deepEqual(
            planCharges(account).map(({ periodStart, amountNet }) => [periodStart, amountNet]),
            [[utc('2026-03-10'), 19]],
        );
    });

    test('takes effect now where the window began before the contract in force', async () => {
        const asked = [];
        let account;
        account = anAccountLeftOnStandard({
            windowStart: utc('2026-01-01'),
            freeze: freezeOf(() => account, asked),
        });
        await account.contract({
            effectiveFrom: utc('2026-01-05'),
            lineItems: [STANDARD()],
            binds: false,
        });

        await account.charge(utc('2026-01-12'));

        assert.deepEqual(
            asked.map(({ effectiveFrom }) => effectiveFrom),
            [utc('2026-01-12')],
        );
    });

    test('is tried again by the next call where it is refused, and nothing is charged meanwhile', async () => {
        let attempts = 0;
        const account = anAccountLeftOnStandard({
            freeze: {
                async freezeOnPlanChange() {
                    attempts += 1;
                    throw new Error('the subscriber’s address is incomplete');
                },
            },
        });
        await account.contract({
            effectiveFrom: utc('2026-01-01'),
            lineItems: [STANDARD()],
            binds: false,
        });

        await account.charge(utc('2026-03-12'));
        await account.charge(utc('2026-03-13'));

        assert.equal(attempts, 2);
        assert.deepEqual(planCharges(account), []);
    });

    test('is not written in a trial, which commits to no period', async () => {
        let attempts = 0;
        const account = anAccount({
            subscription: {
                status: 'TRIAL',
                plan: 'STARTER',
                planVersion: { id: 'pv-starter', planId: 'STARTER' },
            },
            freeze: {
                async freezeOnPlanChange() {
                    attempts += 1;
                },
            },
        });
        await account.contract({
            effectiveFrom: utc('2026-01-01'),
            lineItems: [STANDARD()],
            binds: false,
        });

        await account.charge(utc('2026-01-12'));

        assert.equal(attempts, 0);
    });
});
