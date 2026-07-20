// Diff classification for plan/bundle versions — pure functions.
//
// Regression rule (ROADMAP §2 no. 2): as soon as AT LEAST ONE individual
// change has `direction = 'REGRESSION'`, the entire version counts as
// regressive (`nonRegressive = false`) — even for mixed changes with
// positive parts. This is implemented here via the `Array.some` check in
// `buildResult()`.
//
// These functions are **NestJS-free** and can be used both in the backend
// (`@saasicat/nest/billing` re-exports them) and in the
// frontend (`@saasicat/ui-vue` consumer wrappers). Anyone who previously
// imported from `saas-platform-nest/billing` can keep doing so — the
// re-export remains.

import type { FeatureKey, QuotaKey } from './plan-catalog.types.js';
import type { VersionChange, VersionChangeDirection } from './subscription.types.js';

export type { VersionChange, VersionChangeDirection };

/** Alias for historical compatibility — equivalent to VersionChangeDirection. */
export type ChangeDirection = VersionChangeDirection;

export interface DiffResult {
    nonRegressive: boolean;
    changes: VersionChange[];
}

/**
 * `Decimal | string | number` — the three forms in which prices appear
 * in the platform. `Decimal` is the Prisma class (with
 * `.toNumber()`), which is not imported directly in order to keep the
 * platform Prisma-free — a structural view suffices.
 */
type DecimalLike = number | string | { toNumber(): number };

export interface PlanVersionFields {
    features: FeatureKey[];
    maxUsers: number;
    maxVehicles: number;
    maxStorageGb: number;
    monthlyNet: DecimalLike;
    yearlyNet: DecimalLike;
}

export interface BundleVersionFields {
    features: FeatureKey[];
    /** Quota contributions of the bundle. -1 = unlimited; missing key = 0. */
    quotas: Record<QuotaKey, number>;
    /** Default pricing; null = only override pricing possible. */
    monthlyNet: DecimalLike | null;
    yearlyNet: DecimalLike | null;
}

export interface BusinessTypeVersionFields {
    /**
     * Ordered list of the referenced bundles. Only `bundleVersionId`
     * is relevant for the diff (order is derived via sortOrder,
     * if present). Structurally compatible with
     * `BusinessTypeVersionRow.bundles`, so the UI can call the classifier
     * directly with row values.
     */
    bundles: Array<{ bundleVersionId: string }>;
    /** Quota overrides; missing key = Σ(bundle quotas), a set key replaces. */
    quotaOverrides: Partial<Record<QuotaKey, number>>;
    /** null = Σ(bundle prices); set = override. */
    monthlyNet: DecimalLike | null;
    yearlyNet: DecimalLike | null;
}

export function classifyPlanDiff(oldV: PlanVersionFields, newV: PlanVersionFields): DiffResult {
    const changes: VersionChange[] = [];

    appendFeatureChanges(changes, oldV.features, newV.features);
    appendNumberChange(changes, 'maxUsers', oldV.maxUsers, newV.maxUsers, 'higherIsBetter');
    appendNumberChange(
        changes,
        'maxVehicles',
        oldV.maxVehicles,
        newV.maxVehicles,
        'higherIsBetter',
    );
    appendNumberChange(
        changes,
        'maxStorageGb',
        oldV.maxStorageGb,
        newV.maxStorageGb,
        'higherIsBetter',
    );
    appendDecimalChange(changes, 'monthlyNet', oldV.monthlyNet, newV.monthlyNet, 'lowerIsBetter');
    appendDecimalChange(changes, 'yearlyNet', oldV.yearlyNet, newV.yearlyNet, 'lowerIsBetter');

    return buildResult(changes);
}

/**
 * Classification of a BusinessTypeVersion diff.
 *
 * - Bundle composition: added/removed (analogous to features). Adding a
 *   bundle is IMPROVEMENT, removing is REGRESSION.
 * - QuotaOverrides: comparison as with BundleVersion (-1 = unlimited).
 * - Pricing: override value ↔ null as with BundleVersion.
 */
export function classifyBusinessTypeVersionDiff(
    oldV: BusinessTypeVersionFields,
    newV: BusinessTypeVersionFields,
): DiffResult {
    const changes: VersionChange[] = [];

    appendBundleCompositionChanges(
        changes,
        oldV.bundles.map((b) => b.bundleVersionId),
        newV.bundles.map((b) => b.bundleVersionId),
    );
    appendQuotaChanges(
        changes,
        oldV.quotaOverrides as Record<string, number>,
        newV.quotaOverrides as Record<string, number>,
    );
    appendNullableDecimalChange(
        changes,
        'monthlyNet',
        oldV.monthlyNet,
        newV.monthlyNet,
        'lowerIsBetter',
    );
    appendNullableDecimalChange(
        changes,
        'yearlyNet',
        oldV.yearlyNet,
        newV.yearlyNet,
        'lowerIsBetter',
    );

    return buildResult(changes);
}

function appendBundleCompositionChanges(
    out: VersionChange[],
    oldIds: string[],
    newIds: string[],
): void {
    const oldSet = new Set(oldIds);
    const newSet = new Set(newIds);
    const removed = oldIds.filter((id) => !newSet.has(id));
    const added = newIds.filter((id) => !oldSet.has(id));

    if (removed.length > 0) {
        out.push({
            field: 'bundles.removed',
            oldValue: removed,
            newValue: [],
            direction: 'REGRESSION',
        });
    }
    if (added.length > 0) {
        out.push({
            field: 'bundles.added',
            oldValue: [],
            newValue: added,
            direction: 'IMPROVEMENT',
        });
    }
}

/**
 * Classification of a BundleVersion diff for SPEC_V2 §7 contract protection.
 *
 * Quota comparison: `-1` (unlimited) is always better than any positive
 * number. Otherwise higher = better. Missing keys are treated as 0.
 *
 * Pricing can be `null` (the bundle only has override pricing); a switch
 * from value ↔ null is classified as REGRESSION (value dropped) or IMPROVEMENT
 * (value added, lowerIsBetter inverted). Both null
 * stay NEUTRAL.
 */
export function classifyBundleVersionDiff(
    oldV: BundleVersionFields,
    newV: BundleVersionFields,
): DiffResult {
    const changes: VersionChange[] = [];

    appendFeatureChanges(changes, oldV.features, newV.features);
    appendQuotaChanges(changes, oldV.quotas, newV.quotas);
    appendNullableDecimalChange(
        changes,
        'monthlyNet',
        oldV.monthlyNet,
        newV.monthlyNet,
        'lowerIsBetter',
    );
    appendNullableDecimalChange(
        changes,
        'yearlyNet',
        oldV.yearlyNet,
        newV.yearlyNet,
        'lowerIsBetter',
    );

    return buildResult(changes);
}

// ---------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------

type Polarity = 'higherIsBetter' | 'lowerIsBetter';

function appendFeatureChanges(
    out: VersionChange[],
    oldFeatures: FeatureKey[],
    newFeatures: FeatureKey[],
): void {
    const oldSet = new Set(oldFeatures);
    const newSet = new Set(newFeatures);
    const removed = oldFeatures.filter((f) => !newSet.has(f));
    const added = newFeatures.filter((f) => !oldSet.has(f));

    if (removed.length > 0) {
        out.push({
            field: 'features.removed',
            oldValue: removed,
            newValue: [],
            direction: 'REGRESSION',
        });
    }
    if (added.length > 0) {
        out.push({
            field: 'features.added',
            oldValue: [],
            newValue: added,
            direction: 'IMPROVEMENT',
        });
    }
}

function appendNumberChange(
    out: VersionChange[],
    field: string,
    oldValue: number,
    newValue: number,
    polarity: Polarity,
): void {
    if (oldValue === newValue) return;
    const direction = directionFromCmp(newValue - oldValue, polarity);
    out.push({ field, oldValue, newValue, direction });
}

function appendDecimalChange(
    out: VersionChange[],
    field: string,
    oldValue: DecimalLike,
    newValue: DecimalLike,
    polarity: Polarity,
): void {
    const oldNum = toNumber(oldValue);
    const newNum = toNumber(newValue);
    if (oldNum === newNum) return;
    const direction = directionFromCmp(newNum - oldNum, polarity);
    out.push({
        field,
        oldValue: oldNum.toFixed(2),
        newValue: newNum.toFixed(2),
        direction,
    });
}

function directionFromCmp(delta: number, polarity: Polarity): VersionChangeDirection {
    if (delta === 0) return 'NEUTRAL';
    const positiveDelta = delta > 0;
    if (polarity === 'higherIsBetter') {
        return positiveDelta ? 'IMPROVEMENT' : 'REGRESSION';
    }
    return positiveDelta ? 'REGRESSION' : 'IMPROVEMENT';
}

function toNumber(v: DecimalLike): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return Number(v);
    return v.toNumber();
}

function buildResult(changes: VersionChange[]): DiffResult {
    const nonRegressive = !changes.some((c) => c.direction === 'REGRESSION');
    return { nonRegressive, changes };
}

function appendQuotaChanges(
    out: VersionChange[],
    oldQuotas: Record<string, number>,
    newQuotas: Record<string, number>,
): void {
    const allKeys = new Set([...Object.keys(oldQuotas), ...Object.keys(newQuotas)]);
    for (const key of allKeys) {
        const oldValue = oldQuotas[key] ?? 0;
        const newValue = newQuotas[key] ?? 0;
        if (oldValue === newValue) continue;
        const direction = directionFromQuotaCmp(oldValue, newValue);
        out.push({ field: `quotas.${key}`, oldValue, newValue, direction });
    }
}

function directionFromQuotaCmp(oldValue: number, newValue: number): VersionChangeDirection {
    if (oldValue === -1 && newValue !== -1) return 'REGRESSION';
    if (newValue === -1 && oldValue !== -1) return 'IMPROVEMENT';
    return newValue > oldValue ? 'IMPROVEMENT' : 'REGRESSION';
}

function appendNullableDecimalChange(
    out: VersionChange[],
    field: string,
    oldValue: DecimalLike | null,
    newValue: DecimalLike | null,
    polarity: Polarity,
): void {
    if (oldValue === null && newValue === null) return;
    if (oldValue === null && newValue !== null) {
        out.push({
            field,
            oldValue: null,
            newValue: toNumber(newValue).toFixed(2),
            direction: polarity === 'lowerIsBetter' ? 'IMPROVEMENT' : 'REGRESSION',
        });
        return;
    }
    if (oldValue !== null && newValue === null) {
        out.push({
            field,
            oldValue: toNumber(oldValue).toFixed(2),
            newValue: null,
            direction: polarity === 'lowerIsBetter' ? 'REGRESSION' : 'IMPROVEMENT',
        });
        return;
    }
    appendDecimalChange(out, field, oldValue as DecimalLike, newValue as DecimalLike, polarity);
}
