// Discovery scanner — builds the discovery snapshot at boot time from all
// decorator annotations in registered modules.
//
// Flow (`OnApplicationBootstrap` hook):
//   1. Collect all providers + controllers via DiscoveryService
//   2. Per class: read @DefinesQuota metadata → DiscoveredQuota
//   3. Per method: read @ImplementsCapability + @EnforceQuota metadata
//      → DiscoveredCapability + cross-reference to DiscoveredQuota
//   4. Aggregate: capabilities with the same `feature` → DiscoveredFeature.
//      Bundles are NOT aggregated — they come exclusively from the
//      SuperAdmin UI (DB table `bundles`, SPEC_V2 §3.1 + §11.1 M3).
//   5. Canonical SHA256 hash over sorted snapshot data (ETag-stable)

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
 * App identity that the scanner carries into the snapshot. The consumer
 * provides this during module setup so that the snapshot carries a unique
 * `app.key` + `app.version`.
 */
export interface DiscoveryAppInfo {
    key: string;
    version: string;
}

/** Default AppInfo when the consumer overrides nothing. */
const DEFAULT_APP_INFO: DiscoveryAppInfo = {
    key: 'unknown',
    version: '0.0.0',
};

/**
 * DI token for the app identity. The consumer binds this via
 * `DiscoveryModule.forRoot({ app: { key, version } })`.
 */
export const DISCOVERY_APP_INFO_TOKEN = Symbol('DISCOVERY_APP_INFO');

/**
 * DI token for an optional snapshot persistence path. Written by the
 * DiscoveryScanner at boot — consumers (e.g. CI gates, Preflight CLIs) can
 * read the JSON file without running a full module boot themselves.
 */
export const DISCOVERY_SNAPSHOT_PATH_TOKEN = Symbol('DISCOVERY_SNAPSHOT_PATH');

/** EnforceQuota call on a concrete capability — cross-reference. */
interface EnforceQuotaRef {
    capabilityKey: string;
    quotaKey: string;
}

@Injectable()
export class DiscoveryScanner implements OnApplicationBootstrap {
    private readonly logger = new Logger(DiscoveryScanner.name);
    private snapshot: DiscoverySnapshot | null = null;

    // Explicit @Inject instead of type reflection: in the platform package
    // build tsup/esbuild do not emit `design:paramtypes` metadata, so Nest
    // cannot otherwise resolve the DI targets at the constructor
    // (UndefinedDependencyException at the consumer's boot). Pattern
    // analogous to admin/admin-manifest.module.ts.
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
     * Returns the boot-time snapshot. Before `onApplicationBootstrap` (e.g. in
     * tests) the snapshot is built lazily.
     */
    getSnapshot(): DiscoverySnapshot {
        if (!this.snapshot) {
            this.snapshot = this.buildSnapshot();
        }
        return this.snapshot;
    }

    /**
     * Forces a re-scan (SuperAdmin "re-run discovery" or tests with
     * dynamically registered providers). `scannedAt` is set anew and the
     * snapshot — as at boot — is persisted to disk so that the last scan
     * actually performed is preserved.
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

            // Class level: @DefinesQuota
            const quotaOpts = this.reflector.get<DefinesQuotaOptions | undefined>(
                DEFINES_QUOTA_KEY,
                ctor,
            );
            if (quotaOpts) {
                this.registerQuota(quotasByKey, quotaOpts, ctor.name);
            }

            // Method level: @ImplementsCapability + @EnforceQuota
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
            // Capability declared multiple times — we keep the first declaration
            // and log the conflict. The strict-mode check (M5+) will block this.
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
// Aggregation and hash helpers (pure functions, testable in isolation)
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
            // Remove self-references: a feature does not require itself and
            // cannot replace itself (#35/#39).
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
 * Normalizes a decorator key list: deduplicates + sorts; empty/missing
 * becomes `null` — so the snapshot hash stays deterministic for code without
 * requires/replaces and the wire format remains backward-compatibly readable.
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
 * Canonical hash over the business snapshot data — without `scannedAt` and
 * `app.version`, so that the same code produces the same hash on re-boot.
 * Pattern from SPEC.md Q2 (Q2: "Stable manifestHash across boot restarts").
 */
export function computeSnapshotHash(snapshot: Omit<DiscoverySnapshot, 'hash'>): string {
    const stableInput = {
        schemaVersion: snapshot.schemaVersion,
        appKey: snapshot.app.key,
        capabilities: snapshot.capabilities.map((c) => ({
            ...c,
            // declaredAt contains class names, is deterministic — stays in.
        })),
        features: snapshot.features,
        quotas: snapshot.quotas,
    };
    const json = canonicalStringify(stableInput);
    return `sha256-${createHash('sha256').update(json).digest('hex')}`;
}

/**
 * JSON.stringify with alphabetically sorted object keys — so that the hash is
 * independent of insertion order.
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
