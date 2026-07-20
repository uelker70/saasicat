// Fake-Adapter für Plattform-Service-Tests.
//
// In-Memory-Implementierungen der Adapter-Ports für unit-Tests im Plattform-
// Paket und in Konsumenten, die die Plattform-Services testen wollen ohne
// gegen eine echte DB zu fahren.

import type {
    BundleListFilter,
    BundleRepository,
    BundleRow,
    BundleVersionRow,
    BusinessTypeBundleRow,
    BusinessTypeListFilter,
    BusinessTypeRepository,
    BusinessTypeRow,
    BusinessTypeVersionRow,
    CreateBundleData,
    CreateBundleVersionDraftData,
    CreateBusinessTypeData,
    CreateBusinessTypeVersionDraftData,
    CreateMarketingProjectionData,
    CreatePlanData,
    CreatePlanVersionDraftData,
    MarketingProjectionFilter,
    MarketingProjectionRepository,
    MarketingProjectionRow,
    PlanListFilter,
    PlanRepository,
    PlanRow,
    PlanVersionRecord,
    PlanVersionRepository,
    PlanVersionRow,
    CancelSubscriptionBundleData,
    CreateSubscriptionContractData,
    CreateSubscriptionBundleData,
    SubscriptionContractFilter,
    SubscriptionContractRecord,
    SubscriptionContractRepository,
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    SubscriptionRecord,
    SubscriptionRepository,
    TerminateSubscriptionContractData,
    TransactionContext,
    TransactionRunner,
    UpdateBundleData,
    UpdateBundleVersionDraftData,
    UpdateBusinessTypeData,
    UpdateBusinessTypeVersionDraftData,
    UpdateMarketingProjectionData,
    UpdatePlanData,
    UpdatePlanVersionDraftData,
    VersionChange,
} from '@saasicat/types';
import { startOfUtcDay } from '@saasicat/types';

/**
 * In-Memory FakeSubscriptionRepository — speichert Subscriptions per
 * `tenantId` und liefert sie als Read-Snapshot zurück. Lock-Semantik wird
 * nicht emuliert (`findByTenantIdLocked` delegiert an `findByTenantId`).
 *
 * Test-Setup:
 *
 *     const repo = new FakeSubscriptionRepository();
 *     repo.set({ id: 'sub-1', tenantId: 't1', plan: 'STANDARD', ... });
 */
export class FakeSubscriptionRepository implements SubscriptionRepository {
    private readonly byTenantId = new Map<string, SubscriptionRecord>();
    /**
     * Test-Stubs für die `countBy*`-Editierbarkeits-Methoden. Tests setzen
     * sie direkt; Default 0 (= „keine Subscription bindet die Version" →
     * published-but-future Versions sind editierbar, wenn sie latest-in-chain
     * sind und validFrom in der Zukunft liegt).
     */
    private readonly planVersionCounts = new Map<string, number>();
    private readonly bundleVersionCounts = new Map<string, number>();

    set(record: SubscriptionRecord): void {
        this.byTenantId.set(record.tenantId, record);
    }

    delete(tenantId: string): void {
        this.byTenantId.delete(tenantId);
    }

    clear(): void {
        this.byTenantId.clear();
        this.planVersionCounts.clear();
        this.bundleVersionCounts.clear();
    }

    /** Test-Helper: Anzahl Subscriptions für eine PlanVersion forcieren. */
    setPlanVersionCount(planVersionId: string, count: number): void {
        this.planVersionCounts.set(planVersionId, count);
    }

    /** Test-Helper: Anzahl Subscriptions für eine BundleVersion forcieren. */
    setBundleVersionCount(bundleVersionId: string, count: number): void {
        this.bundleVersionCounts.set(bundleVersionId, count);
    }

    async findByTenantId(tenantId: string): Promise<SubscriptionRecord | null> {
        return this.byTenantId.get(tenantId) ?? null;
    }

    async findByTenantIdLocked(
        tenantId: string,
        _tx: TransactionContext,
    ): Promise<SubscriptionRecord | null> {
        return this.findByTenantId(tenantId);
    }

    async countByPlanVersionId(planVersionId: string): Promise<number> {
        return this.planVersionCounts.get(planVersionId) ?? 0;
    }

    async countByBundleVersionId(bundleVersionId: string): Promise<number> {
        return this.bundleVersionCounts.get(bundleVersionId) ?? 0;
    }
}

/**
 * In-Memory FakeSubscriptionBundleRepository — speichert
 * `subscription_bundles`-Einträge per id. `add` / `cancel` sind
 * fail-fast (kein Re-Cancel); Mindestlaufzeit-Default kommt vom Service
 * (heute noch nicht implementiert — Tests setzen das Feld explizit).
 *
 * Test-Setup:
 *
 *     const repo = new FakeSubscriptionBundleRepository();
 *     const row = await repo.add({ subscriptionId: 's1',
 *         bundleVersionId: 'bv1', startedAt: new Date() });
 */
export class FakeSubscriptionBundleRepository implements SubscriptionBundleRepository {
    private readonly byId = new Map<string, SubscriptionBundleRecord>();
    private nextId = 1;

    private now(): Date {
        return new Date('2026-01-01T00:00:00.000Z');
    }

    clear(): void {
        this.byId.clear();
    }

    async listBySubscription(subscriptionId: string): Promise<SubscriptionBundleRecord[]> {
        return [...this.byId.values()]
            .filter((r) => r.subscriptionId === subscriptionId)
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    }

    async findById(subscriptionBundleId: string): Promise<SubscriptionBundleRecord | null> {
        return this.byId.get(subscriptionBundleId) ?? null;
    }

    async listActiveBySubscription(
        subscriptionId: string,
        asOf: Date = new Date(),
    ): Promise<SubscriptionBundleRecord[]> {
        return [...this.byId.values()].filter(
            (r) =>
                r.subscriptionId === subscriptionId &&
                (r.canceledAt === null ||
                    (r.canceledEffectiveAt !== null &&
                        r.canceledEffectiveAt.getTime() > asOf.getTime())),
        );
    }

    async add(data: CreateSubscriptionBundleData): Promise<SubscriptionBundleRecord> {
        const id = `sub-bundle-${this.nextId++}`;
        const createdAt = this.now();
        const row: SubscriptionBundleRecord = {
            id,
            subscriptionId: data.subscriptionId,
            bundleVersionId: data.bundleVersionId,
            startedAt: data.startedAt,
            minimumTermEndsAt: data.minimumTermEndsAt ?? null,
            canceledAt: null,
            canceledEffectiveAt: null,
            createdAt,
            updatedAt: createdAt,
        };
        this.byId.set(id, row);
        return row;
    }

    async cancel(
        subscriptionBundleId: string,
        data: CancelSubscriptionBundleData,
    ): Promise<SubscriptionBundleRecord> {
        const existing = this.byId.get(subscriptionBundleId);
        if (!existing) {
            throw new Error(`SubscriptionBundle '${subscriptionBundleId}' nicht gefunden`);
        }
        if (existing.canceledAt !== null) {
            throw new Error(`SubscriptionBundle '${subscriptionBundleId}' ist bereits gekündigt`);
        }
        const updated: SubscriptionBundleRecord = {
            ...existing,
            canceledAt: data.canceledAt,
            canceledEffectiveAt: data.canceledEffectiveAt,
            updatedAt: this.now(),
        };
        this.byId.set(subscriptionBundleId, updated);
        return updated;
    }

    async reactivate(subscriptionBundleId: string): Promise<SubscriptionBundleRecord> {
        const existing = this.byId.get(subscriptionBundleId);
        if (!existing) {
            throw new Error(`SubscriptionBundle '${subscriptionBundleId}' nicht gefunden`);
        }
        const updated: SubscriptionBundleRecord = {
            ...existing,
            canceledAt: null,
            canceledEffectiveAt: null,
            updatedAt: this.now(),
        };
        this.byId.set(subscriptionBundleId, updated);
        return updated;
    }

    async countActiveByBundleVersionId(
        bundleVersionId: string,
        asOf: Date = new Date(),
    ): Promise<number> {
        let n = 0;
        for (const r of this.byId.values()) {
            if (r.bundleVersionId !== bundleVersionId) continue;
            if (r.canceledAt === null) n += 1;
            else if (
                r.canceledEffectiveAt !== null &&
                r.canceledEffectiveAt.getTime() > asOf.getTime()
            ) {
                n += 1;
            }
        }
        return n;
    }
}

/**
 * In-Memory FakeSubscriptionContractRepository — modelliert das V3
 * append-only Contract-Schema. `create` klont Snapshots tief genug für
 * Immutability-Tests; `terminate` ändert nur Status/effectiveUntil.
 */
export class FakeSubscriptionContractRepository implements SubscriptionContractRepository {
    private readonly byId = new Map<string, SubscriptionContractRecord>();
    private nextContractId = 1;
    private nextLineItemId = 1;

    clear(): void {
        this.byId.clear();
        this.nextContractId = 1;
        this.nextLineItemId = 1;
    }

    async list(filter: SubscriptionContractFilter): Promise<SubscriptionContractRecord[]> {
        return [...this.byId.values()]
            .filter((row) => !filter.projectKey || row.projectKey === filter.projectKey)
            .filter((row) => !filter.tenantId || row.tenantId === filter.tenantId)
            .filter((row) => !filter.status || row.status === filter.status)
            .filter((row) => !filter.asOf || this.isActiveAt(row, filter.asOf))
            .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())
            .map((row) => this.cloneRecord(row));
    }

    async findById(contractId: string): Promise<SubscriptionContractRecord | null> {
        const row = this.byId.get(contractId);
        return row ? this.cloneRecord(row) : null;
    }

    async findActiveByTenantId(
        tenantId: string,
        asOf: Date = new Date(),
    ): Promise<SubscriptionContractRecord | null> {
        const active = [...this.byId.values()]
            .filter((row) => row.tenantId === tenantId)
            .filter((row) => this.isActiveAt(row, asOf))
            .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
        return active ? this.cloneRecord(active) : null;
    }

    async create(data: CreateSubscriptionContractData): Promise<SubscriptionContractRecord> {
        const now = new Date();
        const id = `contract-${this.nextContractId++}`;
        const row: SubscriptionContractRecord = {
            id,
            projectKey: data.projectKey,
            tenantId: data.tenantId,
            status: data.status ?? 'active',
            effectiveFrom: new Date(data.effectiveFrom),
            effectiveUntil: data.effectiveUntil ? new Date(data.effectiveUntil) : null,
            originalOfferId: data.originalOfferId ?? null,
            originalPlanVersionId: data.originalPlanVersionId ?? null,
            originalBundleVersionIds: [...(data.originalBundleVersionIds ?? [])],
            entitlementSnapshot: data.entitlementSnapshot
                ? {
                      plan: data.entitlementSnapshot.plan,
                      quotas: { ...data.entitlementSnapshot.quotas },
                      features: [...data.entitlementSnapshot.features],
                  }
                : null,
            priceSnapshot: { ...data.priceSnapshot },
            promotionSnapshots: [...(data.promotionSnapshots ?? [])],
            promoCodeSnapshots: [...(data.promoCodeSnapshots ?? [])],
            termsSnapshot: data.termsSnapshot ? { ...data.termsSnapshot } : null,
            lineItems: data.lineItems.map((item) => ({
                ...item,
                id: `contract-line-${this.nextLineItemId++}`,
                contractId: id,
                minimumTermUntil: item.minimumTermUntil ? new Date(item.minimumTermUntil) : null,
                featuresSnapshot: [...item.featuresSnapshot],
                quotaEffectsSnapshot: { ...item.quotaEffectsSnapshot },
                metadata: item.metadata ? { ...item.metadata } : null,
                createdAt: now,
            })),
            createdAt: now,
            updatedAt: now,
        };
        this.byId.set(id, row);
        return this.cloneRecord(row);
    }

    async terminate(
        contractId: string,
        data: TerminateSubscriptionContractData,
    ): Promise<SubscriptionContractRecord> {
        const existing = this.byId.get(contractId);
        if (!existing) throw new Error(`SubscriptionContract '${contractId}' nicht gefunden`);
        const updated: SubscriptionContractRecord = {
            ...existing,
            status: data.status,
            effectiveUntil: new Date(data.effectiveUntil),
            updatedAt: new Date(),
        };
        this.byId.set(contractId, updated);
        return this.cloneRecord(updated);
    }

    private isActiveAt(row: SubscriptionContractRecord, asOf: Date): boolean {
        if (row.status !== 'active' && row.status !== 'scheduled') return false;
        return (
            row.effectiveFrom.getTime() <= asOf.getTime() &&
            (row.effectiveUntil === null || row.effectiveUntil.getTime() > asOf.getTime())
        );
    }

    private cloneRecord(row: SubscriptionContractRecord): SubscriptionContractRecord {
        return {
            ...row,
            effectiveFrom: new Date(row.effectiveFrom),
            effectiveUntil: row.effectiveUntil ? new Date(row.effectiveUntil) : null,
            originalBundleVersionIds: [...row.originalBundleVersionIds],
            entitlementSnapshot: row.entitlementSnapshot
                ? {
                      plan: row.entitlementSnapshot.plan,
                      quotas: { ...row.entitlementSnapshot.quotas },
                      features: [...row.entitlementSnapshot.features],
                  }
                : null,
            priceSnapshot: { ...row.priceSnapshot },
            promotionSnapshots: [...row.promotionSnapshots],
            promoCodeSnapshots: [...row.promoCodeSnapshots],
            termsSnapshot: row.termsSnapshot ? { ...row.termsSnapshot } : null,
            lineItems: row.lineItems.map((item) => ({
                ...item,
                minimumTermUntil: item.minimumTermUntil ? new Date(item.minimumTermUntil) : null,
                featuresSnapshot: [...item.featuresSnapshot],
                quotaEffectsSnapshot: { ...item.quotaEffectsSnapshot },
                metadata: item.metadata ? { ...item.metadata } : null,
                createdAt: new Date(item.createdAt),
            })),
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
        };
    }
}

/**
 * In-Memory FakePlanVersionRepository — speichert PlanVersions pro `planId`
 * und liefert die zuletzt gesetzte als „latest live".
 */
export class FakePlanVersionRepository implements PlanVersionRepository {
    private readonly byPlanId = new Map<string, PlanVersionRecord>();

    set(record: PlanVersionRecord): void {
        this.byPlanId.set(record.planId, record);
    }

    clear(): void {
        this.byPlanId.clear();
    }

    async findLatestLive(
        planId: string,
        _tx?: TransactionContext,
    ): Promise<PlanVersionRecord | null> {
        return this.byPlanId.get(planId) ?? null;
    }

    // Fake hält nur ein Record pro planId — `findActive` liefert dasselbe
    // wie `findLatestLive`. Echte time-window-Semantik testen Konsumenten
    // gegen die Prisma-Implementierung oder gegen `FakePlanRepository`
    // (das mehrere Versions pro planKey unterstützt).
    async findActive(
        planId: string,
        _asOf?: Date,
        _tx?: TransactionContext,
    ): Promise<PlanVersionRecord | null> {
        return this.byPlanId.get(planId) ?? null;
    }
}

/**
 * Fake-TransactionRunner für Tests — führt die Callback-Funktion direkt aus
 * und übergibt einen Sentinel-`tx`-Wert. Kein Rollback-Verhalten, keine
 * Atomic-Garantien — Tests, die die Tx-Semantik prüfen müssen, sollten
 * gegen eine echte DB laufen.
 */
export class FakeTransactionRunner implements TransactionRunner {
    /** Sentinel-Wert, der als TransactionContext durchgereicht wird. */
    static readonly TX_SENTINEL = Symbol.for('FakeTransactionRunner.tx');

    runCount = 0;

    async run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
        this.runCount += 1;
        return fn(FakeTransactionRunner.TX_SENTINEL);
    }
}

/**
 * In-Memory-Implementierung von `BundleRepository` für Tests des
 * `BundlesService`. Implementiert die Partial-Unique-Constraints (max. 1
 * Draft pro Bundle) und die Publish-Semantik (vorherige Live wird
 * superseded) als Pure-JS-Logik.
 */
export class FakeBundleRepository implements BundleRepository {
    private readonly bundles = new Map<string, BundleRow>();
    private readonly versions = new Map<string, BundleVersionRow>();
    private nextId = 1;

    private genId(prefix: string): string {
        // Echtes UUID-Format wird vom ParseUUIDPipe an der Controller-
        // Grenze erwartet; Tests, die direkt den Service aufrufen, brauchen
        // das nicht — wir geben hier deterministische, gültige UUIDs aus.
        const n = this.nextId++;
        const suffix = n.toString(16).padStart(12, '0');
        return `${prefix}aaaa-aaaa-aaaa-aaaa-${suffix}`;
    }

    private nowIso(): string {
        return new Date().toISOString();
    }

    // Test-Helper
    seedBundle(row: BundleRow): void {
        this.bundles.set(row.id, row);
    }

    seedVersion(row: BundleVersionRow): void {
        this.versions.set(row.id, row);
    }

    clear(): void {
        this.bundles.clear();
        this.versions.clear();
    }

    // ─── Stamm-Operationen ───

    async list(filter: BundleListFilter): Promise<BundleRow[]> {
        const excludeDeleted = filter.excludeDeleted ?? true;
        return [...this.bundles.values()].filter(
            (b) => b.projectKey === filter.projectKey && (!excludeDeleted || b.deletedAt === null),
        );
    }

    async findById(bundleId: string): Promise<BundleRow | null> {
        return this.bundles.get(bundleId) ?? null;
    }

    async findByKey(projectKey: string, bundleKey: string): Promise<BundleRow | null> {
        for (const b of this.bundles.values()) {
            if (b.projectKey === projectKey && b.bundleKey === bundleKey && b.deletedAt === null) {
                return b;
            }
        }
        return null;
    }

    async create(data: CreateBundleData): Promise<BundleRow> {
        const now = this.nowIso();
        const row: BundleRow = {
            id: this.genId('bbbb'),
            projectKey: data.projectKey,
            bundleKey: data.bundleKey,
            label: data.label,
            description: data.description ?? null,
            icon: data.icon ?? null,
            sortOrder: data.sortOrder ?? 0,
            i18n: data.i18n ?? {},
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
        };
        this.bundles.set(row.id, row);
        return row;
    }

    async update(bundleId: string, data: UpdateBundleData): Promise<BundleRow> {
        const existing = this.bundles.get(bundleId);
        if (!existing) throw new Error(`Bundle '${bundleId}' nicht gefunden`);
        const updated: BundleRow = {
            ...existing,
            label: data.label ?? existing.label,
            description: data.description !== undefined ? data.description : existing.description,
            icon: data.icon !== undefined ? data.icon : existing.icon,
            sortOrder: data.sortOrder ?? existing.sortOrder,
            i18n: data.i18n ?? existing.i18n,
            updatedAt: this.nowIso(),
        };
        this.bundles.set(bundleId, updated);
        return updated;
    }

    async softDelete(bundleId: string): Promise<void> {
        const existing = this.bundles.get(bundleId);
        if (!existing) throw new Error(`Bundle '${bundleId}' nicht gefunden`);
        this.bundles.set(bundleId, { ...existing, deletedAt: this.nowIso() });
    }

    // ─── Version-Operationen ───

    async listVersions(bundleId: string): Promise<BundleVersionRow[]> {
        return [...this.versions.values()]
            .filter((v) => v.bundleId === bundleId)
            .sort((a, b) => a.version - b.version);
    }

    async findVersionById(versionId: string): Promise<BundleVersionRow | null> {
        return this.versions.get(versionId) ?? null;
    }

    async findCurrentDraft(bundleId: string): Promise<BundleVersionRow | null> {
        for (const v of this.versions.values()) {
            if (v.bundleId === bundleId && v.publishedAt === null) return v;
        }
        return null;
    }

    async findLatestLive(bundleId: string): Promise<BundleVersionRow | null> {
        for (const v of this.versions.values()) {
            if (v.bundleId === bundleId && v.publishedAt !== null && v.supersededAt === null) {
                return v;
            }
        }
        return null;
    }

    async createDraft(data: CreateBundleVersionDraftData): Promise<BundleVersionRow> {
        const draft = await this.findCurrentDraft(data.bundleId);
        if (draft) {
            throw new Error(
                `Bundle '${data.bundleId}' hat bereits eine Draft-Version v${draft.version}`,
            );
        }
        const all = await this.listVersions(data.bundleId);
        const nextVersion = all.length === 0 ? 1 : Math.max(...all.map((v) => v.version)) + 1;
        const now = this.nowIso();
        const row: BundleVersionRow = {
            id: this.genId('vvvv'),
            version: nextVersion,
            baseVersionId: data.baseVersionId ?? null,
            publishedAt: null,
            supersededAt: null,
            publishedChanges: null,
            changeNote: data.changeNote ?? '',
            nonRegressive: true,
            createdByUserId: data.createdByUserId ?? null,
            publishedByUserId: null,
            validFrom: data.validFrom ?? null,
            validUntil: data.validUntil ?? null,
            createdAt: now,
            updatedAt: now,
            bundleId: data.bundleId,
            bundleKey: this.bundles.get(data.bundleId)?.bundleKey ?? '',
            label: this.bundles.get(data.bundleId)?.label ?? '',
            features: data.features,
            quotas: data.quotas ?? {},
            compatibility: data.compatibility ?? {},
            pricingOverrides: data.pricingOverrides ?? [],
            monthlyNet: data.monthlyNet ?? null,
            yearlyNet: data.yearlyNet ?? null,
            marketed: data.marketed ?? true,
        };
        this.versions.set(row.id, row);
        return row;
    }

    async updateDraft(
        versionId: string,
        data: UpdateBundleVersionDraftData,
    ): Promise<BundleVersionRow> {
        const existing = this.versions.get(versionId);
        if (!existing) throw new Error(`BundleVersion '${versionId}' nicht gefunden`);
        // Service prüft Editierbarkeit (Draft oder published-but-future,
        // SPEC_V2 §11.1 M6 Pack 2c). Adapter persistiert nur.
        const updated: BundleVersionRow = {
            ...existing,
            features: data.features ?? existing.features,
            quotas: data.quotas ?? existing.quotas,
            compatibility: data.compatibility ?? existing.compatibility,
            pricingOverrides: data.pricingOverrides ?? existing.pricingOverrides,
            monthlyNet: data.monthlyNet !== undefined ? data.monthlyNet : existing.monthlyNet,
            yearlyNet: data.yearlyNet !== undefined ? data.yearlyNet : existing.yearlyNet,
            marketed: data.marketed ?? existing.marketed,
            changeNote: data.changeNote ?? existing.changeNote,
            validFrom: data.validFrom !== undefined ? data.validFrom : existing.validFrom,
            validUntil: data.validUntil !== undefined ? data.validUntil : existing.validUntil,
            updatedAt: this.nowIso(),
        };
        this.versions.set(versionId, updated);
        return updated;
    }

    async deleteDraft(versionId: string): Promise<void> {
        const existing = this.versions.get(versionId);
        if (!existing) return;
        if (existing.publishedAt !== null) {
            throw new Error(`BundleVersion '${versionId}' ist bereits published`);
        }
        this.versions.delete(versionId);
    }

    async publishDraft(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
            validFrom: Date;
            validUntil: Date | null;
        },
    ): Promise<BundleVersionRow> {
        const draft = this.versions.get(versionId);
        if (!draft) throw new Error(`BundleVersion '${versionId}' nicht gefunden`);
        if (draft.publishedAt !== null) {
            throw new Error(`BundleVersion '${versionId}' ist bereits published`);
        }
        const now = this.nowIso();
        const validFromIso = publishMeta.validFrom.toISOString();
        const validUntilIso = publishMeta.validUntil ? publishMeta.validUntil.toISOString() : null;
        // 1. Vorherige Live → superseded + Auto-Sukzession (validUntil =
        //    validFrom des Nachfolgers - 1 Tag), analog FakePlanRepository.
        const previous = await this.findLatestLive(draft.bundleId);
        if (previous) {
            const dayMs = 24 * 60 * 60 * 1000;
            const inheritedValidUntil = new Date(
                publishMeta.validFrom.getTime() - dayMs,
            ).toISOString();
            this.versions.set(previous.id, {
                ...previous,
                supersededAt: now,
                validUntil: inheritedValidUntil,
                updatedAt: now,
            });
        }
        // 2. Draft → published
        const published: BundleVersionRow = {
            ...draft,
            publishedAt: now,
            publishedChanges: publishMeta.publishedChanges,
            nonRegressive: publishMeta.nonRegressive,
            publishedByUserId: publishMeta.publishedByUserId,
            validFrom: validFromIso,
            validUntil: validUntilIso,
            updatedAt: now,
        };
        this.versions.set(versionId, published);
        return published;
    }
}

/**
 * In-Memory-Implementierung von `BusinessTypeRepository`. Hält die
 * BusinessTypeBundle-Junction direkt in den BusinessTypeVersionRow-Objekten
 * (analog zur Wire-Format-Konvention).
 */
export class FakeBusinessTypeRepository implements BusinessTypeRepository {
    private readonly types = new Map<string, BusinessTypeRow>();
    private readonly versions = new Map<string, BusinessTypeVersionRow>();
    private nextId = 1;

    private genId(prefix: string): string {
        const n = this.nextId++;
        const suffix = n.toString(16).padStart(12, '0');
        return `${prefix}aaaa-aaaa-aaaa-aaaa-${suffix}`;
    }

    private nowIso(): string {
        return new Date().toISOString();
    }

    seedBusinessType(row: BusinessTypeRow): void {
        this.types.set(row.id, row);
    }

    seedVersion(row: BusinessTypeVersionRow): void {
        this.versions.set(row.id, row);
    }

    clear(): void {
        this.types.clear();
        this.versions.clear();
    }

    async list(filter: BusinessTypeListFilter): Promise<BusinessTypeRow[]> {
        const excludeDeleted = filter.excludeDeleted ?? true;
        return [...this.types.values()].filter(
            (t) => t.projectKey === filter.projectKey && (!excludeDeleted || t.deletedAt === null),
        );
    }

    async findById(businessTypeId: string): Promise<BusinessTypeRow | null> {
        return this.types.get(businessTypeId) ?? null;
    }

    async findByKey(projectKey: string, businessTypeKey: string): Promise<BusinessTypeRow | null> {
        for (const t of this.types.values()) {
            if (
                t.projectKey === projectKey &&
                t.businessTypeKey === businessTypeKey &&
                t.deletedAt === null
            ) {
                return t;
            }
        }
        return null;
    }

    async create(data: CreateBusinessTypeData): Promise<BusinessTypeRow> {
        const now = this.nowIso();
        const row: BusinessTypeRow = {
            id: this.genId('cccc'),
            projectKey: data.projectKey,
            businessTypeKey: data.businessTypeKey,
            label: data.label,
            description: data.description ?? null,
            icon: data.icon ?? null,
            sortOrder: data.sortOrder ?? 0,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
        };
        this.types.set(row.id, row);
        return row;
    }

    async update(businessTypeId: string, data: UpdateBusinessTypeData): Promise<BusinessTypeRow> {
        const existing = this.types.get(businessTypeId);
        if (!existing) throw new Error(`BusinessType '${businessTypeId}' nicht gefunden`);
        const updated: BusinessTypeRow = {
            ...existing,
            label: data.label ?? existing.label,
            description: data.description !== undefined ? data.description : existing.description,
            icon: data.icon !== undefined ? data.icon : existing.icon,
            sortOrder: data.sortOrder ?? existing.sortOrder,
            updatedAt: this.nowIso(),
        };
        this.types.set(businessTypeId, updated);
        return updated;
    }

    async softDelete(businessTypeId: string): Promise<void> {
        const existing = this.types.get(businessTypeId);
        if (!existing) throw new Error(`BusinessType '${businessTypeId}' nicht gefunden`);
        this.types.set(businessTypeId, { ...existing, deletedAt: this.nowIso() });
    }

    async listVersions(businessTypeId: string): Promise<BusinessTypeVersionRow[]> {
        return [...this.versions.values()]
            .filter((v) => v.businessTypeId === businessTypeId)
            .sort((a, b) => a.version - b.version);
    }

    async findVersionById(versionId: string): Promise<BusinessTypeVersionRow | null> {
        return this.versions.get(versionId) ?? null;
    }

    async findCurrentDraft(businessTypeId: string): Promise<BusinessTypeVersionRow | null> {
        for (const v of this.versions.values()) {
            if (v.businessTypeId === businessTypeId && v.publishedAt === null) return v;
        }
        return null;
    }

    async findLatestLive(businessTypeId: string): Promise<BusinessTypeVersionRow | null> {
        for (const v of this.versions.values()) {
            if (
                v.businessTypeId === businessTypeId &&
                v.publishedAt !== null &&
                v.supersededAt === null
            ) {
                return v;
            }
        }
        return null;
    }

    async createDraft(data: CreateBusinessTypeVersionDraftData): Promise<BusinessTypeVersionRow> {
        const draft = await this.findCurrentDraft(data.businessTypeId);
        if (draft) {
            throw new Error(
                `BusinessType '${data.businessTypeId}' hat bereits eine Draft-Version v${draft.version}`,
            );
        }
        const all = await this.listVersions(data.businessTypeId);
        const nextVersion = all.length === 0 ? 1 : Math.max(...all.map((v) => v.version)) + 1;
        const now = this.nowIso();
        const businessType = this.types.get(data.businessTypeId);
        const bundles: BusinessTypeBundleRow[] = data.bundles.map((b) => ({
            bundleVersionId: b.bundleVersionId,
            bundleKey: '',
            bundleLabel: '',
            bundleVersion: 0,
            sortOrder: b.sortOrder ?? 0,
        }));
        const row: BusinessTypeVersionRow = {
            id: this.genId('wwww'),
            version: nextVersion,
            baseVersionId: data.baseVersionId ?? null,
            publishedAt: null,
            supersededAt: null,
            publishedChanges: null,
            changeNote: data.changeNote ?? '',
            nonRegressive: true,
            createdByUserId: data.createdByUserId ?? null,
            publishedByUserId: null,
            validFrom: null,
            validUntil: null,
            createdAt: now,
            updatedAt: now,
            businessTypeId: data.businessTypeId,
            businessTypeKey: businessType?.businessTypeKey ?? '',
            label: businessType?.label ?? '',
            quotaOverrides: data.quotaOverrides ?? {},
            monthlyNet: data.monthlyNet ?? null,
            yearlyNet: data.yearlyNet ?? null,
            marketed: data.marketed ?? true,
            bundles,
        };
        this.versions.set(row.id, row);
        return row;
    }

    async updateDraft(
        versionId: string,
        data: UpdateBusinessTypeVersionDraftData,
    ): Promise<BusinessTypeVersionRow> {
        const existing = this.versions.get(versionId);
        if (!existing) throw new Error(`BusinessTypeVersion '${versionId}' nicht gefunden`);
        if (existing.publishedAt !== null) {
            throw new Error(`BusinessTypeVersion '${versionId}' ist bereits published`);
        }
        const bundles = data.bundles
            ? data.bundles.map((b) => ({
                  bundleVersionId: b.bundleVersionId,
                  bundleKey: '',
                  bundleLabel: '',
                  bundleVersion: 0,
                  sortOrder: b.sortOrder ?? 0,
              }))
            : existing.bundles;
        const updated: BusinessTypeVersionRow = {
            ...existing,
            quotaOverrides: data.quotaOverrides ?? existing.quotaOverrides,
            monthlyNet: data.monthlyNet !== undefined ? data.monthlyNet : existing.monthlyNet,
            yearlyNet: data.yearlyNet !== undefined ? data.yearlyNet : existing.yearlyNet,
            marketed: data.marketed ?? existing.marketed,
            changeNote: data.changeNote ?? existing.changeNote,
            bundles,
            updatedAt: this.nowIso(),
        };
        this.versions.set(versionId, updated);
        return updated;
    }

    async publishDraft(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
        },
    ): Promise<BusinessTypeVersionRow> {
        const draft = this.versions.get(versionId);
        if (!draft) throw new Error(`BusinessTypeVersion '${versionId}' nicht gefunden`);
        if (draft.publishedAt !== null) {
            throw new Error(`BusinessTypeVersion '${versionId}' ist bereits published`);
        }
        const now = this.nowIso();
        const previous = await this.findLatestLive(draft.businessTypeId);
        if (previous) {
            this.versions.set(previous.id, { ...previous, supersededAt: now, updatedAt: now });
        }
        const published: BusinessTypeVersionRow = {
            ...draft,
            publishedAt: now,
            publishedChanges: publishMeta.publishedChanges,
            nonRegressive: publishMeta.nonRegressive,
            publishedByUserId: publishMeta.publishedByUserId,
            updatedAt: now,
        };
        this.versions.set(versionId, published);
        return published;
    }
}

/**
 * In-Memory-Implementierung von `MarketingProjectionRepository`. Erzwingt
 * Eindeutigkeit über (`targetType`, `targetVersionId`, `locale`) wie das
 * DB-Schema.
 */
export class FakeMarketingProjectionRepository implements MarketingProjectionRepository {
    private readonly rows = new Map<string, MarketingProjectionRow>();
    private nextId = 1;

    private genId(): string {
        const n = this.nextId++;
        const suffix = n.toString(16).padStart(12, '0');
        return `mmmmaaaa-aaaa-aaaa-aaaa-${suffix}`;
    }

    private nowIso(): string {
        return new Date().toISOString();
    }

    seed(row: MarketingProjectionRow): void {
        this.rows.set(row.id, row);
    }

    clear(): void {
        this.rows.clear();
    }

    async list(filter: MarketingProjectionFilter): Promise<MarketingProjectionRow[]> {
        return [...this.rows.values()].filter((r) => {
            if (r.projectKey !== filter.projectKey) return false;
            if (filter.targetType && r.targetType !== filter.targetType) return false;
            if (filter.targetVersionId && r.targetVersionId !== filter.targetVersionId)
                return false;
            if (filter.locale && r.locale !== filter.locale) return false;
            return true;
        });
    }

    async findById(id: string): Promise<MarketingProjectionRow | null> {
        return this.rows.get(id) ?? null;
    }

    async findByTarget(
        targetType: string,
        targetVersionId: string,
        locale: string,
    ): Promise<MarketingProjectionRow | null> {
        for (const r of this.rows.values()) {
            if (
                r.targetType === targetType &&
                r.targetVersionId === targetVersionId &&
                r.locale === locale
            ) {
                return r;
            }
        }
        return null;
    }

    async create(data: CreateMarketingProjectionData): Promise<MarketingProjectionRow> {
        const locale = data.locale ?? 'de';
        const existing = await this.findByTarget(data.targetType, data.targetVersionId, locale);
        if (existing) {
            throw new Error(
                `MarketingProjection für ${data.targetType}/${data.targetVersionId}/${locale} existiert bereits`,
            );
        }
        const now = this.nowIso();
        const row: MarketingProjectionRow = {
            id: this.genId(),
            projectKey: data.projectKey,
            targetType: data.targetType,
            targetVersionId: data.targetVersionId,
            locale,
            displayLabel: data.displayLabel,
            description: data.description,
            visible: data.visible ?? true,
            badge: data.badge ?? '',
            topFeatures: data.topFeatures ?? [],
            trialEnabled: data.trialEnabled ?? false,
            trialDays: data.trialDays ?? 30,
            priceTag: data.priceTag ?? null,
            ctaLabel: data.ctaLabel ?? null,
            priority: data.priority ?? 0,
            highlight: data.highlight ?? false,
            createdAt: now,
            updatedAt: now,
        };
        this.rows.set(row.id, row);
        return row;
    }

    async update(id: string, data: UpdateMarketingProjectionData): Promise<MarketingProjectionRow> {
        const existing = this.rows.get(id);
        if (!existing) throw new Error(`MarketingProjection '${id}' nicht gefunden`);
        const updated: MarketingProjectionRow = {
            ...existing,
            displayLabel: data.displayLabel ?? existing.displayLabel,
            description: data.description ?? existing.description,
            visible: data.visible ?? existing.visible,
            badge: data.badge ?? existing.badge,
            topFeatures: data.topFeatures ?? existing.topFeatures,
            trialEnabled: data.trialEnabled ?? existing.trialEnabled,
            trialDays: data.trialDays ?? existing.trialDays,
            priceTag: data.priceTag !== undefined ? data.priceTag : existing.priceTag,
            ctaLabel: data.ctaLabel !== undefined ? data.ctaLabel : existing.ctaLabel,
            priority: data.priority ?? existing.priority,
            highlight: data.highlight ?? existing.highlight,
            updatedAt: this.nowIso(),
        };
        this.rows.set(id, updated);
        return updated;
    }

    async delete(id: string): Promise<void> {
        if (!this.rows.has(id)) throw new Error(`MarketingProjection '${id}' nicht gefunden`);
        this.rows.delete(id);
    }
}

// =============================================================================
// FakePlanRepository — In-Memory `Plan`-Stamm (SPEC_V2 §11.1 M6, Pack 1).
// =============================================================================

export class FakePlanRepository implements PlanRepository {
    private readonly plans = new Map<string, PlanRow>();
    private readonly versions = new Map<string, PlanVersionRow>();
    private nextId = 1;
    private nextVersionId = 1;

    private genId(): string {
        const n = this.nextId++;
        const suffix = n.toString(16).padStart(12, '0');
        return `dddd-aaaa-aaaa-aaaa-aaaa-${suffix}`;
    }

    private genVersionId(): string {
        const n = this.nextVersionId++;
        const suffix = n.toString(16).padStart(12, '0');
        return `eeee-aaaa-aaaa-aaaa-aaaa-${suffix}`;
    }

    private nowIso(): string {
        return new Date().toISOString();
    }

    seed(row: PlanRow): void {
        this.plans.set(row.id, row);
    }

    seedVersion(row: PlanVersionRow): void {
        this.versions.set(row.id, row);
    }

    clear(): void {
        this.plans.clear();
        this.versions.clear();
    }

    async list(filter: PlanListFilter): Promise<PlanRow[]> {
        const excludeDeleted = filter.excludeDeleted ?? true;
        // Weiche Bindung Plan.planKey === PlanVersion.planId (s. Lifecycle unten).
        const liveKeys = filter.onlyPublished
            ? new Set(
                  [...this.versions.values()]
                      .filter((v) => v.publishedAt != null && v.supersededAt == null)
                      .map((v) => v.planId),
              )
            : null;
        return [...this.plans.values()].filter(
            (p) =>
                p.projectKey === filter.projectKey &&
                (!excludeDeleted || p.deletedAt === null) &&
                (!liveKeys || liveKeys.has(p.planKey)),
        );
    }

    async findById(planId: string): Promise<PlanRow | null> {
        return this.plans.get(planId) ?? null;
    }

    async findByKey(projectKey: string, planKey: string): Promise<PlanRow | null> {
        for (const p of this.plans.values()) {
            if (p.projectKey === projectKey && p.planKey === planKey && p.deletedAt === null) {
                return p;
            }
        }
        return null;
    }

    async create(data: CreatePlanData): Promise<PlanRow> {
        const now = this.nowIso();
        const row: PlanRow = {
            id: this.genId(),
            projectKey: data.projectKey,
            planKey: data.planKey,
            label: data.label,
            description: data.description ?? null,
            icon: data.icon ?? null,
            sortOrder: data.sortOrder ?? 0,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
        };
        this.plans.set(row.id, row);
        return row;
    }

    async update(planId: string, data: UpdatePlanData): Promise<PlanRow> {
        const existing = this.plans.get(planId);
        if (!existing) throw new Error(`Plan '${planId}' nicht gefunden`);
        const updated: PlanRow = {
            ...existing,
            label: data.label ?? existing.label,
            description: data.description ?? existing.description,
            icon: data.icon ?? existing.icon,
            sortOrder: data.sortOrder ?? existing.sortOrder,
            updatedAt: this.nowIso(),
        };
        this.plans.set(planId, updated);
        return updated;
    }

    async softDelete(planId: string): Promise<void> {
        const existing = this.plans.get(planId);
        if (!existing) throw new Error(`Plan '${planId}' nicht gefunden`);
        const updated: PlanRow = {
            ...existing,
            deletedAt: this.nowIso(),
            updatedAt: this.nowIso(),
        };
        this.plans.set(planId, updated);
    }

    async hardDelete(planId: string): Promise<void> {
        const existing = this.plans.get(planId);
        if (!existing) return; // idempotent
        this.plans.delete(planId);
        // Sicherheitsnetz: räume etwaige verwaiste Versionen mit auf —
        // der Service prüft das vorher, hier ist es nur Defense-in-Depth.
        for (const [id, v] of this.versions.entries()) {
            if (v.planId === existing.planKey) this.versions.delete(id);
        }
    }

    // ─── Lifecycle (SPEC_V2 §11.1 M6 Pack 2a) ───
    // Bindung Plan ↔ PlanVersion: PlanVersion.planId === Plan.planKey
    // (weiche String-Referenz). Lifecycle-Methoden nehmen planKey
    // entgegen — der Service resolvet die Plan-UUID vorher.

    async listVersions(planKey: string): Promise<PlanVersionRow[]> {
        return [...this.versions.values()]
            .filter((v) => v.planId === planKey)
            .sort((a, b) => a.version - b.version);
    }

    async findVersionById(versionId: string): Promise<PlanVersionRow | null> {
        return this.versions.get(versionId) ?? null;
    }

    async findCurrentDraft(planKey: string): Promise<PlanVersionRow | null> {
        for (const v of this.versions.values()) {
            if (v.planId === planKey && v.publishedAt === null) return v;
        }
        return null;
    }

    async findLatestLivePlanVersion(planKey: string): Promise<PlanVersionRow | null> {
        const now = Date.now();
        const live = [...this.versions.values()].filter((v) => {
            if (v.planId !== planKey) return false;
            if (v.publishedAt === null) return false;
            if (v.supersededAt !== null) return false;
            if (v.endsAt) {
                const ends = new Date(v.endsAt).getTime();
                if (!Number.isNaN(ends) && ends <= now) return false;
            }
            return true;
        });
        live.sort((a, b) => b.version - a.version);
        return live[0] ?? null;
    }

    async findActivePlanVersion(
        planKey: string,
        asOf: Date = new Date(),
    ): Promise<PlanVersionRow | null> {
        const t = asOf.getTime();
        const dayStart = startOfUtcDay(asOf).getTime();
        const matches = [...this.versions.values()].filter((v) => {
            if (v.planId !== planKey) return false;
            if (v.publishedAt === null) return false;
            // validFrom NULL = „gilt seit jeher" (tolerant ggü. Altdaten ohne Startdatum).
            if (v.validFrom) {
                const from = new Date(v.validFrom).getTime();
                if (Number.isNaN(from) || from > t) return false;
            }
            // validUntil ist tag-inklusiv: erst ab dem Folgetag dunkel.
            if (v.validUntil) {
                const until = new Date(v.validUntil).getTime();
                if (!Number.isNaN(until) && until < dayStart) return false;
            }
            // endsAt ist eine präzise Terminierung (Zeitstempel), nicht tagweise.
            if (v.endsAt) {
                const ends = new Date(v.endsAt).getTime();
                if (!Number.isNaN(ends) && ends <= t) return false;
            }
            return true;
        });
        // Höchstes validFrom gewinnt; bei Gleichstand höchste version.
        // validFrom NULL sortiert zuletzt (0) — echter Fallback, kein Override.
        matches.sort((a, b) => {
            const fa = a.validFrom ? new Date(a.validFrom).getTime() : 0;
            const fb = b.validFrom ? new Date(b.validFrom).getTime() : 0;
            if (fb !== fa) return fb - fa;
            return b.version - a.version;
        });
        return matches[0] ?? null;
    }

    async createPlanVersionDraft(data: CreatePlanVersionDraftData): Promise<PlanVersionRow> {
        // data.planId ist hier bereits planKey (Service hat resolved).
        const planKey = data.planId;
        const versions = [...this.versions.values()].filter((v) => v.planId === planKey);
        const nextVersion = versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
        const now = this.nowIso();
        const row: PlanVersionRow = {
            id: this.genVersionId(),
            planId: planKey,
            version: nextVersion,
            baseVersionId: data.baseVersionId ?? null,
            features: data.features,
            bundles: data.bundles ?? [],
            quotas: data.quotas,
            monthlyNet: data.monthlyNet,
            yearlyNet: data.yearlyNet,
            marketed: data.marketed ?? true,
            publishedAt: null,
            supersededAt: null,
            publishedChanges: null,
            changeNote: data.changeNote ?? '',
            nonRegressive: true,
            validFrom: data.validFrom ?? null,
            validUntil: data.validUntil ?? null,
            endsAt: null,
            createdByUserId: data.createdByUserId ?? null,
            publishedByUserId: null,
            createdAt: now,
            updatedAt: now,
        };
        this.versions.set(row.id, row);
        return row;
    }

    async updatePlanVersionDraft(
        versionId: string,
        data: UpdatePlanVersionDraftData,
    ): Promise<PlanVersionRow> {
        const existing = this.versions.get(versionId);
        if (!existing) throw new Error(`PlanVersion '${versionId}' nicht gefunden`);
        const updated: PlanVersionRow = {
            ...existing,
            features: data.features ?? existing.features,
            bundles: data.bundles ?? existing.bundles ?? [],
            quotas: data.quotas ?? existing.quotas,
            monthlyNet: data.monthlyNet ?? existing.monthlyNet,
            yearlyNet: data.yearlyNet ?? existing.yearlyNet,
            marketed: data.marketed ?? existing.marketed,
            changeNote: data.changeNote ?? existing.changeNote,
            updatedAt: this.nowIso(),
        };
        this.versions.set(versionId, updated);
        return updated;
    }

    async publishPlanVersionDraft(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
            validFrom: Date;
            validUntil: Date | null;
        },
    ): Promise<PlanVersionRow> {
        const draft = this.versions.get(versionId);
        if (!draft) throw new Error(`PlanVersion '${versionId}' nicht gefunden`);
        const planKey = draft.planId;
        const now = this.nowIso();
        // Vorgängerin: supersededAt + Auto-Sukzession von validUntil
        // (= validFrom des Nachfolgers - 1 Tag).
        const dayMs = 24 * 60 * 60 * 1000;
        const inheritedValidUntil = new Date(publishMeta.validFrom.getTime() - dayMs).toISOString();
        for (const v of this.versions.values()) {
            if (
                v.planId === planKey &&
                v.publishedAt !== null &&
                v.supersededAt === null &&
                v.id !== versionId
            ) {
                this.versions.set(v.id, {
                    ...v,
                    supersededAt: now,
                    validUntil: v.validUntil ?? inheritedValidUntil,
                    updatedAt: now,
                });
            }
        }
        const published: PlanVersionRow = {
            ...draft,
            publishedAt: now,
            publishedChanges: publishMeta.publishedChanges,
            nonRegressive: publishMeta.nonRegressive,
            publishedByUserId: publishMeta.publishedByUserId,
            validFrom: publishMeta.validFrom.toISOString(),
            validUntil: publishMeta.validUntil ? publishMeta.validUntil.toISOString() : null,
            updatedAt: now,
        };
        this.versions.set(versionId, published);
        return published;
    }

    async deletePlanVersionDraft(versionId: string): Promise<void> {
        const existing = this.versions.get(versionId);
        if (!existing) return;
        if (existing.publishedAt !== null) {
            throw new Error(
                `FakePlanRepository: PlanVersion '${versionId}' ist bereits published — Discard nicht erlaubt`,
            );
        }
        this.versions.delete(versionId);
    }

    async terminate(versionId: string, endsAt: Date): Promise<PlanVersionRow> {
        const existing = this.versions.get(versionId);
        if (!existing) {
            throw new Error(`FakePlanRepository: PlanVersion '${versionId}' nicht gefunden`);
        }
        const updated: PlanVersionRow = {
            ...existing,
            endsAt: endsAt.toISOString(),
            updatedAt: this.nowIso(),
        };
        this.versions.set(versionId, updated);
        return updated;
    }
}
