import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFINES_QUOTA_KEY,
    DiscoveryScanner,
    ENFORCE_QUOTA_KEY,
    IMPLEMENTS_CAPABILITY_KEY,
    computeSnapshotHash,
} from '../dist/discovery/index.js';

// Discovery-Scanner: aggregiert @ImplementsCapability/@DefinesQuota/
// @EnforceQuota-Annotationen zu einem DiscoverySnapshot. Wir stubben
// DiscoveryService + MetadataScanner + Reflector direkt — kein @nestjs/testing
// nötig, weil der Scanner nur die drei minimalen Public-APIs aufruft:
//   - discoveryService.getProviders() / .getControllers()
//   - metadataScanner.getAllMethodNames(prototype)
//   - reflector.get(key, target)
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §3.2

// ─────────────────────────────────────────────────────────────────
// Test-Helfer
// ─────────────────────────────────────────────────────────────────

function makeProvider({ ctorName, classMeta = {}, methodMeta = {} }) {
    // methodMeta: { methodName: { [METADATA_KEY]: value, ... } }
    const prototype = {};
    const instance = Object.create(prototype);
    for (const methodName of Object.keys(methodMeta)) {
        prototype[methodName] = function () {};
    }
    const ctor = { name: ctorName };
    Object.defineProperty(instance, 'constructor', { value: ctor });
    return { instance, classMeta, methodMeta };
}

function makeFakeDiscoveryService(providers, controllers = []) {
    const wrap = (entry) => ({ instance: entry.instance });
    return {
        getProviders: () => providers.map(wrap),
        getControllers: () => controllers.map(wrap),
    };
}

function makeFakeMetadataScanner() {
    return {
        getAllMethodNames: (prototype) =>
            prototype && typeof prototype === 'object'
                ? Object.keys(prototype).filter((k) => typeof prototype[k] === 'function')
                : [],
    };
}

function makeFakeReflector(allEntries) {
    // allEntries: array von { instance, classMeta, methodMeta } — wir bauen einen
    // Lookup von Target → Metadata-Map.
    const targetMeta = new WeakMap();
    for (const entry of allEntries) {
        targetMeta.set(entry.instance.constructor, entry.classMeta);
        const proto = Object.getPrototypeOf(entry.instance);
        for (const [methodName, meta] of Object.entries(entry.methodMeta)) {
            targetMeta.set(proto[methodName], meta);
        }
    }
    return {
        get: (key, target) => {
            const meta = targetMeta.get(target);
            return meta?.[key];
        },
    };
}

function buildScanner({ providers = [], controllers = [], appInfo } = {}) {
    const allEntries = [...providers, ...controllers];
    return new DiscoveryScanner(
        makeFakeDiscoveryService(providers, controllers),
        makeFakeMetadataScanner(),
        makeFakeReflector(allEntries),
        appInfo,
    );
}

// ─────────────────────────────────────────────────────────────────
// computeSnapshotHash — kanonisch + stabil
// ─────────────────────────────────────────────────────────────────

describe('computeSnapshotHash', () => {
    test('liefert für identische Eingaben denselben Hash', () => {
        const input = {
            schemaVersion: 1,
            scannedAt: '2026-05-12T10:00:00.000Z',
            app: { key: 'vereinsfux', version: '0.42.1' },
            capabilities: [],
            features: [],
            quotas: [],
        };
        const a = computeSnapshotHash(input);
        const b = computeSnapshotHash({ ...input });
        assert.equal(a, b);
        assert.match(a, /^sha256-[0-9a-f]{64}$/);
    });

    test('ignoriert scannedAt und app.version (Stabilität über Boot-Restarts)', () => {
        const base = {
            schemaVersion: 1,
            app: { key: 'vereinsfux', version: '0.42.1' },
            capabilities: [],
            features: [],
            quotas: [],
        };
        const a = computeSnapshotHash({
            ...base,
            scannedAt: '2026-05-12T10:00:00.000Z',
        });
        const b = computeSnapshotHash({
            ...base,
            scannedAt: '2026-05-12T20:00:00.000Z',
            app: { key: 'vereinsfux', version: '99.99.99' },
        });
        assert.equal(a, b, 'scannedAt + version dürfen Hash nicht beeinflussen');
    });

    test('ist sortier-unabhängig bei Object-Keys', () => {
        const cap = (overrides) => ({
            capabilityKey: 'invoice.create',
            label: 'Rechnung erstellen',
            feature: 'INVOICE',
            status: 'active',
            kind: 'endpoint',
            owner: null,
            replacementKey: null,
            removalPlannedAt: null,
            reason: null,
            declaredAt: 'X.create',
            ...overrides,
        });
        const a = computeSnapshotHash({
            schemaVersion: 1,
            scannedAt: 'irrelevant',
            app: { key: 'v', version: '1' },
            capabilities: [cap()],
            features: [],
            quotas: [],
        });
        // Gleicher Inhalt, andere Insertion-Order der Felder
        const reordered = {};
        const original = cap();
        for (const k of Object.keys(original).reverse()) {
            reordered[k] = original[k];
        }
        const b = computeSnapshotHash({
            schemaVersion: 1,
            scannedAt: 'irrelevant',
            app: { key: 'v', version: '1' },
            capabilities: [reordered],
            features: [],
            quotas: [],
        });
        assert.equal(a, b);
    });

    test('liefert unterschiedliche Hashes für unterschiedliche Capability-Sets', () => {
        const base = {
            schemaVersion: 1,
            scannedAt: 'irrelevant',
            app: { key: 'v', version: '1' },
            features: [],
            quotas: [],
        };
        const a = computeSnapshotHash({ ...base, capabilities: [] });
        const b = computeSnapshotHash({
            ...base,
            capabilities: [
                {
                    capabilityKey: 'x.y',
                    label: null,
                    feature: null,
                    status: 'active',
                    kind: 'endpoint',
                    owner: null,
                    replacementKey: null,
                    removalPlannedAt: null,
                    reason: null,
                    declaredAt: 'A.b',
                },
            ],
        });
        assert.notEqual(a, b);
    });
});

// ─────────────────────────────────────────────────────────────────
// Scanner: Aggregation Capabilities → Features
// (Bundles werden NICHT aggregiert — sie kommen ausschließlich aus dem
// SuperAdmin-UI; SPEC_V2 §3.1 + §11.1 M3.)
// ─────────────────────────────────────────────────────────────────

describe('DiscoveryScanner — Capability/Feature-Aggregation', () => {
    test('aggregiert Capabilities mit gleichem feature zu DiscoveredFeature', () => {
        const scanner = buildScanner({
            providers: [
                makeProvider({
                    ctorName: 'InvoiceController',
                    methodMeta: {
                        create: {
                            [IMPLEMENTS_CAPABILITY_KEY]: {
                                capabilityKey: 'invoice.create',
                                feature: 'INVOICE_MANAGEMENT',
                            },
                        },
                        cancel: {
                            [IMPLEMENTS_CAPABILITY_KEY]: {
                                capabilityKey: 'invoice.cancel',
                                feature: 'INVOICE_MANAGEMENT',
                            },
                        },
                    },
                }),
                makeProvider({
                    ctorName: 'MemberController',
                    methodMeta: {
                        list: {
                            [IMPLEMENTS_CAPABILITY_KEY]: {
                                capabilityKey: 'member.list',
                                feature: 'MEMBER_MANAGEMENT',
                            },
                        },
                    },
                }),
            ],
        });

        const snapshot = scanner.getSnapshot();
        assert.equal(snapshot.capabilities.length, 3);
        assert.equal(snapshot.features.length, 2);

        const invoiceFeature = snapshot.features.find((f) => f.featureKey === 'INVOICE_MANAGEMENT');
        assert.ok(invoiceFeature);
        assert.deepEqual(invoiceFeature.capabilityKeys, ['invoice.cancel', 'invoice.create']);
    });

    test('Capabilities ohne feature landen nicht in Feature-Aggregaten', () => {
        const scanner = buildScanner({
            providers: [
                makeProvider({
                    ctorName: 'PingController',
                    methodMeta: {
                        ping: {
                            [IMPLEMENTS_CAPABILITY_KEY]: {
                                capabilityKey: 'system.ping',
                            },
                        },
                    },
                }),
            ],
        });
        const snapshot = scanner.getSnapshot();
        assert.equal(snapshot.capabilities.length, 1);
        assert.equal(snapshot.features.length, 0);
    });

    test('Snapshot enthält kein bundles-Feld (Bundles nur aus SuperAdmin-UI)', () => {
        const scanner = buildScanner({
            providers: [
                makeProvider({
                    ctorName: 'X',
                    methodMeta: {
                        m: {
                            [IMPLEMENTS_CAPABILITY_KEY]: {
                                capabilityKey: 'x.y',
                                feature: 'F',
                            },
                        },
                    },
                }),
            ],
        });
        const snapshot = scanner.getSnapshot();
        assert.ok(!('bundles' in snapshot), 'snapshot.bundles muss entfallen sein');
    });
});

// ─────────────────────────────────────────────────────────────────
// Scanner: Quotas + Cross-Reference EnforceQuota → DiscoveredQuota.enforcedBy
// ─────────────────────────────────────────────────────────────────

describe('DiscoveryScanner — Quotas', () => {
    test('liest @DefinesQuota auf Klassen-Ebene', () => {
        const scanner = buildScanner({
            providers: [
                makeProvider({
                    ctorName: 'InvoiceQuotaProvider',
                    classMeta: {
                        [DEFINES_QUOTA_KEY]: {
                            key: 'invoicesPerMonth',
                            label: 'Rechnungen pro Monat',
                            unit: 'invoices',
                            policy: 'monthlyReset',
                            feature: 'INVOICE_MANAGEMENT',
                        },
                    },
                }),
            ],
        });
        const snapshot = scanner.getSnapshot();
        assert.equal(snapshot.quotas.length, 1);
        const quota = snapshot.quotas[0];
        assert.equal(quota.quotaKey, 'invoicesPerMonth');
        assert.equal(quota.policy, 'monthlyReset');
        assert.equal(quota.feature, 'INVOICE_MANAGEMENT');
        assert.equal(quota.declaredAt, 'InvoiceQuotaProvider');
        assert.deepEqual(quota.enforcedBy, []);
    });

    test('cross-referenziert @EnforceQuota an Capabilities mit der Quota', () => {
        const scanner = buildScanner({
            providers: [
                makeProvider({
                    ctorName: 'InvoiceQuotaProvider',
                    classMeta: {
                        [DEFINES_QUOTA_KEY]: {
                            key: 'invoicesPerMonth',
                            label: 'Rechnungen pro Monat',
                            unit: 'invoices',
                            policy: 'monthlyReset',
                        },
                    },
                }),
                makeProvider({
                    ctorName: 'InvoiceController',
                    methodMeta: {
                        create: {
                            [IMPLEMENTS_CAPABILITY_KEY]: {
                                capabilityKey: 'invoice.create',
                            },
                            [ENFORCE_QUOTA_KEY]: {
                                quotaKey: 'invoicesPerMonth',
                                incrementBy: 1,
                                timing: 'before',
                            },
                        },
                    },
                }),
            ],
        });
        const snapshot = scanner.getSnapshot();
        assert.equal(snapshot.quotas.length, 1);
        assert.deepEqual(snapshot.quotas[0].enforcedBy, ['invoice.create']);
    });
});

// ─────────────────────────────────────────────────────────────────
// Scanner: Edge-Cases — Mehrfach-Deklaration, app-info
// ─────────────────────────────────────────────────────────────────

describe('DiscoveryScanner — Edge-Cases', () => {
    test('Mehrfach-Deklaration derselben Capability: erste gewinnt', () => {
        const scanner = buildScanner({
            providers: [
                makeProvider({
                    ctorName: 'A',
                    methodMeta: {
                        create: {
                            [IMPLEMENTS_CAPABILITY_KEY]: {
                                capabilityKey: 'invoice.create',
                                label: 'Erste Deklaration',
                                feature: 'X',
                            },
                        },
                    },
                }),
                makeProvider({
                    ctorName: 'B',
                    methodMeta: {
                        create: {
                            [IMPLEMENTS_CAPABILITY_KEY]: {
                                capabilityKey: 'invoice.create',
                                label: 'Zweite Deklaration',
                                feature: 'Y',
                            },
                        },
                    },
                }),
            ],
        });
        const snapshot = scanner.getSnapshot();
        assert.equal(snapshot.capabilities.length, 1);
        assert.equal(snapshot.capabilities[0].label, 'Erste Deklaration');
        assert.equal(snapshot.capabilities[0].feature, 'X');
    });

    test('app-Info wird in den Snapshot übernommen', () => {
        const scanner = buildScanner({
            providers: [],
            appInfo: { key: 'vereinsfux', version: '0.42.1' },
        });
        const snapshot = scanner.getSnapshot();
        assert.equal(snapshot.app.key, 'vereinsfux');
        assert.equal(snapshot.app.version, '0.42.1');
    });

    test('Default-AppInfo, wenn nichts injiziert wird', () => {
        const scanner = buildScanner({ providers: [] });
        const snapshot = scanner.getSnapshot();
        assert.equal(snapshot.app.key, 'unknown');
        assert.equal(snapshot.app.version, '0.0.0');
    });

    test('rebuildSnapshot überschreibt den Cache', () => {
        const scanner = buildScanner({ providers: [] });
        const first = scanner.getSnapshot();
        const second = scanner.rebuildSnapshot();
        // Bei leerem Provider-Set sollte der Hash identisch sein, aber das
        // Snapshot-Objekt eine neue Instanz.
        assert.equal(first.hash, second.hash);
        assert.notStrictEqual(first, second);
    });
});

// ─────────────────────────────────────────────────────────────────
// requires/replaces — Discovery-Metadaten (#35/#39)
// ─────────────────────────────────────────────────────────────────

describe('DiscoveryScanner — requires/replaces (#35/#39)', () => {
    function providerWithCaps(ctorName, caps) {
        const methodMeta = {};
        for (const [methodName, meta] of Object.entries(caps)) {
            methodMeta[methodName] = { [IMPLEMENTS_CAPABILITY_KEY]: meta };
        }
        return makeProvider({ ctorName, methodMeta });
    }

    test('Capability ohne requires/replaces trägt null (Default)', () => {
        const scanner = buildScanner({
            providers: [
                providerWithCaps('A', {
                    m: { capabilityKey: 'a.m', feature: 'F' },
                }),
            ],
        });
        const [cap] = scanner.getSnapshot().capabilities;
        assert.equal(cap.requires, null);
        assert.equal(cap.replaces, null);
        const [feature] = scanner.getSnapshot().features;
        assert.equal(feature.requires, null);
        assert.equal(feature.replaces, null);
    });

    test('requires/replaces werden dedupliziert + sortiert durchgereicht', () => {
        const scanner = buildScanner({
            providers: [
                providerWithCaps('A', {
                    m: {
                        capabilityKey: 'a.m',
                        feature: 'F',
                        requires: ['Z_DEP', 'A_DEP', 'Z_DEP'],
                        replaces: ['OLD_B', 'OLD_A'],
                    },
                }),
            ],
        });
        const [cap] = scanner.getSnapshot().capabilities;
        assert.deepEqual(cap.requires, ['A_DEP', 'Z_DEP']);
        assert.deepEqual(cap.replaces, ['OLD_A', 'OLD_B']);
    });

    test('Feature-Aggregation: Union der Capability-requires abzüglich des eigenen featureKey', () => {
        const scanner = buildScanner({
            providers: [
                providerWithCaps('TrainingController', {
                    plan: {
                        capabilityKey: 'training.plan',
                        feature: 'TRAINING_PLANNER',
                        requires: ['RESOURCE_MANAGEMENT'],
                    },
                    assign: {
                        capabilityKey: 'training.assign',
                        feature: 'TRAINING_PLANNER',
                        // Selbstbezug muss aus dem Aggregat fallen.
                        requires: ['MEMBER_MANAGEMENT', 'TRAINING_PLANNER'],
                    },
                }),
            ],
        });
        const [feature] = scanner.getSnapshot().features;
        assert.deepEqual(feature.requires, ['MEMBER_MANAGEMENT', 'RESOURCE_MANAGEMENT']);
    });

    test('Feature-Aggregation: replaces als Union über die Capabilities', () => {
        const scanner = buildScanner({
            providers: [
                providerWithCaps('NewController', {
                    a: {
                        capabilityKey: 'new.a',
                        feature: 'NEW_FEATURE',
                        replaces: ['OLD_FEATURE'],
                    },
                    b: {
                        capabilityKey: 'new.b',
                        feature: 'NEW_FEATURE',
                        replaces: ['LEGACY_FEATURE'],
                    },
                }),
            ],
        });
        const [feature] = scanner.getSnapshot().features;
        assert.deepEqual(feature.replaces, ['LEGACY_FEATURE', 'OLD_FEATURE']);
    });

    test('Quota trägt replaces aus @DefinesQuota', () => {
        const scanner = buildScanner({
            providers: [
                makeProvider({
                    ctorName: 'StorageQuotaProvider',
                    classMeta: {
                        [DEFINES_QUOTA_KEY]: {
                            key: 'storageGb',
                            label: 'Speicher',
                            unit: 'GB',
                            policy: 'continuous',
                            replaces: ['storageMb'],
                        },
                    },
                }),
            ],
        });
        const [quota] = scanner.getSnapshot().quotas;
        assert.deepEqual(quota.replaces, ['storageMb']);
    });

    test('requires-Änderung ändert den Snapshot-Hash', () => {
        const without = buildScanner({
            providers: [providerWithCaps('A', { m: { capabilityKey: 'a.m', feature: 'F' } })],
        });
        const withRequires = buildScanner({
            providers: [
                providerWithCaps('A', {
                    m: { capabilityKey: 'a.m', feature: 'F', requires: ['DEP'] },
                }),
            ],
        });
        assert.notEqual(without.getSnapshot().hash, withRequires.getSnapshot().hash);
    });
});
