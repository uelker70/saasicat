// DB-free smoke test — demonstrates the documented testing story
// (quickstart "What next" #5): boot the platform with
// createSaasPlatformTestModule and assert static entitlement resolves the
// example plan catalog. Runs in CI without a database.

import 'reflect-metadata';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
// StaticEntitlementService MUST come from the same entry as the test
// module factory (bundle identity — see @saasicat/nest/testing docs).
import {
    createSaasPlatformTestModule,
    StaticEntitlementService,
} from '@saasicat/nest/testing';
import { DefinesQuota } from '@saasicat/nest/discovery';

// In-memory stand-in for NotesQuotaProvider — app tests stub the counting
// side, the platform wiring stays real.
class FakeNotesQuotaProvider {
    constructor() {
        this.key = 'notesMax';
    }
    async count() {
        return 24;
    }
}
DefinesQuota({
    key: 'notesMax',
    label: 'Notes count',
    unit: 'count',
    policy: 'hardCap',
    feature: 'NOTES',
})(FakeNotesQuotaProvider);

const PLAN_CATALOG = {
    schemaVersion: 1,
    projectKey: 'notesapp',
    currency: 'EUR',
    vatRate: 19,
    plans: [
        { id: 'STARTER', features: ['NOTES'], quotas: { notesMax: 25 } },
        { id: 'PRO', features: ['NOTES', 'NOTES_EXPORT'], quotas: { notesMax: 1000 } },
    ],
};

describe('notesapp platform wiring (smoke)', () => {
    test('static entitlement resolves the STARTER plan for every tenant', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                createSaasPlatformTestModule({
                    planCatalog: PLAN_CATALOG,
                    defaultPlanId: 'STARTER',
                    quotaProviders: [FakeNotesQuotaProvider],
                }),
            ],
        }).compile();

        const entitlement = moduleRef.get(StaticEntitlementService);
        const snapshot = await entitlement.snapshot('tenant-a');
        assert.equal(snapshot.planId, 'STARTER');
        assert.ok(snapshot.features.includes('NOTES'));
        assert.ok(!snapshot.features.includes('NOTES_EXPORT'));
        assert.equal(snapshot.quotas.notesMax, 25);
        await moduleRef.close();
    });
});
