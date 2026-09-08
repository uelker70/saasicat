// On the database path the settings come from `config/saas.yaml` — by
// construction now, rather than by everybody agreeing to forward them.
//
// `dbCatalog` used to take `app`, `currency`, `vatRate` and `tenantBilling` as
// values, and both real consumers copied them out of the file they had loaded
// for their own purposes. Nothing stopped an application typing a notice
// period straight into that block, and the record of the applied settings had
// no file to name. `dbCatalog` names the file now, the platform reads it, and
// an application still passing the values is told rather than obeyed. These
// boot real applications against a fake sink for the plans.

// @requirement SC-CFG-034 — An installation whose plans live in the database reads its settings from the file

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { CATALOGUE_KEYS, settingsSubtreeOf } from '@saasicat/core';
import { planCatalogSchema } from '@saasicat/spec';

import { SaaSiCatModule } from '../dist/platform/index.js';
import { PLAN_CATALOG_TOKEN, loadPlanCatalogFromFile } from '../dist/billing/index.js';
import { SETTINGS_SOURCE_TOKEN } from '../dist/index.js';
import { FakeAppliedSettingsPort } from './helpers/applied-settings-port.js';

// Every settings block the schema declares, so that a block the chain dropped
// shows up as missing rather than never being compared. `plans` is here on
// purpose: it is what a database-path file keeps as the seed for
// `saasicat catalog import`, and it must not become the catalogue.
const LINES = [
    'schemaVersion: 1',
    'app: { name: FromFile, version: 1.2.3 }',
    'currency: EUR',
    'vatRate: ${VAT}',
    'tenantBilling:',
    '  cancellationNoticeDays: { monthly: 14, yearly: 90 }',
    '  selfServiceBlockedPlans: { asTarget: [ENTERPRISE], asSource: [] }',
    'marketing: { availableLocales: [en, de] }',
    'notifications: { settingsChanged: [ops@example.com] }',
    'plans:',
    '  - { id: SEED, name: Seed, monthlyNet: 1, yearlyNet: 10, features: [], quotas: { users: 1 } }',
];
const ENV = { VAT: '19' };

class FakeJwtGuard {
    canActivate() {
        return true;
    }
}

/** What the database holds: one plan, which the file does not know. */
const fakeSink = () => ({
    loadSnapshot: async () => ({
        plans: [{ planKey: 'PRO', label: 'Pro', description: null, sortOrder: 1, deletedAt: null }],
        livePlanVersions: [
            {
                planId: 'PRO',
                marketed: true,
                monthlyNet: '9',
                yearlyNet: '90',
                features: [],
                quotas: {},
            },
        ],
        featureEntries: [],
    }),
});

const spec = {};
const persistenceWith = (appliedSettings) => ({
    capabilities: {
        transactions: true,
        pessimisticLocking: true,
        rowLevelSecurity: false,
        advisoryLocks: false,
    },
    core: { mfa: spec, audit: spec, rlsBypass: spec, transactionRunner: spec, appliedSettings },
});

const scratch = [];
const apps = [];
afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchDir() {
    const dir = mkdtempSync(join(tmpdir(), 'saasicat-db-path-'));
    scratch.push(dir);
    return dir;
}

function fileWith(lines = LINES) {
    const path = join(scratchDir(), 'saas.yaml');
    writeFileSync(path, lines.join('\n'));
    return path;
}

/** Composed the way a consumer on the database path composes it. */
function forRootWith(dbCatalog, port = new FakeAppliedSettingsPort()) {
    return SaaSiCatModule.forRoot({
        dbCatalog,
        controller: { guards: [FakeJwtGuard] },
        discoverySnapshotPath: null,
        persistence: persistenceWith(port),
        adapters: { planCatalogReadSink: fakeSink() },
        defaultPlanId: 'PRO',
    });
}

async function boot(dbCatalog, port) {
    const app = await Test.createTestingModule({
        imports: [forRootWith(dbCatalog, port)],
    }).compile();
    await app.init();
    apps.push(app);
    return app;
}

describe('the settings an installation with a database catalogue runs on', () => {
    test('are the ones in the file dbCatalog names, every block the schema declares', async () => {
        const path = fileWith();
        const app = await boot({ path, env: ENV });
        const running = settingsSubtreeOf(app.get(PLAN_CATALOG_TOKEN));

        assert.deepEqual(running, settingsSubtreeOf(loadPlanCatalogFromFile({ path, env: ENV })));

        const declared = Object.keys(planCatalogSchema.properties).filter(
            (key) => !CATALOGUE_KEYS.has(key),
        );
        assert.deepEqual(
            Object.keys(running).sort(),
            declared.sort(),
            'a settings block the schema declares is not in the fixture, or did not reach the ' +
                'running catalogue — either way this test no longer asks its question',
        );
    });

    test('a variable the file names resolves through the environment dbCatalog is given', async () => {
        const app = await boot({ path: fileWith(), env: { VAT: '7' } });
        assert.equal(app.get(PLAN_CATALOG_TOKEN).vatRate, 7);
    });

    test('the plans come from the database; a plans block in the file is the seed, not the catalogue', async () => {
        const app = await boot({ path: fileWith(), env: ENV });
        assert.deepEqual(
            app.get(PLAN_CATALOG_TOKEN).plans.map((plan) => plan.id),
            ['PRO'],
        );
    });
});

// @requirement SC-CFG-027 — The record says where the values came from
describe('where the record says the values came from, on the database path', () => {
    test('the absolute path of the file dbCatalog names', async () => {
        const port = new FakeAppliedSettingsPort();
        const path = fileWith();
        const app = await boot({ path, env: ENV }, port);
        assert.equal(port.applied.source, path);
        assert.equal(app.get(SETTINGS_SOURCE_TOKEN), path);
    });
});

// @requirement SC-CFG-016 — A setting that moved out of code is removed, not deprecated
describe('a dbCatalog that still carries the values', () => {
    const VALUES = {
        app: { name: 'Typed' },
        currency: 'EUR',
        vatRate: 19,
        tenantBilling: {
            cancellationNoticeDays: { monthly: 0, yearly: 0 },
            selfServiceBlockedPlans: { asTarget: [], asSource: [] },
        },
    };

    test('refuses the boot, naming what the option takes now', () => {
        assert.throws(
            () => forRootWith(VALUES),
            (error) => {
                assert.match(error.message, /catalog\.db-catalog-names-the-file/);
                assert.match(error.message, /dbCatalog: \{ path: 'config\/saas\.yaml' \}/);
                assert.match(error.message, /upgrade-to-1\.0/);
                return true;
            },
        );
    });

    test('is one finding, not two: the name it also carries is not reported on top', () => {
        assert.throws(() => forRootWith(VALUES), /1 configuration problem/);
    });

    test('and a blank path is the same omission', () => {
        assert.throws(() => forRootWith({ path: '   ' }), /catalog\.db-catalog-names-the-file/);
    });
});

describe('a file that does not load', () => {
    test("stops the boot with the loader's error, naming the path", () => {
        const missing = join(scratchDir(), 'missing.yaml');
        assert.throws(
            () => forRootWith({ path: missing }),
            (error) => {
                assert.match(error.message, /missing\.yaml/);
                return true;
            },
        );
    });

    test('or the field it is missing, rather than a TypeError further down', () => {
        const withoutTheSection = LINES.filter(
            (line) => !/tenantBilling|cancellationNoticeDays|selfServiceBlockedPlans/.test(line),
        );
        assert.throws(
            () => forRootWith({ path: fileWith(withoutTheSection), env: ENV }),
            (error) => {
                assert.match(error.message, /tenantBilling/);
                assert.doesNotMatch(error.message, /Cannot read properties/);
                return true;
            },
        );
    });
});
