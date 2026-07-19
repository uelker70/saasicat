// Strict-Mode-Check — Drift zwischen DB-Catalog und Discovery-Snapshot.
//
// Pure Functions, keine NestJS-DI, keine Side-Effects. Testbar in Isolation.
// Wird vom BundlesService (und später BusinessTypesService) aufgerufen, bevor
// eine Mutation persistiert wird.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §8

import type {
    ApprovedCatalogKeys,
    BundleVersionRow,
    DiscoverySnapshot,
    StrictModeWarning,
    StrictModeWarningCode,
} from '@saasicat/types';

/**
 * Advisory-Warnings (#35): informieren, blocken aber nie — auch nicht in
 * `strictModeCheckMode: 'blocking'`, Seed-Gate oder Preflight. Grund: ein
 * `requires`-Feature kann außerhalb des geprüften Drafts erfüllt sein
 * (z. B. deckt der Plan die Abhängigkeit eines Bundles), was der
 * Draft-Check ohne Buchungskontext nicht wissen kann.
 */
export const ADVISORY_STRICT_MODE_CODES: ReadonlySet<StrictModeWarningCode> = new Set([
    'PLAN_FEATURE_DEPENDENCY_UNSATISFIED',
    'BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED',
]);

/** Liefert nur die Warnings, die in blocking-Pfaden gaten dürfen. */
export function blockingStrictModeWarnings(warnings: StrictModeWarning[]): StrictModeWarning[] {
    return warnings.filter((w) => !ADVISORY_STRICT_MODE_CODES.has(w.code));
}

/**
 * Dependency-Check (#35): meldet `requires`-Features eines ausgewählten
 * Features, die nicht ebenfalls in der Auswahl liegen. Kombi-Drafts
 * (z. B. SPORTPLATZ-Bundle), die ihre Abhängigkeiten selbst enthalten,
 * erzeugen keine Warnung.
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
 * Prüft eine Bundle-Draft-Definition gegen den aktuellen DiscoverySnapshot.
 * Liefert eine (möglicherweise leere) Liste an Warnings.
 *
 * Geprüft wird:
 * - **Feature-Existenz** (`BUNDLE_FEATURE_UNKNOWN`): Jede `features[i]`
 *   muss als `DiscoveredFeature` im Snapshot existieren. Code ist die
 *   Source-of-Truth für Features (via @ImplementsCapability). Keys in
 *   `marketedOnlyFeatures` sind bewusst ausgenommen — vermarktete
 *   Nicht-Code-Features (z. B. Support-SLAs), die nie eine Capability haben.
 * - **Quota-Existenz** (`QUOTA_MISSING`): Jeder `quotas`-Key muss als
 *   `DiscoveredQuota` im Snapshot existieren (sofern die App Quotas
 *   überhaupt nutzt — leere Quotas sind erlaubt).
 * - **Plan-Key-Existenz** (`BUNDLE_PLAN_KEY_UNKNOWN`, optional via
 *   `knownPlanKeys`): Jeder `compatibility.planIds[i]` muss ein
 *   existierender PlanKey im aktuellen Project sein. Wird vom
 *   BundlesService aufgerufen, sobald die Plan-Liste verfügbar ist;
 *   `knownPlanKeys = null` skipt den Check (z. B. wenn das PlanRepository
 *   nicht registriert ist).
 * - **Approved-Gate** (`BUNDLE_FEATURE_NOT_APPROVED`/`QUOTA_NOT_APPROVED`,
 *   optional via `approved`, #20 Slice 5): nur freigegebene Features/Quotas
 *   (`discoveryStatus = 'approved'`) sind verkaufbar. `approved = null`
 *   skipt den Approval-Teil; marketed-only-Features sind ausgenommen.
 * - **Feature-Dependencies** (`BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED`, #35,
 *   advisory): `requires`-Features, die nicht im Bundle selbst liegen.
 *
 * **Nicht** geprüft (gehört in andere Validierungen):
 * - Pricing (rein fachlich, kein Discovery-Bezug)
 * - Compatibility.businessTypeKeys-Whitelists (BUNDLE_COMPATIBILITY-Code,
 *   geprüft erst beim BusinessType-Publish)
 * - Disjointness (BUNDLE_DISJOINTNESS, ebenfalls BusinessType-Sache)
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
 * Prüft eine BusinessType-Draft-Definition gegen den DiscoverySnapshot
 * und die referenzierten BundleVersions. Drei Verstöße:
 *
 * - **BUNDLE_DISJOINTNESS** (GESCHAEFTSTYP_SPEC §6.3): Zwei Bundles in
 *   der Komposition aktivieren dasselbe Feature. Hard-Block beim Publish.
 * - **BUNDLE_COMPATIBILITY** (GESCHAEFTSTYP_SPEC §6.4): Ein Bundle hat
 *   eine `compatibility.businessTypeKeys`-Whitelist gesetzt, aber der
 *   Ziel-businessTypeKey ist nicht enthalten. Soft-Warning (kein
 *   Hard-Block, aber Audit-Marker beim Override).
 * - **QUOTA_MISSING**: QuotaOverride-Keys, die nicht im Discovery
 *   existieren (analog Bundle-Strict-Check).
 *
 * Bundle-Existenz und Published-Status werden im Service vor diesem
 * Check geprüft (NotFoundException bei fehlender Version, kein Warning).
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

    // Disjointness-Check: gleicher Feature-Key in mehreren Bundles
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

    // Compatibility-Check: businessTypeKey in jedem Bundle-Whitelist (oder leer)
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

    // Quota-Override-Check (analog Bundle, inkl. Approved-Gate #20)
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
 * Prüft eine PlanVersion-Draft-Definition gegen den DiscoverySnapshot
 * (SPEC_V2 §8.2 Pack 3a). Liefert eine (möglicherweise leere) Liste an
 * Warnings.
 *
 * Geprüft wird:
 * - **Feature-Existenz** (`PLAN_FEATURE_UNKNOWN`): Jede `features[i]`
 *   muss als `DiscoveredFeature` im Snapshot existieren. Code ist die
 *   Source-of-Truth für Features (via @ImplementsCapability). Keys in
 *   `marketedOnlyFeatures` sind bewusst ausgenommen — vermarktete
 *   Nicht-Code-Features (z. B. Support-SLAs), die nie eine Capability haben.
 * - **Quota-Existenz** (`QUOTA_MISSING`): Jeder `quotas`-Key muss als
 *   `DiscoveredQuota` (via `@DefinesQuota`) im Snapshot existieren.
 * - **Approved-Gate** (`PLAN_FEATURE_NOT_APPROVED`/`QUOTA_NOT_APPROVED`,
 *   optional via `approved`, #20 Slice 5): nur freigegebene Features/Quotas
 *   sind verkaufbar. `approved = null` skipt den Approval-Teil.
 * - **Feature-Dependencies** (`PLAN_FEATURE_DEPENDENCY_UNSATISFIED`, #35,
 *   advisory): `requires`-Features, die nicht im Plan selbst liegen —
 *   können beim Tenant durch gebuchte Bundles gedeckt sein.
 *
 * **Nicht** geprüft (gehört in andere Validierungen):
 * - Pricing (rein fachlich)
 * - Marketing-Felder (separat in §8.2 Punkt 6)
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
