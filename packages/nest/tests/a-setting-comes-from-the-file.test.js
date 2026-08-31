// The two commercial settings come from `config/saas.yaml` and from nowhere
// else.
//
// The loader tests hold the file to carrying them. These hold the other half:
// that the value reaching the code is the one in the file, and that an
// application still passing the old module option is told rather than ignored.
//
// Ignoring it is the outcome worth a test of its own. The value an operator set
// is the one they believe is running, so a silently dropped
// `cancellationNoticeDays: 30` does not fail — it works, differently, until a
// customer's cancellation lands a period late and the file says something
// nobody wrote.

// @requirement SC-CFG-001 — A setting lives in exactly one place
// @requirement SC-CFG-002 — Settings with a money or a legal consequence live in the configuration file

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { SaaSiCatModule } from '../dist/platform/index.js';
import {
    CANCELLATION_NOTICE_DAYS_TOKEN,
    SELF_SERVICE_BLOCKED_PLANS_TOKEN,
    PLAN_CATALOG_TOKEN,
    noticeDaysFor,
} from '../dist/billing/index.js';

const NOTICE = { monthly: 14, yearly: 90 };
const BLOCKED = { asTarget: ['ENTERPRISE'], asSource: ['ENTERPRISE'] };

class FakeJwtGuard {
    canActivate() {
        return true;
    }
}

const catalogWith = (tenantBilling) => ({
    schemaVersion: 1,
    app: { name: 'TestApp' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling,
    plans: [{ id: 'PRO', name: 'Pro', monthlyNet: 9, yearlyNet: 90, features: [], quotas: {} }],
});

const spec = {};
const PERSISTENCE = {
    capabilities: {
        transactions: true,
        pessimisticLocking: true,
        rowLevelSecurity: false,
        advisoryLocks: false,
    },
    core: { mfa: spec, audit: spec, rlsBypass: spec, transactionRunner: spec },
    entitlement: {
        subscriptionRepository: { findByTenantId: async () => null },
        planVersionRepository: { findLatestLive: async () => null, findById: async () => null },
    },
    catalog: { bundleRepository: spec },
};

/** Composed the way a consumer composes it — the container is the thing under test. */
async function boot(catalog, tenantBillingExtras = {}) {
    return Test.createTestingModule({
        imports: [
            SaaSiCatModule.forRoot({
                planCatalog: catalog,
                controller: { guards: [FakeJwtGuard] },
                discoverySnapshotPath: null,
                persistence: PERSISTENCE,
                tenantBilling: {
                    authGuards: { jwt: FakeJwtGuard },
                    subscriptionUsagePort: { findForTenant: async () => null },
                    usageSnapshotPort: { snapshot: async () => ({}) },
                    subscriptionWritePort: {},
                    ...tenantBillingExtras,
                },
                entitlement: { defaultPlanId: 'PRO' },
            }),
        ],
    }).compile();
}

describe('the value the code runs on is the value in the file', () => {
    test('the notice period reaches the token from the catalogue', async () => {
        const app = await boot(
            catalogWith({ cancellationNoticeDays: NOTICE, selfServiceBlockedPlans: BLOCKED }),
        );
        assert.deepEqual(app.get(CANCELLATION_NOTICE_DAYS_TOKEN), NOTICE);
        // And through the function that reads it, per rhythm — a token holding
        // the right object and a reader picking the wrong member is still wrong.
        assert.equal(noticeDaysFor(app.get(CANCELLATION_NOTICE_DAYS_TOKEN), 'MONTHLY'), 14);
        assert.equal(noticeDaysFor(app.get(CANCELLATION_NOTICE_DAYS_TOKEN), 'YEARLY'), 90);
    });

    test('the blocked plans reach their token from the catalogue', async () => {
        const app = await boot(
            catalogWith({ cancellationNoticeDays: NOTICE, selfServiceBlockedPlans: BLOCKED }),
        );
        assert.deepEqual(app.get(SELF_SERVICE_BLOCKED_PLANS_TOKEN), BLOCKED);
    });

    test('a second catalogue gives a second answer — nothing is baked in', async () => {
        const app = await boot(
            catalogWith({
                cancellationNoticeDays: { monthly: 0, yearly: 0 },
                selfServiceBlockedPlans: { asTarget: [], asSource: [] },
            }),
        );
        assert.deepEqual(app.get(CANCELLATION_NOTICE_DAYS_TOKEN), { monthly: 0, yearly: 0 });
        assert.deepEqual(app.get(PLAN_CATALOG_TOKEN).tenantBilling.selfServiceBlockedPlans, {
            asTarget: [],
            asSource: [],
        });
    });
});

describe('an option that moved refuses the boot', () => {
    for (const [option, value] of [
        ['cancellationNoticeDays', { monthly: 30, yearly: 30 }],
        ['selfServiceBlockedPlans', { asTarget: ['ENTERPRISE'], asSource: [] }],
    ]) {
        test(`${option} is refused, and the message says where it went`, async () => {
            await assert.rejects(
                () =>
                    boot(
                        catalogWith({
                            cancellationNoticeDays: NOTICE,
                            selfServiceBlockedPlans: BLOCKED,
                        }),
                        { [option]: value },
                    ),
                (error) => {
                    // `includes`, not `new RegExp(option)`: a name turned into
                    // a pattern is a pattern the name's punctuation can change.
                    assert.ok(error.message.includes(option), error.message);
                    assert.match(error.message, /config\/saas\.yaml/);
                    return true;
                },
            );
        });
    }

    test('both at once are named together, so the fix is one pass', async () => {
        await assert.rejects(
            () =>
                boot(
                    catalogWith({
                        cancellationNoticeDays: NOTICE,
                        selfServiceBlockedPlans: BLOCKED,
                    }),
                    {
                        cancellationNoticeDays: { monthly: 30, yearly: 30 },
                        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
                    },
                ),
            (error) => {
                assert.match(error.message, /cancellationNoticeDays/);
                assert.match(error.message, /selfServiceBlockedPlans/);
                return true;
            },
        );
    });

    // `undefined` is not "passed": an app spreading an options object where the
    // key happens to be absent would otherwise be refused for a value it never
    // set, and the refusal would read as a platform bug.
    test('an explicitly undefined option is not a passed option', async () => {
        const app = await boot(
            catalogWith({ cancellationNoticeDays: NOTICE, selfServiceBlockedPlans: BLOCKED }),
            { cancellationNoticeDays: undefined },
        );
        assert.deepEqual(app.get(CANCELLATION_NOTICE_DAYS_TOKEN), NOTICE);
    });
});

describe('a catalogue assembled in code without the section', () => {
    // Reachable: `dbCatalog` and `planCatalog` both take an object, and only
    // the file path runs through the loader. Without this the failure is
    // `Cannot read properties of undefined` out of a Nest factory.
    test('names the field and the file rather than throwing a TypeError', async () => {
        await assert.rejects(
            () => boot(catalogWith(undefined)),
            (error) => {
                assert.match(error.message, /tenantBilling\.cancellationNoticeDays/);
                assert.match(error.message, /config\/saas\.yaml/);
                assert.doesNotMatch(error.message, /Cannot read properties/);
                return true;
            },
        );
    });
});
