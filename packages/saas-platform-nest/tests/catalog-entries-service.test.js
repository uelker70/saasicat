import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CatalogEntriesService } from '../dist/catalog/index.js';

// CatalogEntriesService — Discovery sync + feature/quota review (#20).
// Tests run against an in-memory fake of the CatalogEntryRepository.

const PROJECT = 'clubapp';

function nowFields() {
    const iso = new Date().toISOString();
    return { createdAt: iso, updatedAt: iso };
}

/** Minimal in-memory CatalogEntryRepository. */
function fakeRepo() {
    const caps = new Map();
    const feats = new Map();
    const quotas = new Map();
    return {
        _caps: caps,
        _feats: feats,
        _quotas: quotas,
        async listCapabilities({ projectKey, codeStatus }) {
            return [...caps.values()].filter(
                (c) => c.projectKey === projectKey && (!codeStatus || c.codeStatus === codeStatus),
            );
        },
        async listFeatures({ projectKey, discoveryStatus }) {
            return [...feats.values()].filter(
                (f) =>
                    f.projectKey === projectKey &&
                    (!discoveryStatus || f.discoveryStatus === discoveryStatus),
            );
        },
        async listQuotas({ projectKey, discoveryStatus }) {
            return [...quotas.values()].filter(
                (q) =>
                    q.projectKey === projectKey &&
                    (!discoveryStatus || q.discoveryStatus === discoveryStatus),
            );
        },
        async upsertCapability(data) {
            const existing = caps.get(data.capabilityKey);
            const row = {
                id: existing?.id ?? `cap-${data.capabilityKey}`,
                ...data,
                i18n: existing?.i18n ?? {},
                sortOrder: existing?.sortOrder ?? 0,
                ...(existing
                    ? { createdAt: existing.createdAt, updatedAt: new Date().toISOString() }
                    : nowFields()),
                deletedAt: null,
            };
            caps.set(data.capabilityKey, row);
            return row;
        },
        async upsertFeature(data) {
            const existing = feats.get(data.featureKey);
            // Realistic like the real adapter: upsertFeature updates only
            // label/description/discoveryStatus (from `data`); UI fields and
            // approval fields remain untouched.
            const row = {
                id: existing?.id ?? `feat-${data.featureKey}`,
                ...data,
                marketingLabel: existing?.marketingLabel ?? null,
                marketingDescription: existing?.marketingDescription ?? null,
                icon: existing?.icon ?? null,
                tier: existing?.tier ?? null,
                successorKey: existing?.successorKey ?? null,
                approvedAt: existing?.approvedAt ?? null,
                approvedBy: existing?.approvedBy ?? null,
                approvedSignature: existing?.approvedSignature ?? null,
                plannedOnly: existing?.plannedOnly ?? false,
                i18n: existing?.i18n ?? {},
                sortOrder: existing?.sortOrder ?? 0,
                ...(existing ? { createdAt: existing.createdAt } : nowFields()),
                updatedAt: new Date().toISOString(),
                deletedAt: null,
            };
            feats.set(data.featureKey, row);
            return row;
        },
        async upsertQuota(data) {
            const existing = quotas.get(data.quotaKey);
            const row = {
                id: existing?.id ?? `quota-${data.quotaKey}`,
                ...data,
                successorKey: existing?.successorKey ?? null,
                approvedAt: existing?.approvedAt ?? null,
                approvedBy: existing?.approvedBy ?? null,
                approvedSignature: existing?.approvedSignature ?? null,
                i18n: existing?.i18n ?? {},
                sortOrder: 0,
                ...(existing ? { createdAt: existing.createdAt } : nowFields()),
                updatedAt: new Date().toISOString(),
                deletedAt: null,
            };
            quotas.set(data.quotaKey, row);
            return row;
        },
        async retireMissing(projectKey, type, presentKeys) {
            const present = new Set(presentKeys);
            let n = 0;
            if (type === 'capability') {
                for (const row of caps.values()) {
                    if (!present.has(row.capabilityKey) && row.codeStatus !== 'retired') {
                        row.codeStatus = 'retired';
                        n++;
                    }
                }
                return n;
            }
            const map = type === 'feature' ? feats : quotas;
            for (const row of map.values()) {
                const key = type === 'feature' ? row.featureKey : row.quotaKey;
                if (!present.has(key) && row.discoveryStatus !== 'obsolete') {
                    row.discoveryStatus = 'obsolete';
                    n++;
                }
            }
            return n;
        },
        async setFeatureSuccessor(_projectKey, featureKey, successorKey) {
            const row = feats.get(featureKey);
            row.successorKey = successorKey;
            return row;
        },
        async setQuotaSuccessor(_projectKey, quotaKey, successorKey) {
            const row = quotas.get(quotaKey);
            row.successorKey = successorKey;
            return row;
        },
        async findFeature(_projectKey, featureKey) {
            return feats.get(featureKey) ?? null;
        },
        async findQuota(_projectKey, quotaKey) {
            return quotas.get(quotaKey) ?? null;
        },
        async setFeatureReview(_projectKey, featureKey, data) {
            const row = feats.get(featureKey);
            Object.assign(row, data, { updatedAt: new Date().toISOString() });
            return row;
        },
        async setQuotaReview(_projectKey, quotaKey, data) {
            const row = quotas.get(quotaKey);
            Object.assign(row, data, { updatedAt: new Date().toISOString() });
            return row;
        },
        async setFeatureI18n(_projectKey, featureKey, i18n) {
            const row = feats.get(featureKey);
            row.i18n = i18n;
            return row;
        },
        async setQuotaI18n(_projectKey, quotaKey, i18n) {
            const row = quotas.get(quotaKey);
            row.i18n = i18n;
            return row;
        },
        async setFeatureBase(_projectKey, featureKey, data) {
            const row = feats.get(featureKey);
            Object.assign(row, data);
            return row;
        },
        async setQuotaBase(_projectKey, quotaKey, data) {
            const row = quotas.get(quotaKey);
            Object.assign(row, data);
            return row;
        },
    };
}

function snapshot({ caps = [], features = [], quotas = [] } = {}) {
    return {
        schemaVersion: 1,
        scannedAt: '2026-05-17T00:00:00.000Z',
        app: { key: PROJECT, version: '0.1.0' },
        capabilities: caps,
        features: features.map((f) =>
            typeof f === 'string' ? { featureKey: f, capabilityKeys: [] } : f,
        ),
        quotas,
        hash: 'sha256-test',
    };
}

function cap(key, overrides = {}) {
    return {
        capabilityKey: key,
        label: key,
        feature: null,
        status: 'active',
        kind: 'endpoint',
        owner: null,
        replacementKey: null,
        removalPlannedAt: null,
        reason: null,
        declaredAt: `${key}Controller.handle`,
        ...overrides,
    };
}

function quota(key, overrides = {}) {
    return {
        quotaKey: key,
        label: key,
        unit: 'items',
        policy: 'hardCap',
        feature: null,
        declaredAt: `${key}Provider`,
        enforcedBy: [],
        ...overrides,
    };
}

describe('CatalogEntriesService', () => {
    let repo;
    let service;

    beforeEach(() => {
        repo = fakeRepo();
        service = new CatalogEntriesService(repo);
    });

    test('sync creates new capabilities with their code status', async () => {
        const result = await service.syncFromSnapshot(
            snapshot({
                caps: [cap('member.create'), cap('member.export', { status: 'experimental' })],
            }),
        );
        assert.equal(result.capabilities.discovered, 2);
        assert.equal(result.capabilities.total, 2);
        const rows = await service.listCapabilities(PROJECT);
        assert.equal(rows.length, 2);
        assert.equal(rows.find((r) => r.capabilityKey === 'member.create').codeStatus, 'active');
        assert.equal(
            rows.find((r) => r.capabilityKey === 'member.export').codeStatus,
            'experimental',
        );
    });

    test('sync creates new features/quotas as pending', async () => {
        await service.syncFromSnapshot(
            snapshot({ features: ['MEMBER_MANAGEMENT'], quotas: [quota('members')] }),
        );
        const [f] = await service.listFeatures(PROJECT);
        assert.equal(f.discoveryStatus, 'pending');
        const [q] = await service.listQuotas(PROJECT);
        assert.equal(q.discoveryStatus, 'pending');
    });

    test('a missing capability is retired on sync, a missing feature obsoleted', async () => {
        await service.syncFromSnapshot(
            snapshot({
                caps: [cap('member.create'), cap('member.delete')],
                features: ['A', 'B'],
            }),
        );
        const result = await service.syncFromSnapshot(
            snapshot({ caps: [cap('member.create')], features: ['A'] }),
        );
        assert.equal(result.capabilities.retired, 1);
        assert.equal(result.features.retired, 1);
        const retired = await service.listCapabilities(PROJECT, 'retired');
        assert.equal(retired[0].capabilityKey, 'member.delete');
        const obsolete = await service.listFeatures(PROJECT, 'obsolete');
        assert.equal(obsolete[0].featureKey, 'B');
    });

    test('internal capabilities do not appear in the catalog', async () => {
        await service.syncFromSnapshot(
            snapshot({ caps: [cap('debug.dump', { status: 'internal' })] }),
        );
        const rows = await service.listCapabilities(PROJECT);
        assert.equal(rows.length, 0);
    });

    test('quota without declaredAt → usageProvider null', async () => {
        await service.syncFromSnapshot(
            snapshot({ quotas: [quota('apiCalls', { unit: '/month', declaredAt: '' })] }),
        );
        const [q] = await service.listQuotas(PROJECT);
        assert.equal(q.usageProvider, null);
        assert.equal(q.enforcementMode, 'hard');
    });

    describe('reviewFeature/reviewQuota (#20)', () => {
        function withSnapshot(snap) {
            return new CatalogEntriesService(repo, snap);
        }

        test('approve persists the approval signature + approvedBy', async () => {
            const snap = snapshot({
                caps: [cap('member.create', { feature: 'MEMBER_MANAGEMENT' })],
                features: ['MEMBER_MANAGEMENT'],
            });
            const svc = withSnapshot(snap);
            await svc.syncFromSnapshot(snap);
            const row = await svc.reviewFeature(
                PROJECT,
                'MEMBER_MANAGEMENT',
                { discoveryStatus: 'approved' },
                'admin-1',
            );
            assert.equal(row.discoveryStatus, 'approved');
            assert.equal(row.approvedBy, 'admin-1');
            assert.equal(row.approvedSignature, 'member.create@active');
            assert.ok(row.approvedAt);
        });

        test('revoking approval (approved → pending) deletes the approval fields', async () => {
            const snap = snapshot({ features: ['A'] });
            const svc = withSnapshot(snap);
            await svc.syncFromSnapshot(snap);
            await svc.reviewFeature(PROJECT, 'A', { discoveryStatus: 'approved' }, 'admin-1');
            const row = await svc.reviewFeature(
                PROJECT,
                'A',
                { discoveryStatus: 'pending' },
                'admin-1',
            );
            assert.equal(row.discoveryStatus, 'pending');
            assert.equal(row.approvedAt, null);
            assert.equal(row.approvedSignature, null);
        });

        test('invalid transition (pending → outdated) is rejected', async () => {
            const snap = snapshot({ features: ['A'] });
            const svc = withSnapshot(snap);
            await svc.syncFromSnapshot(snap);
            await assert.rejects(
                () => svc.reviewFeature(PROJECT, 'A', { discoveryStatus: 'outdated' }, null),
                /nicht erlaubt/,
            );
        });

        test('approve without a snapshot is rejected', async () => {
            const snap = snapshot({ features: ['A'] });
            const svc = withSnapshot(snap);
            await svc.syncFromSnapshot(snap);
            const noSnapshotSvc = new CatalogEntriesService(repo, null);
            await assert.rejects(
                () =>
                    noSnapshotSvc.reviewFeature(PROJECT, 'A', { discoveryStatus: 'approved' }, null),
                /Discovery-Snapshot/,
            );
        });

        test('reviewQuota approve uses the quota signature', async () => {
            const snap = snapshot({ quotas: [quota('members', { unit: 'members' })] });
            const svc = withSnapshot(snap);
            await svc.syncFromSnapshot(snap);
            const row = await svc.reviewQuota(
                PROJECT,
                'members',
                { discoveryStatus: 'approved' },
                'admin-1',
            );
            assert.equal(row.discoveryStatus, 'approved');
            assert.equal(row.approvedSignature, 'members|hard|membersProvider|');
        });

        test('reviewFeature throws on an unknown key', async () => {
            await assert.rejects(
                () => service.reviewFeature(PROJECT, 'nope', { discoveryStatus: 'approved' }, null),
                /nicht gefunden/,
            );
        });
    });

    describe('drift detection on sync (#20)', () => {
        test('approved → outdated when the capability set changes', async () => {
            const snap1 = snapshot({
                caps: [cap('sepa.export', { feature: 'SEPA' })],
                features: ['SEPA'],
            });
            const svc = new CatalogEntriesService(repo, snap1);
            await svc.syncFromSnapshot(snap1);
            await svc.reviewFeature(PROJECT, 'SEPA', { discoveryStatus: 'approved' }, 'admin-1');

            // A new capability is added → signature diverges.
            const snap2 = snapshot({
                caps: [
                    cap('sepa.export', { feature: 'SEPA' }),
                    cap('sepa.preview', { feature: 'SEPA', status: 'experimental' }),
                ],
                features: ['SEPA'],
            });
            const result = await svc.syncFromSnapshot(snap2);
            assert.equal(result.features.outdated, 1);
            const [row] = await svc.listFeatures(PROJECT);
            assert.equal(row.discoveryStatus, 'outdated');
            // The last approval is retained as history.
            assert.equal(row.approvedSignature, 'sepa.export@active');
        });

        test('approved stays approved when the signature is stable', async () => {
            const snap = snapshot({
                caps: [cap('sepa.export', { feature: 'SEPA' })],
                features: ['SEPA'],
            });
            const svc = new CatalogEntriesService(repo, snap);
            await svc.syncFromSnapshot(snap);
            await svc.reviewFeature(PROJECT, 'SEPA', { discoveryStatus: 'approved' }, null);
            const result = await svc.syncFromSnapshot(snap);
            assert.equal(result.features.outdated, 0);
            const [row] = await svc.listFeatures(PROJECT);
            assert.equal(row.discoveryStatus, 'approved');
        });

        test('quota drift: a changed unit flips approved → outdated', async () => {
            const snap1 = snapshot({ quotas: [quota('storage', { unit: 'MB' })] });
            const svc = new CatalogEntriesService(repo, snap1);
            await svc.syncFromSnapshot(snap1);
            await svc.reviewQuota(PROJECT, 'storage', { discoveryStatus: 'approved' }, null);
            const snap2 = snapshot({ quotas: [quota('storage', { unit: 'GB' })] });
            const result = await svc.syncFromSnapshot(snap2);
            assert.equal(result.quotas.outdated, 1);
            const [row] = await svc.listQuotas(PROJECT);
            assert.equal(row.discoveryStatus, 'outdated');
        });

        test('manual obsolete stays put on sync (no auto-resurrect)', async () => {
            const snap = snapshot({ features: ['A'] });
            const svc = new CatalogEntriesService(repo, snap);
            await svc.syncFromSnapshot(snap);
            await svc.reviewFeature(PROJECT, 'A', { discoveryStatus: 'obsolete' }, null);
            await svc.syncFromSnapshot(snap);
            const [row] = await svc.listFeatures(PROJECT);
            assert.equal(row.discoveryStatus, 'obsolete');
        });

        test('a requires change on a capability flips approved → outdated (#35)', async () => {
            const snap1 = snapshot({
                caps: [cap('training.plan', { feature: 'TRAINING' })],
                features: [{ featureKey: 'TRAINING', capabilityKeys: ['training.plan'] }],
            });
            const svc = new CatalogEntriesService(repo, snap1);
            await svc.syncFromSnapshot(snap1);
            await svc.reviewFeature(PROJECT, 'TRAINING', { discoveryStatus: 'approved' }, null);

            const snap2 = snapshot({
                caps: [
                    cap('training.plan', { feature: 'TRAINING', requires: ['RESOURCES'] }),
                ],
                features: [
                    {
                        featureKey: 'TRAINING',
                        capabilityKeys: ['training.plan'],
                        requires: ['RESOURCES'],
                    },
                ],
            });
            const result = await svc.syncFromSnapshot(snap2);
            assert.equal(result.features.outdated, 1);
            const [row] = await svc.listFeatures(PROJECT);
            assert.equal(row.discoveryStatus, 'outdated');
        });
    });

    describe('replaced semantics on sync (#39)', () => {
        function featureWithReplaces(featureKey, replaces) {
            return { featureKey, capabilityKeys: [], replaces };
        }

        test('a vanished key with a replaces claimant gets successorKey + obsolete', async () => {
            await service.syncFromSnapshot(snapshot({ features: ['OLD_FEATURE'] }));
            const result = await service.syncFromSnapshot(
                snapshot({ features: [featureWithReplaces('NEW_FEATURE', ['OLD_FEATURE'])] }),
            );
            assert.equal(result.features.retired, 1);
            assert.equal(result.features.replaced, 1);
            const old = (await service.listFeatures(PROJECT)).find(
                (f) => f.featureKey === 'OLD_FEATURE',
            );
            assert.equal(old.discoveryStatus, 'obsolete');
            assert.equal(old.successorKey, 'NEW_FEATURE');
        });

        test('a vanished key without a claimant stays bare obsolete (no successorKey)', async () => {
            await service.syncFromSnapshot(snapshot({ features: ['GONE'] }));
            const result = await service.syncFromSnapshot(snapshot({ features: ['UNRELATED'] }));
            assert.equal(result.features.replaced, 0);
            const gone = (await service.listFeatures(PROJECT)).find((f) => f.featureKey === 'GONE');
            assert.equal(gone.discoveryStatus, 'obsolete');
            assert.equal(gone.successorKey, null);
        });

        test('a reappearing key loses its successorKey', async () => {
            await service.syncFromSnapshot(snapshot({ features: ['OLD_FEATURE'] }));
            await service.syncFromSnapshot(
                snapshot({ features: [featureWithReplaces('NEW_FEATURE', ['OLD_FEATURE'])] }),
            );
            await service.syncFromSnapshot(
                snapshot({
                    features: ['OLD_FEATURE', featureWithReplaces('NEW_FEATURE', ['OLD_FEATURE'])],
                }),
            );
            const old = (await service.listFeatures(PROJECT)).find(
                (f) => f.featureKey === 'OLD_FEATURE',
            );
            assert.equal(old.successorKey, null);
        });

        test('quota replaces sets successorKey on the old quota entry', async () => {
            await service.syncFromSnapshot(snapshot({ quotas: [quota('storageMb')] }));
            const result = await service.syncFromSnapshot(
                snapshot({ quotas: [quota('storageGb', { replaces: ['storageMb'] })] }),
            );
            assert.equal(result.quotas.replaced, 1);
            const old = (await service.listQuotas(PROJECT)).find((q) => q.quotaKey === 'storageMb');
            assert.equal(old.discoveryStatus, 'obsolete');
            assert.equal(old.successorKey, 'storageGb');
        });

        test('sync is idempotent: a second run counts no further replaced', async () => {
            await service.syncFromSnapshot(snapshot({ features: ['OLD_FEATURE'] }));
            const snap = snapshot({
                features: [featureWithReplaces('NEW_FEATURE', ['OLD_FEATURE'])],
            });
            await service.syncFromSnapshot(snap);
            const second = await service.syncFromSnapshot(snap);
            assert.equal(second.features.replaced, 0);
        });

        test('repository without setFeatureSuccessor: sync runs through without a pointer', async () => {
            delete repo.setFeatureSuccessor;
            await service.syncFromSnapshot(snapshot({ features: ['OLD_FEATURE'] }));
            const result = await service.syncFromSnapshot(
                snapshot({ features: [featureWithReplaces('NEW_FEATURE', ['OLD_FEATURE'])] }),
            );
            assert.equal(result.features.replaced, 0);
            const old = (await service.listFeatures(PROJECT)).find(
                (f) => f.featureKey === 'OLD_FEATURE',
            );
            assert.equal(old.discoveryStatus, 'obsolete');
            assert.equal(old.successorKey, null);
        });

        test('requires/replaces are mirrored into the feature entries', async () => {
            await service.syncFromSnapshot(
                snapshot({
                    features: [
                        {
                            featureKey: 'TRAINING',
                            capabilityKeys: [],
                            requires: ['RESOURCES'],
                            replaces: ['OLD_TRAINING'],
                        },
                    ],
                }),
            );
            const [row] = await service.listFeatures(PROJECT);
            assert.deepEqual(row.requires, ['RESOURCES']);
            assert.deepEqual(row.replaces, ['OLD_TRAINING']);
        });
    });

    test('setFeatureI18n persists translations', async () => {
        await service.syncFromSnapshot(snapshot({ features: ['MEMBER_MANAGEMENT'] }));
        const updated = await service.setFeatureI18n(PROJECT, 'MEMBER_MANAGEMENT', {
            en: { label: 'Member management' },
        });
        assert.equal(updated.i18n.en.label, 'Member management');
    });

    describe('onApplicationBootstrap (auto-sync, #12)', () => {
        test('syncs the injected snapshot at boot (default on)', async () => {
            const snap = snapshot({
                caps: [cap('member.create')],
                features: ['MEMBER_MANAGEMENT'],
            });
            const svc = new CatalogEntriesService(repo, snap);
            await svc.onApplicationBootstrap();
            const feats = await svc.listFeatures(PROJECT);
            assert.equal(feats.length, 1);
            assert.equal(feats[0].featureKey, 'MEMBER_MANAGEMENT');
        });

        test('seeds label/description/icon from the FeatureUiRegistry into empty fields (#12)', async () => {
            const snap = snapshot({ features: ['MEMBER_MANAGEMENT'] });
            const registry = {
                MEMBER_MANAGEMENT: {
                    label: 'Mitgliederverwaltung',
                    description: 'Mitglieder pflegen.',
                    icon: 'groups',
                },
            };
            const svc = new CatalogEntriesService(repo, snap, {}, null, registry);
            await svc.onApplicationBootstrap();
            const [f] = await svc.listFeatures(PROJECT);
            assert.equal(f.label, 'Mitgliederverwaltung');
            assert.equal(f.description, 'Mitglieder pflegen.');
            assert.equal(f.icon, 'groups');
        });

        test('registry does NOT overwrite existing SuperAdmin values (#12)', async () => {
            const snap = snapshot({ features: ['MEMBER_MANAGEMENT'] });
            // Simulates an existing entry maintained in the AdminUI.
            await repo.upsertFeature({
                projectKey: PROJECT,
                featureKey: 'MEMBER_MANAGEMENT',
                label: 'Custom-Label',
                description: 'Custom-Desc',
                discoveryStatus: 'approved',
            });
            await repo.setFeatureBase(PROJECT, 'MEMBER_MANAGEMENT', { icon: 'custom_icon' });
            const registry = {
                MEMBER_MANAGEMENT: { label: 'Registry', description: 'Registry', icon: 'registry_icon' },
            };
            const svc = new CatalogEntriesService(repo, snap, {}, null, registry);
            await svc.onApplicationBootstrap();
            const [f] = await svc.listFeatures(PROJECT);
            assert.equal(f.label, 'Custom-Label');
            assert.equal(f.icon, 'custom_icon');
        });

        test('seeds label even for an already-existing bare row (label==key) (#12)', async () => {
            const snap = snapshot({ features: ['MEMBER_MANAGEMENT'] });
            // Auto-sync initially creates rows with label==key → must count as "bare".
            await repo.upsertFeature({
                projectKey: PROJECT,
                featureKey: 'MEMBER_MANAGEMENT',
                label: 'MEMBER_MANAGEMENT',
                description: null,
                discoveryStatus: 'pending',
            });
            const registry = {
                MEMBER_MANAGEMENT: { label: 'Mitgliederverwaltung', description: 'd', icon: 'groups' },
            };
            const svc = new CatalogEntriesService(repo, snap, {}, null, registry);
            await svc.onApplicationBootstrap();
            const [f] = await svc.listFeatures(PROJECT);
            assert.equal(f.label, 'Mitgliederverwaltung');
            assert.equal(f.icon, 'groups');
        });

        test('no-op when autoSyncDiscoveryAtBoot=false', async () => {
            const snap = snapshot({ features: ['MEMBER_MANAGEMENT'] });
            const svc = new CatalogEntriesService(repo, snap, {
                autoSyncDiscoveryAtBoot: false,
            });
            await svc.onApplicationBootstrap();
            assert.equal((await svc.listFeatures(PROJECT)).length, 0);
        });

        test('no-op without an injected snapshot', async () => {
            const svc = new CatalogEntriesService(repo, null);
            await svc.onApplicationBootstrap();
            assert.equal((await svc.listFeatures(PROJECT)).length, 0);
        });

        test('swallows a sync error at boot (no boot crash)', async () => {
            const brokenRepo = fakeRepo();
            brokenRepo.listCapabilities = async () => {
                throw new Error('DB down');
            };
            const svc = new CatalogEntriesService(brokenRepo, snapshot({ features: ['X'] }));
            await assert.doesNotReject(() => svc.onApplicationBootstrap());
        });
    });
});
