// Discovery-Scanner — baut zur Boot-Zeit den DiscoverySnapshot aus allen
// Decorator-Annotationen in registrierten Modulen.
//
// Ablauf (`OnApplicationBootstrap`-Hook):
//   1. Alle Provider + Controller via DiscoveryService einsammeln
//   2. Pro Klasse: @DefinesQuota-Metadata lesen → DiscoveredQuota
//   3. Pro Methode: @ImplementsCapability + @EnforceQuota-Metadata lesen
//      → DiscoveredCapability + Cross-Reference zu DiscoveredQuota
//   4. Aggregat: Capabilities mit gleichem `feature` → DiscoveredFeature.
//      Bundles werden NICHT aggregiert — sie kommen ausschließlich aus
//      dem SuperAdmin-UI (DB-Tabelle `bundles`, SPEC_V2 §3.1 + §11.1 M3).
//   5. Kanonischer SHA256-Hash über sortierte Snapshot-Daten (ETag-stabil)

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { DEFINES_QUOTA_KEY, ENFORCE_QUOTA_KEY, IMPLEMENTS_CAPABILITY_KEY } from './tokens.js';
import type {
    DiscoveredCapability,
    DiscoveredFeature,
    DiscoveredQuota,
    DiscoverySnapshot,
    DefinesQuotaOptions,
} from './types.js';
import type { EnforceQuotaMetadata, ImplementsCapabilityMetadata } from './decorators.js';

/**
 * App-Identität, die der Scanner in den Snapshot übernimmt. Der Konsument
 * liefert diese beim Modul-Setup, damit der Snapshot ein eindeutiges
 * `app.key` + `app.version` trägt.
 */
export interface DiscoveryAppInfo {
    key: string;
    version: string;
}

/** Default-AppInfo, wenn der Konsument nichts überschreibt. */
const DEFAULT_APP_INFO: DiscoveryAppInfo = {
    key: 'unknown',
    version: '0.0.0',
};

/**
 * DI-Token für die App-Identität. Der Konsument bindet das via
 * `DiscoveryModule.forRoot({ app: { key, version } })`.
 */
export const DISCOVERY_APP_INFO_TOKEN = Symbol('DISCOVERY_APP_INFO');

/**
 * DI-Token für einen optionalen Snapshot-Persistenz-Pfad. Wird vom
 * DiscoveryScanner beim Boot beschrieben — Konsumenten (z. B. CI-Gates,
 * Preflight-CLIs) können die JSON-Datei lesen, ohne selbst einen
 * vollständigen Module-Boot zu fahren.
 */
export const DISCOVERY_SNAPSHOT_PATH_TOKEN = Symbol('DISCOVERY_SNAPSHOT_PATH');

/** EnforceQuota-Aufruf an einer konkreten Capability — Cross-Reference. */
interface EnforceQuotaRef {
    capabilityKey: string;
    quotaKey: string;
}

@Injectable()
export class DiscoveryScanner implements OnApplicationBootstrap {
    private readonly logger = new Logger(DiscoveryScanner.name);
    private snapshot: DiscoverySnapshot | null = null;

    // Explizites @Inject statt Type-Reflection: tsup/esbuild emittieren
    // im Plattform-Paket-Build keine `design:paramtypes`-Metadata, sodass
    // Nest die DI-Targets am Constructor sonst nicht auflösen kann
    // (UndefinedDependencyException am Boot des Konsumenten). Pattern
    // analog zu admin/admin-manifest.module.ts.
    constructor(
        @Inject(DiscoveryService)
        private readonly discoveryService: DiscoveryService,
        @Inject(MetadataScanner)
        private readonly metadataScanner: MetadataScanner,
        @Inject(Reflector)
        private readonly reflector: Reflector,
        @Optional()
        @Inject(DISCOVERY_APP_INFO_TOKEN)
        private readonly appInfo: DiscoveryAppInfo = DEFAULT_APP_INFO,
        @Optional()
        @Inject(DISCOVERY_SNAPSHOT_PATH_TOKEN)
        private readonly snapshotPath: string | null = null,
    ) {}

    onApplicationBootstrap(): void {
        this.snapshot = this.buildSnapshot();
        this.logger.log(
            `Discovery snapshot built: ${this.snapshot.capabilities.length} capabilities, ` +
                `${this.snapshot.features.length} features, ` +
                `${this.snapshot.quotas.length} quotas (hash=${this.snapshot.hash.slice(0, 12)}…)`,
        );
        if (this.snapshotPath) {
            this.persistSnapshot(this.snapshotPath, this.snapshot);
        }
    }

    private persistSnapshot(path: string, snapshot: DiscoverySnapshot): void {
        try {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
            this.logger.log(`Discovery snapshot persisted to ${path}`);
        } catch (err) {
            this.logger.warn(
                `Discovery snapshot konnte nicht nach ${path} geschrieben werden: ${(err as Error).message}`,
            );
        }
    }

    /**
     * Liefert den Boot-Zeit-Snapshot. Vor `onApplicationBootstrap` (z. B. in
     * Tests) wird der Snapshot lazy gebaut.
     */
    getSnapshot(): DiscoverySnapshot {
        if (!this.snapshot) {
            this.snapshot = this.buildSnapshot();
        }
        return this.snapshot;
    }

    /**
     * Erzwingt einen Re-Scan (SuperAdmin „Discovery neu ausführen" bzw. Tests
     * mit dynamisch registrierten Providern). `scannedAt` wird neu gesetzt und
     * der Snapshot — wie beim Boot — auf Platte persistiert, damit der zuletzt
     * tatsächlich durchgeführte Scan erhalten bleibt.
     */
    rebuildSnapshot(): DiscoverySnapshot {
        this.snapshot = this.buildSnapshot();
        if (this.snapshotPath) {
            this.persistSnapshot(this.snapshotPath, this.snapshot);
        }
        return this.snapshot;
    }

    private buildSnapshot(): DiscoverySnapshot {
        const capabilitiesByKey = new Map<string, DiscoveredCapability>();
        const quotasByKey = new Map<string, DiscoveredQuota>();
        const enforceRefs: EnforceQuotaRef[] = [];

        const wrappers = [
            ...this.discoveryService.getProviders(),
            ...this.discoveryService.getControllers(),
        ];

        for (const wrapper of wrappers) {
            const instance = wrapper.instance as object | null | undefined;
            if (!instance || typeof instance !== 'object') continue;

            const ctor = instance.constructor as new (...args: unknown[]) => unknown;
            if (!ctor) continue;

            // Klassen-Level: @DefinesQuota
            const quotaOpts = this.reflector.get<DefinesQuotaOptions | undefined>(
                DEFINES_QUOTA_KEY,
                ctor,
            );
            if (quotaOpts) {
                this.registerQuota(quotasByKey, quotaOpts, ctor.name);
            }

            // Methoden-Level: @ImplementsCapability + @EnforceQuota
            const prototype = Object.getPrototypeOf(instance) as object;
            const methodNames = this.metadataScanner.getAllMethodNames(prototype);

            for (const methodName of methodNames) {
                const methodRef = (instance as Record<string, unknown>)[methodName];
                if (typeof methodRef !== 'function') continue;

                const capMeta = this.reflector.get<ImplementsCapabilityMetadata | undefined>(
                    IMPLEMENTS_CAPABILITY_KEY,
                    methodRef,
                );
                if (capMeta) {
                    this.registerCapability(
                        capabilitiesByKey,
                        capMeta,
                        `${ctor.name}.${methodName}`,
                    );
                }

                const enforceMeta = this.reflector.get<EnforceQuotaMetadata | undefined>(
                    ENFORCE_QUOTA_KEY,
                    methodRef,
                );
                if (enforceMeta && capMeta) {
                    enforceRefs.push({
                        capabilityKey: capMeta.capabilityKey,
                        quotaKey: enforceMeta.quotaKey,
                    });
                }
            }
        }

        const capabilities = sortByKey([...capabilitiesByKey.values()], (c) => c.capabilityKey);
        const features = aggregateFeatures(capabilities);
        const quotas = sortByKey(
            decorateQuotasWithEnforcers([...quotasByKey.values()], enforceRefs),
            (q) => q.quotaKey,
        );

        const snapshot: Omit<DiscoverySnapshot, 'hash'> & { hash: string } = {
            schemaVersion: 1,
            scannedAt: new Date().toISOString(),
            app: { ...this.appInfo },
            capabilities,
            features,
            quotas,
            hash: '',
        };
        snapshot.hash = computeSnapshotHash(snapshot);
        return snapshot;
    }

    private registerCapability(
        target: Map<string, DiscoveredCapability>,
        meta: ImplementsCapabilityMetadata,
        declaredAt: string,
    ): void {
        const existing = target.get(meta.capabilityKey);
        if (existing) {
            // Capability mehrfach deklariert — wir behalten die erste Deklaration
            // und loggen den Konflikt. Strict-Mode-Check (M5+) wird das blocken.
            this.logger.warn(
                `Capability '${meta.capabilityKey}' wird an mehreren Stellen deklariert ` +
                    `(${existing.declaredAt} und ${declaredAt}); erste Deklaration gewinnt`,
            );
            return;
        }
        target.set(meta.capabilityKey, {
            capabilityKey: meta.capabilityKey,
            label: meta.label ?? null,
            feature: meta.feature ?? null,
            status: meta.status ?? 'active',
            kind: meta.kind ?? 'endpoint',
            owner: meta.owner ?? null,
            replacementKey: meta.replacementKey ?? null,
            removalPlannedAt: meta.removalPlannedAt ?? null,
            reason: meta.reason ?? null,
            requires: normalizeKeyList(meta.requires),
            replaces: normalizeKeyList(meta.replaces),
            declaredAt,
        });
    }

    private registerQuota(
        target: Map<string, DiscoveredQuota>,
        opts: DefinesQuotaOptions,
        declaredAt: string,
    ): void {
        const existing = target.get(opts.key);
        if (existing) {
            this.logger.warn(
                `Quota '${opts.key}' wird an mehreren Stellen definiert ` +
                    `(${existing.declaredAt} und ${declaredAt}); erste Definition gewinnt`,
            );
            return;
        }
        target.set(opts.key, {
            quotaKey: opts.key,
            label: opts.label,
            unit: opts.unit,
            policy: opts.policy,
            feature: opts.feature ?? null,
            replaces: normalizeKeyList(opts.replaces),
            declaredAt,
            enforcedBy: [],
        });
    }
}

// =============================================================================
// Aggregations- und Hash-Helper (pure functions, testbar in Isolation)
// =============================================================================

function aggregateFeatures(capabilities: DiscoveredCapability[]): DiscoveredFeature[] {
    interface FeatureAccumulator {
        capabilityKeys: string[];
        requires: Set<string>;
        replaces: Set<string>;
    }
    const byFeature = new Map<string, FeatureAccumulator>();
    for (const cap of capabilities) {
        if (!cap.feature) continue;
        const acc = byFeature.get(cap.feature) ?? {
            capabilityKeys: [],
            requires: new Set<string>(),
            replaces: new Set<string>(),
        };
        acc.capabilityKeys.push(cap.capabilityKey);
        for (const key of cap.requires ?? []) acc.requires.add(key);
        for (const key of cap.replaces ?? []) acc.replaces.add(key);
        byFeature.set(cap.feature, acc);
    }
    return sortByKey(
        [...byFeature.entries()].map(([featureKey, acc]) => {
            // Selbstbezüge raus: ein Feature setzt sich nicht selbst voraus
            // und kann sich nicht selbst ablösen (#35/#39).
            acc.requires.delete(featureKey);
            acc.replaces.delete(featureKey);
            return {
                featureKey,
                capabilityKeys: [...acc.capabilityKeys].sort((a, b) => a.localeCompare(b)),
                requires: setToSortedListOrNull(acc.requires),
                replaces: setToSortedListOrNull(acc.replaces),
            };
        }),
        (f) => f.featureKey,
    );
}

/**
 * Normalisiert eine Decorator-Key-Liste: dedupliziert + sortiert; leer/fehlend
 * wird `null` — so bleibt der Snapshot-Hash für Code ohne requires/replaces
 * deterministisch und das Wire-Format abwärtskompatibel lesbar.
 */
function normalizeKeyList(keys: readonly string[] | undefined): string[] | null {
    if (!keys || keys.length === 0) return null;
    return [...new Set(keys)].sort((a, b) => a.localeCompare(b));
}

function setToSortedListOrNull(keys: ReadonlySet<string>): string[] | null {
    if (keys.size === 0) return null;
    return [...keys].sort((a, b) => a.localeCompare(b));
}

function decorateQuotasWithEnforcers(
    quotas: DiscoveredQuota[],
    enforceRefs: EnforceQuotaRef[],
): DiscoveredQuota[] {
    const enforcedByQuota = new Map<string, Set<string>>();
    for (const ref of enforceRefs) {
        const set = enforcedByQuota.get(ref.quotaKey) ?? new Set<string>();
        set.add(ref.capabilityKey);
        enforcedByQuota.set(ref.quotaKey, set);
    }
    return quotas.map((q) => ({
        ...q,
        enforcedBy: [...(enforcedByQuota.get(q.quotaKey) ?? new Set<string>())].sort((a, b) =>
            a.localeCompare(b),
        ),
    }));
}

function sortByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
    return [...items].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

/**
 * Kanonischer Hash über die fachlichen Snapshot-Daten — ohne `scannedAt`
 * und `app.version`, damit derselbe Code beim Re-Boot denselben Hash
 * erzeugt. Pattern aus SPEC.md Q2 (Q2: „Stabiler manifestHash über Boot-
 * Restarts").
 */
export function computeSnapshotHash(snapshot: Omit<DiscoverySnapshot, 'hash'>): string {
    const stableInput = {
        schemaVersion: snapshot.schemaVersion,
        appKey: snapshot.app.key,
        capabilities: snapshot.capabilities.map((c) => ({
            ...c,
            // declaredAt enthält Klassennamen, ist deterministisch — bleibt drin.
        })),
        features: snapshot.features,
        quotas: snapshot.quotas,
    };
    const json = canonicalStringify(stableInput);
    return `sha256-${createHash('sha256').update(json).digest('hex')}`;
}

/**
 * JSON.stringify mit alphabetisch sortierten Object-Keys — damit der Hash
 * unabhängig von Insertion-Order ist.
 */
function canonicalStringify(value: unknown): string {
    return JSON.stringify(value, (_key, val) => {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            const sorted: Record<string, unknown> = {};
            for (const k of Object.keys(val).sort()) {
                sorted[k] = (val as Record<string, unknown>)[k];
            }
            return sorted;
        }
        return val;
    });
}
