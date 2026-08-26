import type { CatalogEntryI18n } from './catalog-entry.types.js';
import type { BundleRow, CreateBundleData, CreateBundleVersionDraftData } from './bundle.types.js';

/**
 * The column values a new BundleVersion draft starts from.
 *
 * Every adapter has to apply the same defaults — an absent quota map is `{}`,
 * an absent price is null rather than zero, an unstated `marketed` is true —
 * and two adapters spelling that out separately is the same decision written
 * twice. It is also the variant jscpd does catch, which is how this came out:
 * `adapter-drizzle` learning about bundles put a second copy beside
 * `adapter-prisma`'s.
 *
 * Validity windows are deliberately absent. Whether a draft carries
 * `validFrom`/`validUntil` is an adapter capability rather than a default, and
 * an adapter that does not maintain those columns must not write them.
 */
export function bundleDraftDefaults(data: CreateBundleVersionDraftData): {
    baseVersionId: string | null;
    features: string[];
    quotas: Record<string, number>;
    compatibility: Record<string, unknown>;
    pricingOverrides: unknown[];
    monthlyNet: string | null;
    yearlyNet: string | null;
    marketed: boolean;
    changeNote: string;
    createdByUserId: string | null;
} {
    return {
        baseVersionId: data.baseVersionId ?? null,
        features: data.features,
        quotas: data.quotas ?? {},
        compatibility: (data.compatibility ?? {}) as Record<string, unknown>,
        pricingOverrides: data.pricingOverrides ?? [],
        monthlyNet: data.monthlyNet ?? null,
        yearlyNet: data.yearlyNet ?? null,
        marketed: data.marketed ?? true,
        changeNote: data.changeNote ?? '',
        createdByUserId: data.createdByUserId ?? null,
    };
}

/**
 * The column values a new Bundle stem starts from.
 *
 * The same defaulting rule as above, one level up: an absent description or
 * icon is null rather than an empty string, an unstated sort order is 0, an
 * absent translation map is `{}`. Written out in five places before this — two
 * adapters and two fakes — which is four opportunities for one of them to
 * decide differently.
 */
export function bundleStemDefaults(data: CreateBundleData): {
    projectKey: string;
    bundleKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    i18n: CatalogEntryI18n;
} {
    return {
        projectKey: data.projectKey,
        bundleKey: data.bundleKey,
        label: data.label,
        description: data.description ?? null,
        icon: data.icon ?? null,
        sortOrder: data.sortOrder ?? 0,
        i18n: data.i18n ?? {},
    };
}

/** The stored shape both adapters read a bundle stem back from. */
export interface StoredBundleStem {
    id: string;
    projectKey: string;
    bundleKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    i18n: unknown;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

/**
 * A stored bundle stem as the port describes it.
 *
 * The two stores spell the columns identically, so the mapping was identical
 * too — and an identical mapping in two files is one place for a field to be
 * forgotten when the row grows. `i18n` arrives as JSON of unknown shape from
 * both, and a non-object becomes `{}` rather than reaching a caller that
 * expects a map.
 */
export function toBundleStemRow(row: StoredBundleStem): BundleRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        bundleKey: row.bundleKey,
        label: row.label,
        description: row.description,
        icon: row.icon,
        sortOrder: row.sortOrder,
        i18n:
            row.i18n !== null && typeof row.i18n === 'object' && !Array.isArray(row.i18n)
                ? (row.i18n as CatalogEntryI18n)
                : {},
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt?.toISOString() ?? null,
    };
}
