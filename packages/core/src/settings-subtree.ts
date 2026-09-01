// The settings subtree of a plan catalogue, and how two of them are compared.
//
// Pure, and framework-free: the recorder in `@saasicat/nest` fingerprints what
// this selects, and the admin UI shows what `diffSettings` finds.

import type { AppliedSettingsValues, SettingsDifference } from './applied-settings.types.js';
import type { PlanCatalog } from './plan-catalog.types.js';

/**
 * The top-level blocks of `config/saas.yaml` that are the catalogue rather than
 * the configuration, and the format marker.
 *
 * An exclusion list rather than a list of settings, on purpose: a block the
 * schema gains tomorrow is a setting until somebody says otherwise, so it is
 * fingerprinted by default. The failure mode of the other list — a new setting
 * silently left out of the fingerprint, so a change to it is never noticed — is
 * the one this record exists to prevent. `schemaVersion` is excluded because a
 * format change is a migration of the file, not a decision an operator took.
 *
 * `tests/the-settings-subtree-follows-the-schema.test.js` holds this list to
 * the schema: every name here has to be a property the schema declares.
 */
export const CATALOGUE_KEYS: ReadonlySet<keyof PlanCatalog> = new Set<keyof PlanCatalog>([
    'schemaVersion',
    'features',
    'plans',
]);

/** Everything in the catalogue that is configuration, as it was resolved. */
export function settingsSubtreeOf(catalog: PlanCatalog): AppliedSettingsValues {
    const settings: AppliedSettingsValues = {};
    for (const [key, value] of Object.entries(catalog)) {
        if (CATALOGUE_KEYS.has(key as keyof PlanCatalog)) continue;
        if (value === undefined) continue;
        settings[key] = value;
    }
    return settings;
}

/**
 * `JSON.stringify` with object keys in sorted order at every depth, so that two
 * documents saying the same thing in a different order serialise identically.
 * Array order is kept: a list is what its author wrote, in the order they wrote
 * it.
 */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, member: unknown) => {
        if (member && typeof member === 'object' && !Array.isArray(member)) {
            const sorted: Record<string, unknown> = {};
            for (const name of Object.keys(member).sort()) {
                sorted[name] = (member as Record<string, unknown>)[name];
            }
            return sorted;
        }
        return member;
    });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Every leaf that differs between `before` and `after`, in the order the paths
 * sort. A list counts as one leaf: `asTarget: [] → [ENTERPRISE]` is one thing
 * that changed, not a change per element.
 */
export function diffSettings(
    before: AppliedSettingsValues,
    after: AppliedSettingsValues,
): SettingsDifference[] {
    const differences: SettingsDifference[] = [];
    collectDifferences(before, after, [], differences);
    return differences.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** An object, or the absence of one — the two shapes a block can have on a side. */
function isObjectOrAbsent(value: unknown): value is Record<string, unknown> | undefined {
    return value === undefined || isPlainObject(value);
}

function collectDifferences(
    before: unknown,
    after: unknown,
    path: string[],
    out: SettingsDifference[],
): void {
    // Descend while at least one side is a block: a block that appeared or
    // vanished is then reported leaf by leaf, as the leaves an operator reads
    // in the file, rather than as one opaque object.
    if (isObjectOrAbsent(before) && isObjectOrAbsent(after) && (before || after)) {
        const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
        for (const name of names) {
            collectDifferences(before?.[name], after?.[name], [...path, name], out);
        }
        return;
    }
    if (canonicalJson(before) === canonicalJson(after)) return;
    out.push({ path: path.join('.'), before, after });
}
