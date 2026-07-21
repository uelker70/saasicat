// Strict mode check — drift between the DB catalog and the discovery snapshot.
//
// Pure functions, no NestJS DI, no side effects. Testable in isolation.
// Called by the BundlesService (and later the BusinessTypesService) before
// a mutation is persisted.

import type {
    ApprovedCatalogKeys,
    BundleVersionRow,
    DiscoverySnapshot,
    StrictModeWarning,
    StrictModeWarningCode,
} from '@saasicat/types';

/**
 * Advisory warnings (#35): they inform but never block — not even in
 * `strictModeCheckMode: 'blocking'`, Seed-Gate, or Preflight. Reason: a
 * `requires` feature may be satisfied outside the checked draft
 * (e.g. the Plan covers a Bundle's dependency), which the draft check
 * cannot know without booking context.
 */
export const ADVISORY_STRICT_MODE_CODES: ReadonlySet<StrictModeWarningCode> = new Set([
    'PLAN_FEATURE_DEPENDENCY_UNSATISFIED',
    'BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED',
]);

/** Returns only the warnings that are allowed to gate in blocking paths. */
export function blockingStrictModeWarnings(warnings: StrictModeWarning[]): StrictModeWarning[] {
    return warnings.filter((w) => !ADVISORY_STRICT_MODE_CODES.has(w.code));
}

/**
 * Dependency check (#35): reports `requires` features of a selected
 * feature that are not also part of the selection. Combined drafts
 * (e.g. the SPORTPLATZ bundle) that contain their own dependencies
 * produce no warning.
 */
function dependencyWarnings(
    features: string[],
    snapshot: DiscoverySnapshot,
    code: 'PLAN_FEATURE_DEPENDENCY_UNSATISFIED' | 'BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED',
): StrictModeWarning[] {
    const warnings: StrictModeWarning[] = [];
    const requiresByFeature = new Map(
        snapshot.features.map((f) => [f.featureKey, f.requires ?? []]),
    );
    const selected = new Set(features);
    features.forEach((feature, index) => {
        for (const required of requiresByFeature.get(feature) ?? []) {
            if (selected.has(required)) continue;
            warnings.push({
                code,
                message: `Feature '${feature}' setzt '${required}' voraus, das in dieser Auswahl fehlt. Beim Tenant muss die Abhängigkeit anderweitig gedeckt sein (z. B. durch den Plan) — sonst funktioniert das Feature nicht.`,
                field: `features[${index}]`,
                value: required,
            });
        }
    });
    return warnings;
}

/**
 * Validates a Bundle draft definition against the current discovery snapshot.
 * Returns a (possibly empty) list of warnings.
 *
 * Checked:
 * - **Feature existence** (`BUNDLE_FEATURE_UNKNOWN`): every `features[i]`
 *   must exist as a `DiscoveredFeature` in the snapshot. Code is the
 *   source of truth for features (via @ImplementsCapability). Keys in
 *   `marketedOnlyFeatures` are deliberately exempt — marketed
 *   non-code features (e.g. support SLAs) that never have a Capability.
 * - **Quota existence** (`QUOTA_MISSING`): every `quotas` key must exist
 *   as a `DiscoveredQuota` in the snapshot (provided the app uses quotas
 *   at all — empty quotas are allowed).
 * - **Plan key existence** (`BUNDLE_PLAN_KEY_UNKNOWN`, optional via
 *   `knownPlanKeys`): every `compatibility.planIds[i]` must be an
 *   existing PlanKey in the current Project. Called by the
 *   BundlesService once the plan list is available;
 *   `knownPlanKeys = null` skips the check (e.g. when the PlanRepository
 *   is not registered).
 * - **Approved gate** (`BUNDLE_FEATURE_NOT_APPROVED`/`QUOTA_NOT_APPROVED`,
 *   optional via `approved`, #20 Slice 5): only approved features/quotas
 *   (`discoveryStatus = 'approved'`) are sellable. `approved = null`
 *   skips the approval part; marketed-only features are exempt.
 * - **Feature dependencies** (`BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED`, #35,
 *   advisory): `requires` features that are not in the Bundle itself.
 *
 * **Not** checked (belongs in other validations):
 * - Pricing (purely business, no discovery relation)
 * - Compatibility.businessTypeKeys whitelists (BUNDLE_COMPATIBILITY code,
 *   only checked at BusinessType publish)
 * - Disjointness (BUNDLE_DISJOINTNESS, also a BusinessType concern)
 */
export function validateBundleDraft(
    draft: {
        features: string[];
        quotas: Record<string, number>;
        compatibility?: { planIds?: string[]; businessTypeKeys?: string[] };
    },
    snapshot: DiscoverySnapshot,
    knownPlanKeys: Set<string> | null = null,
    marketedOnlyFeatures: ReadonlySet<string> = new Set(),
    approved: ApprovedCatalogKeys | null = null,
): StrictModeWarning[] {
    const warnings: StrictModeWarning[] = [];

    const knownFeatures = new Set(snapshot.features.map((f) => f.featureKey));
    const knownQuotas = new Set(snapshot.quotas.map((q) => q.quotaKey));

    draft.features.forEach((feature, index) => {
        if (marketedOnlyFeatures.has(feature)) return;
        if (knownFeatures.has(feature)) {
            if (approved && !approved.features.has(feature)) {
                warnings.push({
                    code: 'BUNDLE_FEATURE_NOT_APPROVED',
                    message: `Feature '${feature}' ist nicht freigegeben (Status != approved). Nur freigegebene Features sind verkaufbar — im Discovery-Review freigeben (#20).`,
                    field: `features[${index}]`,
                    value: feature,
                });
            }
            return;
        }
        warnings.push({
            code: 'BUNDLE_FEATURE_UNKNOWN',
            message: `Feature '${feature}' wurde im Discovery-Snapshot nicht gefunden. Entweder fehlt im Code eine @ImplementsCapability(..., { feature: '${feature}' })-Annotation, oder das Feature ist veraltet.`,
            field: `features[${index}]`,
            value: feature,
        });
    });

    for (const quotaKey of Object.keys(draft.quotas ?? {})) {
        if (!knownQuotas.has(quotaKey)) {
            warnings.push({
                code: 'QUOTA_MISSING',
                message: `Quota '${quotaKey}' wurde im Discovery-Snapshot nicht gefunden. Im Code muss eine Klasse mit @DefinesQuota({ key: '${quotaKey}', ... }) annotiert sein.`,
                field: `quotas.${quotaKey}`,
                value: quotaKey,
            });
        } else if (approved && !approved.quotas.has(quotaKey)) {
            warnings.push({
                code: 'QUOTA_NOT_APPROVED',
                message: `Quota '${quotaKey}' ist nicht freigegeben (Status != approved). Nur freigegebene Quotas sind verkaufbar — im Discovery-Review freigeben (#20).`,
                field: `quotas.${quotaKey}`,
                value: quotaKey,
            });
        }
    }

    if (knownPlanKeys !== null) {
        const planIds = draft.compatibility?.planIds ?? [];
        planIds.forEach((planKey, index) => {
            if (knownPlanKeys.has(planKey)) return;
            warnings.push({
                code: 'BUNDLE_PLAN_KEY_UNKNOWN',
                message: `Plan '${planKey}' aus compatibility.planIds existiert im Project nicht. Entweder den planKey korrigieren oder den Plan-Stamm zuerst anlegen.`,
                field: `compatibility.planIds[${index}]`,
                value: planKey,
            });
        });
    }

    warnings.push(
        ...dependencyWarnings(draft.features, snapshot, 'BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED'),
    );

    return warnings;
}

/**
 * Validates a BusinessType draft definition against the discovery snapshot
 * and the referenced BundleVersions. Three violations:
 *
 * - **BUNDLE_DISJOINTNESS** (GESCHAEFTSTYP_SPEC §6.3): two Bundles in
 *   the composition activate the same feature. Hard block at publish.
 * - **BUNDLE_COMPATIBILITY** (GESCHAEFTSTYP_SPEC §6.4): a Bundle has set
 *   a `compatibility.businessTypeKeys` whitelist, but the target
 *   businessTypeKey is not included. Soft warning (no
 *   hard block, but an audit marker on override).
 * - **QUOTA_MISSING**: QuotaOverride keys that do not exist in discovery
 *   (analogous to the Bundle strict check).
 *
 * Bundle existence and published status are checked in the service before
 * this check (NotFoundException on a missing version, no warning).
 */
export function validateBusinessTypeDraft(
    draft: {
        businessTypeKey: string;
        quotaOverrides: Record<string, number>;
    },
    bundles: BundleVersionRow[],
    snapshot: DiscoverySnapshot,
    approved: ApprovedCatalogKeys | null = null,
): StrictModeWarning[] {
    const warnings: StrictModeWarning[] = [];

    // Disjointness check: same feature key in multiple Bundles
    const featureToBundleKeys = new Map<string, string[]>();
    for (const bundle of bundles) {
        for (const feature of bundle.features) {
            const list = featureToBundleKeys.get(feature) ?? [];
            list.push(bundle.bundleKey);
            featureToBundleKeys.set(feature, list);
        }
    }
    for (const [feature, bundleKeys] of featureToBundleKeys) {
        if (bundleKeys.length > 1) {
            warnings.push({
                code: 'BUNDLE_DISJOINTNESS',
                message: `Feature '${feature}' wird von mehreren Bundles aktiviert (${bundleKeys.join(
                    ', ',
                )}). GESCHAEFTSTYP_SPEC §6.3 verlangt Disjointness pro Geschäftstyp — entferne das Feature aus allen Bundles bis auf eines.`,
                field: 'bundles',
                value: feature,
            });
        }
    }

    // Compatibility check: businessTypeKey in each Bundle whitelist (or empty)
    for (const bundle of bundles) {
        const whitelist = bundle.compatibility?.businessTypeKeys;
        if (whitelist && whitelist.length > 0 && !whitelist.includes(draft.businessTypeKey)) {
            warnings.push({
                code: 'BUNDLE_COMPATIBILITY',
                message: `Bundle '${bundle.bundleKey}' hat eine Compatibility-Whitelist [${whitelist.join(
                    ', ',
                )}], in der '${draft.businessTypeKey}' nicht enthalten ist. Override per Audit-Marker möglich, aber riskant.`,
                field: `bundles[${bundle.bundleKey}].compatibility`,
                value: bundle.bundleKey,
            });
        }
    }

    // Quota override check (analogous to Bundle, incl. approved gate #20)
    const knownQuotas = new Set(snapshot.quotas.map((q) => q.quotaKey));
    for (const quotaKey of Object.keys(draft.quotaOverrides ?? {})) {
        if (!knownQuotas.has(quotaKey)) {
            warnings.push({
                code: 'QUOTA_MISSING',
                message: `Quota-Override '${quotaKey}' existiert nicht im Discovery-Snapshot.`,
                field: `quotaOverrides.${quotaKey}`,
                value: quotaKey,
            });
        } else if (approved && !approved.quotas.has(quotaKey)) {
            warnings.push({
                code: 'QUOTA_NOT_APPROVED',
                message: `Quota-Override '${quotaKey}' ist nicht freigegeben (Status != approved). Nur freigegebene Quotas sind verkaufbar — im Discovery-Review freigeben (#20).`,
                field: `quotaOverrides.${quotaKey}`,
                value: quotaKey,
            });
        }
    }

    return warnings;
}

/**
 * Validates a PlanVersion draft definition against the discovery snapshot
 * (SPEC_V2 §8.2 Pack 3a). Returns a (possibly empty) list of
 * warnings.
 *
 * Checked:
 * - **Feature existence** (`PLAN_FEATURE_UNKNOWN`): every `features[i]`
 *   must exist as a `DiscoveredFeature` in the snapshot. Code is the
 *   source of truth for features (via @ImplementsCapability). Keys in
 *   `marketedOnlyFeatures` are deliberately exempt — marketed
 *   non-code features (e.g. support SLAs) that never have a Capability.
 * - **Quota existence** (`QUOTA_MISSING`): every `quotas` key must exist
 *   as a `DiscoveredQuota` (via `@DefinesQuota`) in the snapshot.
 * - **Approved gate** (`PLAN_FEATURE_NOT_APPROVED`/`QUOTA_NOT_APPROVED`,
 *   optional via `approved`, #20 Slice 5): only approved features/quotas
 *   are sellable. `approved = null` skips the approval part.
 * - **Feature dependencies** (`PLAN_FEATURE_DEPENDENCY_UNSATISFIED`, #35,
 *   advisory): `requires` features that are not in the Plan itself —
 *   may be covered at the Tenant by booked Bundles.
 *
 * **Not** checked (belongs in other validations):
 * - Pricing (purely business)
 * - Marketing fields (separately in §8.2 item 6)
 */
export function validatePlanDraft(
    draft: { features: string[]; quotas: Record<string, number> },
    snapshot: DiscoverySnapshot,
    marketedOnlyFeatures: ReadonlySet<string> = new Set(),
    approved: ApprovedCatalogKeys | null = null,
): StrictModeWarning[] {
    const warnings: StrictModeWarning[] = [];

    const knownFeatures = new Set(snapshot.features.map((f) => f.featureKey));
    const knownQuotas = new Set(snapshot.quotas.map((q) => q.quotaKey));

    draft.features.forEach((feature, index) => {
        if (marketedOnlyFeatures.has(feature)) return;
        if (knownFeatures.has(feature)) {
            if (approved && !approved.features.has(feature)) {
                warnings.push({
                    code: 'PLAN_FEATURE_NOT_APPROVED',
                    message: `Feature '${feature}' ist nicht freigegeben (Status != approved). Nur freigegebene Features sind verkaufbar — im Discovery-Review freigeben (#20).`,
                    field: `features[${index}]`,
                    value: feature,
                });
            }
            return;
        }
        warnings.push({
            code: 'PLAN_FEATURE_UNKNOWN',
            message: `Feature '${feature}' wurde im Discovery-Snapshot nicht gefunden. Entweder fehlt im Code eine @ImplementsCapability(..., { feature: '${feature}' })-Annotation, oder das Feature ist veraltet.`,
            field: `features[${index}]`,
            value: feature,
        });
    });

    for (const quotaKey of Object.keys(draft.quotas ?? {})) {
        if (!knownQuotas.has(quotaKey)) {
            warnings.push({
                code: 'QUOTA_MISSING',
                message: `Quota '${quotaKey}' wurde im Discovery-Snapshot nicht gefunden. Im Code muss eine Klasse mit @DefinesQuota({ key: '${quotaKey}', ... }) annotiert sein.`,
                field: `quotas.${quotaKey}`,
                value: quotaKey,
            });
        } else if (approved && !approved.quotas.has(quotaKey)) {
            warnings.push({
                code: 'QUOTA_NOT_APPROVED',
                message: `Quota '${quotaKey}' ist nicht freigegeben (Status != approved). Nur freigegebene Quotas sind verkaufbar — im Discovery-Review freigeben (#20).`,
                field: `quotas.${quotaKey}`,
                value: quotaKey,
            });
        }
    }

    warnings.push(
        ...dependencyWarnings(draft.features, snapshot, 'PLAN_FEATURE_DEPENDENCY_UNSATISFIED'),
    );

    return warnings;
}
