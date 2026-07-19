// Diff-Klassifikation für Plan-/Bundle-Versionen — Pure Functions.
//
// Spec: handoff/superadmin/SPEC.md §6 +
//        handoff/superadmin/SPEC_V2.md §7 +
//        autohauspro/handoff/saas/ROADMAP_PLANS_AND_ENTITLEMENT.md §3.1 + §4.
//
// Regression-Regel (ROADMAP §2 Nr. 2): Sobald MINDESTENS EINE einzelne
// Änderung `direction = 'REGRESSION'` hat, gilt die gesamte Version als
// regressiv (`nonRegressive = false`) — auch bei gemischten Änderungen mit
// positiven Anteilen. Das ist hier durch den `Array.some`-Check in
// `buildResult()` umgesetzt.
//
// Diese Funktionen sind **NestJS-frei** und können sowohl im Backend
// (`@saasicat/nest/billing` re-exportiert sie) als auch im
// Frontend (`@saasicat/ui-vue` Konsument-Wrappers) verwendet
// werden. Wer früher aus `saas-platform-nest/billing` importiert hat, kann
// das weiter — der Re-Export bleibt bestehen.

import type { FeatureKey, QuotaKey } from './plan-catalog.types.js';
import type { VersionChange, VersionChangeDirection } from './subscription.types.js';

export type { VersionChange, VersionChangeDirection };

/** Alias für historische Kompatibilität — entspricht VersionChangeDirection. */
export type ChangeDirection = VersionChangeDirection;

export interface DiffResult {
    nonRegressive: boolean;
    changes: VersionChange[];
}

/**
 * `Decimal | string | number` — die drei Erscheinungsformen, in denen Preise
 * in der Plattform vorkommen. `Decimal` ist die Prisma-Klasse (mit
 * `.toNumber()`), die nicht direkt importiert wird, um die Plattform
 * Prisma-frei zu halten — strukturelle Sicht reicht.
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
    /** Quotas-Beiträge des Bundles. -1 = unbegrenzt; fehlender Key = 0. */
    quotas: Record<QuotaKey, number>;
    /** Default-Pricing; null = nur Override-Pricing möglich. */
    monthlyNet: DecimalLike | null;
    yearlyNet: DecimalLike | null;
}

export interface BusinessTypeVersionFields {
    /**
     * Geordnete Liste der referenzierten Bundles. Nur `bundleVersionId`
     * ist für den Diff relevant (Reihenfolge wird über sortOrder
     * abgeleitet, falls vorhanden). Strukturell kompatibel zu
     * `BusinessTypeVersionRow.bundles`, sodass die UI den Klassifikator
     * direkt mit Row-Werten aufrufen kann.
     */
    bundles: Array<{ bundleVersionId: string }>;
    /** Quota-Overrides; fehlender Key = Σ(Bundle-Quotas), gesetzter Key ersetzt. */
    quotaOverrides: Partial<Record<QuotaKey, number>>;
    /** null = Σ(Bundle-Preise); gesetzt = Override. */
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
 * Klassifikation eines BusinessTypeVersion-Diffs.
 *
 * - Bundles-Komposition: added/removed (analog Features). Hinzufügen eines
 *   Bundles ist IMPROVEMENT, Entfernen REGRESSION.
 * - QuotaOverrides: Vergleich wie bei BundleVersion (-1 = unbegrenzt).
 * - Pricing: Override Wert ↔ null wie bei BundleVersion.
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
 * Klassifikation eines BundleVersion-Diffs für SPEC_V2 §7-Vertragsschutz.
 *
 * Quota-Vergleich: `-1` (unbegrenzt) ist immer besser als jede positive
 * Zahl. Sonst gilt höher = besser. Fehlende Keys werden als 0 behandelt.
 *
 * Pricing kann `null` sein (Bundle hat nur Override-Pricing); ein Wechsel
 * von Wert ↔ null wird als REGRESSION (Wert wegfallen) bzw. IMPROVEMENT
 * (Wert hinzukommen, lowerIsBetter inverted) klassifiziert. Beide null
 * bleiben NEUTRAL.
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
// Hilfsfunktionen
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
