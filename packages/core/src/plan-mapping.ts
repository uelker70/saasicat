// Canonical row -> record mapping for plans and plan versions. Pure, and shared
// by every adapter.
//
// The same reasoning as `subscription-contract-mapping.ts`: both adapters read
// the same canonical tables, so which column becomes which field — and what an
// absent one means — is one decision rather than one per adapter.
//
// The row inputs are structural. A Prisma row carries `Decimal` where a Drizzle
// row carries a numeric string; both reach `String()`, which is what each
// adapter did on its own.

import type { FeatureKey, QuotaKey } from './plan-catalog.types.js';
import type { PlanRow } from './plan-stem.types.js';
import type { PlanVersionRow } from './plan-version-row.types.js';
import type { VersionChange } from './subscription.types.js';

/** What the adapter's schema can actually answer about a version's dates. */
export interface PlanVersionMappingFields {
    /** `validFrom`/`validUntil` are maintained; otherwise both read as null. */
    validityWindows: boolean;
    /** `endsAt` exists; otherwise the field is left off the record entirely. */
    endsAt: boolean;
}

/** A `plans` row as either adapter reads it back. */
export interface CanonicalPlanRow {
    id: string;
    projectKey: string;
    planKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

/** A `plan_versions` row as either adapter reads it back. */
export interface CanonicalPlanVersionRow {
    id: string;
    version: number;
    baseVersionId: string | null;
    features: unknown;
    quotas: unknown;
    monthlyNet: unknown;
    yearlyNet: unknown;
    marketed: boolean;
    publishedAt: Date | null;
    supersededAt: Date | null;
    publishedChanges: unknown;
    changeNote: string;
    nonRegressive: boolean;
    validFrom?: Date | null;
    validUntil?: Date | null;
    endsAt?: Date | null;
    createdByUserId: string | null;
    publishedByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export function toPlanRow(row: CanonicalPlanRow): PlanRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        planKey: row.planKey,
        label: row.label,
        description: row.description,
        icon: row.icon,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: toIsoOrNull(row.deletedAt),
    };
}

/**
 * `planKey` is passed rather than read off the row: the canonical schema stores
 * the plan key in `planId`, but an adapter translating a consumer schema with a
 * real foreign key has to resolve it first, and only the adapter knows which
 * shape it is looking at.
 */
export function toPlanVersionRow(
    row: CanonicalPlanVersionRow,
    planKey: string,
    fields: PlanVersionMappingFields,
): PlanVersionRow {
    const mapped: PlanVersionRow = {
        id: row.id,
        version: row.version,
        baseVersionId: row.baseVersionId,
        planId: planKey,
        features: toFeatureKeys(row.features),
        quotas: toQuotaEffects(row.quotas),
        monthlyNet: String(row.monthlyNet),
        yearlyNet: String(row.yearlyNet),
        marketed: row.marketed,
        publishedAt: toIsoOrNull(row.publishedAt),
        supersededAt: toIsoOrNull(row.supersededAt),
        publishedChanges: Array.isArray(row.publishedChanges)
            ? (row.publishedChanges as VersionChange[])
            : null,
        changeNote: row.changeNote,
        nonRegressive: row.nonRegressive,
        validFrom: fields.validityWindows ? toIsoOrNull(row.validFrom) : null,
        validUntil: fields.validityWindows ? toIsoOrNull(row.validUntil) : null,
        createdByUserId: row.createdByUserId,
        publishedByUserId: row.publishedByUserId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
    // Absent rather than null when the schema has no column: a reader
    // distinguishing "not terminated" from "cannot say" needs the difference.
    if (fields.endsAt) {
        mapped.endsAt = toIsoOrNull(row.endsAt);
    }
    return mapped;
}

function toIsoOrNull(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function toFeatureKeys(value: unknown): FeatureKey[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is FeatureKey => typeof entry === 'string');
}

function toQuotaEffects(value: unknown): Record<QuotaKey, number> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return {} as Record<QuotaKey, number>;
    }
    const quotas: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entry === 'number') quotas[key] = entry;
    }
    return quotas as Record<QuotaKey, number>;
}
