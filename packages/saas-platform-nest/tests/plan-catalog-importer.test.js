import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlanCatalogImporterService } from '../dist/billing/index.js';

// SPEC_V2 §11.1 M6 Pack 2c — Plan-Importer-Tests.
//
// FakeSink mit In-Memory-Map; Idempotenz via Primary-Key-Match.

class FakeSink {
    constructor() {
        this.plans = new Map(); // key: `${projectKey}:${planKey}` → input
        this.planVersions = new Map(); // key: `${planKey}:v${version}` → input
        this.featureEntries = new Map(); // key: `${projectKey}:${featureKey}` → input
    }

    async upsertPlan(input) {
        const k = `${input.projectKey}:${input.planKey}`;
        if (this.plans.has(k)) return { created: false, skipReason: 'exists' };
        this.plans.set(k, input);
        return { created: true };
    }

    async upsertPlanVersion(input) {
        const k = `${input.planKey}:v${input.version}`;
        if (this.planVersions.has(k)) return { created: false, skipReason: 'exists' };
        this.planVersions.set(k, input);
        return { created: true };
    }

    async upsertFeatureCatalogEntry(input) {
        const k = `${input.projectKey}:${input.featureKey}`;
        if (this.featureEntries.has(k)) return { created: false, skipReason: 'exists' };
        this.featureEntries.set(k, input);
        return { created: true };
    }

}

const SAMPLE_YAML = `
schemaVersion: 1
projectKey: smoke
currency: EUR
vatRate: 19.0
features:
  - { key: CORE_IDENTITY, label: Mitglieder, tier: CORE }
  - { key: WHATSAPP, label: WhatsApp, tier: ADVANCED }
  - { key: SPORT_TEAMS, label: Teams, tier: PRO }
  - { key: SPORT_RESOURCES, label: Plätze, tier: PRO }
plans:
  - id: STARTER
    name: Starter
    monthlyNet: 9.90
    yearlyNet: 99.00
    features: [CORE_IDENTITY]
    quotas: { users: 3, members: 100 }
  - id: PRO
    name: Professional
    tagline: Für anspruchsvolle Vereine
    monthlyNet: 29.00
    yearlyNet: 290.00
    features: [CORE_IDENTITY, WHATSAPP]
    quotas: { users: 10, members: 1000 }
`;

describe('PlanCatalogImporterService', () => {
    test('importFromYaml: erste Runde → alle created', async () => {
        const sink = new FakeSink();
        const service = new PlanCatalogImporterService(sink);

        const report = await service.importFromYaml(SAMPLE_YAML);

        // Plans
        assert.equal(report.plansCreated, 2);
        assert.equal(report.plansSkipped, 0);
        assert.equal(sink.plans.get('smoke:STARTER').label, 'Starter');
        assert.equal(sink.plans.get('smoke:PRO').description, 'Für anspruchsvolle Vereine');

        // PlanVersions v1
        assert.equal(report.planVersionsCreated, 2);
        assert.equal(sink.planVersions.get('STARTER:v1').features.length, 1);
        assert.equal(sink.planVersions.get('STARTER:v1').monthlyNet, '9.90');
        assert.equal(sink.planVersions.get('STARTER:v1').publish, true);
        assert.equal(sink.planVersions.get('PRO:v1').quotas.members, 1000);

        // Features
        assert.equal(report.featureEntriesCreated, 4);
        assert.equal(sink.featureEntries.get('smoke:CORE_IDENTITY').tier, 'CORE');
        assert.equal(sink.featureEntries.get('smoke:WHATSAPP').label, 'WhatsApp');

        assert.equal(report.warnings.length, 0);
    });

    test('importFromYaml: zweiter Lauf → alle skipped (idempotent)', async () => {
        const sink = new FakeSink();
        const service = new PlanCatalogImporterService(sink);

        await service.importFromYaml(SAMPLE_YAML);
        const second = await service.importFromYaml(SAMPLE_YAML);

        assert.equal(second.plansCreated, 0);
        assert.equal(second.plansSkipped, 2);
        assert.equal(second.planVersionsCreated, 0);
        assert.equal(second.planVersionsSkipped, 2);
        assert.equal(second.featureEntriesCreated, 0);
        assert.equal(second.featureEntriesSkipped, 4);
    });

    test('importFromYaml: Plan ohne monthlyNet → Warning + skip PlanVersion', async () => {
        const yamlWithEnterprise = `
schemaVersion: 1
projectKey: smoke
currency: EUR
vatRate: 19.0
plans:
  - id: ENTERPRISE
    name: Enterprise
    monthlyNet: null
    features: []
    quotas: { users: -1 }
`;
        const sink = new FakeSink();
        const service = new PlanCatalogImporterService(sink);

        const report = await service.importFromYaml(yamlWithEnterprise);
        assert.equal(report.plansCreated, 1);
        assert.equal(report.planVersionsCreated, 0);
        assert.equal(report.warnings.length, 1);
        assert.match(report.warnings[0], /ENTERPRISE/);
    });

    test('importFromYaml: yearlyNet default = monthlyNet × 10 wenn fehlend', async () => {
        const yamlNoYearly = `
schemaVersion: 1
projectKey: smoke
currency: EUR
vatRate: 19.0
plans:
  - id: SIMPLE
    monthlyNet: 5.50
    features: []
    quotas: { users: 1 }
`;
        const sink = new FakeSink();
        const service = new PlanCatalogImporterService(sink);
        await service.importFromYaml(yamlNoYearly);

        const pv = sink.planVersions.get('SIMPLE:v1');
        assert.equal(pv.monthlyNet, '5.50');
        assert.equal(pv.yearlyNet, '55.00'); // 5.50 × 10
    });

    test('importFromYaml: ungültiges Schema → throw', async () => {
        const invalidYaml = 'not: valid_catalog';
        const sink = new FakeSink();
        const service = new PlanCatalogImporterService(sink);
        await assert.rejects(() => service.importFromYaml(invalidYaml));
    });
});
