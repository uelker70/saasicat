import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { planCatalogSchema } from '@saasicat/spec';
import type { PlanCatalog } from '@saasicat/types';

// Plan-Catalog-Loader — Pure Function.
//
// Lädt eine YAML-Datei, parst sie als JSON-kompatibles Objekt, validiert
// sie gegen `@saasicat/spec/schemas/plan-catalog.schema.json`,
// liefert ein typed `PlanCatalog`-Objekt zurück.
//
// Spec: yada-services/handoff/superadmin/SPEC.md §4.2 + §6
//       autohauspro/handoff/saas/EXTRACTION_PLAN.md §4.1
// Phase: P1.4 (UMSETZUNGSPLAN.md §3.2 Liefergegenstand 1.5)

/**
 * Schema-Validierungsfehler mit allen Ajv-Errors gebündelt — ein Aufruf liefert
 * die volle Liste, kein Round-Trip-Editing nötig.
 */
export interface AjvErrorLike {
    instancePath?: string;
    message?: string;
    schemaPath?: string;
}

export class PlanCatalogValidationError extends Error {
    constructor(
        public readonly source: string,
        public readonly errors: AjvErrorLike[],
    ) {
        const messages = errors
            .map((e) => `${e.instancePath || '/'}: ${e.message ?? 'unbekannt'}`)
            .join('\n  ');
        super(`Plan-Catalog-Validierung fehlgeschlagen für ${source}:\n  ${messages}`);
        this.name = 'PlanCatalogValidationError';
    }
}

export interface LoadPlanCatalogOptions {
    /**
     * Absoluter Pfad oder relativer Pfad (zum CWD aufgelöst).
     */
    path: string;
    /**
     * Optional: zusätzliche cross-field Validierungen, die das JSON-Schema
     * nicht abdecken kann. Default: alle aktivieren (s. validateConsistency).
     */
    crossFieldChecks?: boolean;
}

/**
 * Lädt + validiert eine saas.yaml-Datei.
 *
 * Wirft `PlanCatalogValidationError` bei Schema-Verletzungen oder
 * cross-field-Verletzungen. Wirft `Error` bei IO/YAML-Parse-Fehlern.
 */
export function loadPlanCatalogFromFile(opts: LoadPlanCatalogOptions): PlanCatalog {
    const absolutePath = resolvePath(opts.path);
    const raw = readFileSync(absolutePath, 'utf-8');
    return loadPlanCatalogFromString(raw, {
        source: absolutePath,
        crossFieldChecks: opts.crossFieldChecks ?? true,
    });
}

/**
 * Variante für Tests / In-Memory-Loading: nimmt YAML-Inhalt als String,
 * `source` ist nur fürs Fehler-Logging.
 */
export function loadPlanCatalogFromString(
    yamlContent: string,
    opts: { source: string; crossFieldChecks?: boolean },
): PlanCatalog {
    const parsed = yaml.load(yamlContent);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`YAML-Inhalt von ${opts.source} ist kein Objekt`);
    }

    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats.default(ajv);
    const validate = ajv.compile(planCatalogSchema);

    if (!validate(parsed)) {
        throw new PlanCatalogValidationError(opts.source, validate.errors ?? []);
    }

    const catalog = parsed as PlanCatalog;

    if (opts.crossFieldChecks ?? true) {
        validateConsistency(catalog, opts.source);
    }

    return catalog;
}

/**
 * Cross-field-Validierungen, die JSON-Schema nicht ausdrücken kann:
 *
 *   - Jeder Feature-Key in einem Plan muss in `features[].key` deklariert sein.
 *   - Plan-IDs sind eindeutig.
 *
 * Quota-Keys werden hier bewusst NICHT geprüft — Source-of-Truth dafür ist
 * der Code (`@DefinesQuota`); der Abgleich läuft zur Laufzeit über den
 * Discovery-Snapshot (Strict-Mode-Check, SPEC_V2 §8).
 *
 * **`plannedOnly: true` ist KEIN Block** für Plan-Referenzen. Der Flag
 * markiert "im Catalog gelistet, im Code (noch) nicht implementiert" — Plans
 * dürfen das Feature als Roadmap-Marker führen. Aktivierungs-Schutz liegt in
 * `getActiveFeatureKeys` (Filter aus Entitlements). SPEC_V2 §8.2.
 *
 * Der Loader sammelt alle Verletzungen und wirft sie gebündelt — damit ein
 * Editor alle Fehler auf einmal sieht und nicht zwölf Round-Trips braucht.
 */
function validateConsistency(catalog: PlanCatalog, source: string): void {
    const errors: string[] = [];

    const declaredFeatureKeys = new Set((catalog.features ?? []).map((f) => f.key));

    // Plan-IDs eindeutig?
    const planIds = new Set<string>();
    for (const plan of catalog.plans ?? []) {
        if (planIds.has(plan.id)) {
            errors.push(`plans[].id: Doppelte Plan-ID "${plan.id}"`);
        }
        planIds.add(plan.id);

        // Plan-Features referenzieren erklärte features?
        if (catalog.features) {
            for (const fk of plan.features) {
                if (!declaredFeatureKeys.has(fk)) {
                    errors.push(
                        `plans[id=${plan.id}].features: Unbekannter featureKey "${fk}" — nicht in catalog.features deklariert`,
                    );
                }
            }
        }
    }

    if (errors.length > 0) {
        const err = new Error(
            `Plan-Catalog-Konsistenz-Fehler in ${source}:\n  ${errors.join('\n  ')}`,
        );
        err.name = 'PlanCatalogConsistencyError';
        throw err;
    }
}
