// How the settings page shows a settings subtree: one row per leaf.
//
// Framework-free, and separate from the page because the two questions it
// answers — where a leaf sits, and how a value reads — are pure, and a table of
// them is what an operator scans for the one line they came to check.

/** One leaf of the running settings, at the path the file spells it. */
export interface SettingsLeaf {
    /** Dotted path, as the loader names a field: `tenantBilling.cancellationNoticeDays.monthly`. */
    path: string;
    value: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Every leaf of `settings`, depth first, in the order the file wrote them.
 *
 * A list is a leaf: `asTarget: [ENTERPRISE]` is one setting an operator wrote,
 * not one row per plan.
 */
export function flattenSettings(settings: Record<string, unknown>): SettingsLeaf[] {
    const leaves: SettingsLeaf[] = [];
    const walk = (value: unknown, path: string[]): void => {
        if (isPlainObject(value)) {
            for (const [key, member] of Object.entries(value)) walk(member, [...path, key]);
            return;
        }
        leaves.push({ path: path.join('.'), value });
    };
    walk(settings, []);
    return leaves;
}

/**
 * A value as a table cell reads it: JSON for anything but a string, so `0`,
 * `[]` and `"0"` stay distinguishable — an empty list is a decision the file
 * spelled out — and `absent` where the leaf does not exist on that side.
 */
export function showSettingValue(value: unknown, absent: string): string {
    if (value === undefined) return absent;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}
