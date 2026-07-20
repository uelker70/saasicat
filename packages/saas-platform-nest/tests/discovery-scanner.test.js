import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFINES_QUOTA_KEY,
    DiscoveryScanner,
    ENFORCE_QUOTA_KEY,
    IMPLEMENTS_CAPABILITY_KEY,
    computeSnapshotHash,
} from '../dist/discovery/index.js';

// Discovery scanner: aggregates @ImplementsCapability/@DefinesQuota/
// @EnforceQuota annotations into a DiscoverySnapshot. We stub
// DiscoveryService + MetadataScanner + Reflector directly — no @nestjs/testing
// needed, because the scanner only calls the three minimal public APIs:
//   - discoveryService.getProviders() / .getControllers()
//   - metadataScanner.getAllMethodNames(prototype)
//   - reflector.get(key, target)

// ─────────────────────────────────────────────────────────────────
// Test helpers
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
    // allEntries: array of { instance, classMeta, methodMeta } — we build a
    // lookup from target → metadata map.
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
// computeSnapshotHash — canonical + stable
// ─────────────────────────────────────────────────────────────────

describe('computeSnapshotHash', () => {
    test('returns the same hash for identical inputs', () => {
        const input = {
            schemaVersion: 1,
            scannedAt: '2026-05-12T10:00:00.000Z',
            app: { key: 'clubapp', version: '0.42.1' },
            capabilities: [],
            features: [],
            quotas: [],
        };
        const a = computeSnapshotHash(input);
        const b = computeSnapshotHash({ ...input });
        assert.equal(a, b);
        assert.match(a, /^sha256-[0-9a-f]{64}$/);
    });

    test('ignores scannedAt and app.version (stability across boot restarts)', () => {
        const base = {
            schemaVersion: 1,
            app: { key: 'clubapp', version: '0.42.1' },
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
            app: { key: 'clubapp', version: '99.99.99' },
        });
        assert.equal(a, b, 'scannedAt + version must not affect the hash');
    });

    test('is sort-order independent for object keys', () => {
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
        // Same content, different insertion order of the fields
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

    test('returns different hashes for different capability sets', () => {
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
// Scanner: aggregation capabilities → features
// (Bundles are NOT aggregated — they come exclusively from the
// SuperAdmin UI; SPEC_V2 §3.1 + §11.1 M3.)
// ─────────────────────────────────────────────────────────────────

describe('DiscoveryScanner — capability/feature aggregation', () => {
    test('aggregates capabilities with the same feature into a DiscoveredFeature', () => {
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

    test('capabilities without a feature do not end up in feature aggregates', () => {
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

    test('snapshot contains no bundles field (bundles only from SuperAdmin UI)', () => {
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
        assert.ok(!('bundles' in snapshot), 'snapshot.bundles must be gone');
    });
});

// ─────────────────────────────────────────────────────────────────
// Scanner: quotas + cross-reference EnforceQuota → DiscoveredQuota.enforcedBy
// ─────────────────────────────────────────────────────────────────

describe('DiscoveryScanner — Quotas', () => {
    test('reads @DefinesQuota at the class level', () => {
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

    test('cross-references @EnforceQuota on capabilities with the quota', () => {
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
// Scanner: edge cases — multiple declaration, app info
// ─────────────────────────────────────────────────────────────────

describe('DiscoveryScanner — edge cases', () => {
    test('multiple declaration of the same capability: first wins', () => {
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

    test('app info is carried into the snapshot', () => {
        const scanner = buildScanner({
            providers: [],
            appInfo: { key: 'clubapp', version: '0.42.1' },
        });
        const snapshot = scanner.getSnapshot();
        assert.equal(snapshot.app.key, 'clubapp');
        assert.equal(snapshot.app.version, '0.42.1');
    });

    test('default app info when nothing is injected', () => {
        const scanner = buildScanner({ providers: [] });
        const snapshot = scanner.getSnapshot();
        assert.equal(snapshot.app.key, 'unknown');
        assert.equal(snapshot.app.version, '0.0.0');
    });

    test('rebuildSnapshot overwrites the cache', () => {
        const scanner = buildScanner({ providers: [] });
        const first = scanner.getSnapshot();
        const second = scanner.rebuildSnapshot();
        // With an empty provider set the hash should be identical, but the
        // snapshot object a new instance.
        assert.equal(first.hash, second.hash);
        assert.notStrictEqual(first, second);
    });
});

// ─────────────────────────────────────────────────────────────────
// requires/replaces — discovery metadata (#35/#39)
// ─────────────────────────────────────────────────────────────────

describe('DiscoveryScanner — requires/replaces (#35/#39)', () => {
    function providerWithCaps(ctorName, caps) {
        const methodMeta = {};
        for (const [methodName, meta] of Object.entries(caps)) {
            methodMeta[methodName] = { [IMPLEMENTS_CAPABILITY_KEY]: meta };
        }
        return makeProvider({ ctorName, methodMeta });
    }

    test('capability without requires/replaces carries null (default)', () => {
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

    test('requires/replaces are deduplicated + sorted through', () => {
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

    test('feature aggregation: union of capability requires minus its own featureKey', () => {
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
                        // Self-reference must drop out of the aggregate.
                        requires: ['MEMBER_MANAGEMENT', 'TRAINING_PLANNER'],
                    },
                }),
            ],
        });
        const [feature] = scanner.getSnapshot().features;
        assert.deepEqual(feature.requires, ['MEMBER_MANAGEMENT', 'RESOURCE_MANAGEMENT']);
    });

    test('feature aggregation: replaces as union over the capabilities', () => {
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

    test('quota carries replaces from @DefinesQuota', () => {
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

    test('requires change changes the snapshot hash', () => {
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
