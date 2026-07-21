import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { planCatalogSchema } from '@saasicat/spec';
import type { PlanCatalog } from '@saasicat/types';

// Plan catalog loader — pure function.
//
// Loads a YAML file, parses it as a JSON-compatible object, validates
// it against `@saasicat/spec/schemas/plan-catalog.schema.json`,
// returns a typed `PlanCatalog` object.

/**
 * Schema validation error bundling all Ajv errors — one call returns
 * the full list, no round-trip editing needed.
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
     * Absolute path or relative path (resolved against CWD).
     */
    path: string;
    /**
     * Optional: additional cross-field validations that the JSON schema
     * cannot cover. Default: enable all (see validateConsistency).
     */
    crossFieldChecks?: boolean;
}

/**
 * Loads + validates a saas.yaml file.
 *
 * Throws `PlanCatalogValidationError` on schema violations or
 * cross-field violations. Throws `Error` on IO/YAML parse errors.
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
 * Variant for tests / in-memory loading: takes YAML content as a string,
 * `source` is only for error logging.
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
 * Cross-field validations that JSON schema cannot express:
 *
 *   - Every feature key in a plan must be declared in `features[].key`.
 *   - Plan IDs are unique.
 *
 * Quota keys are deliberately NOT checked here — the source of truth is
 * the code (`@DefinesQuota`); the reconciliation runs at runtime via the
 * discovery snapshot (strict mode check, SPEC_V2 §8).
 *
 * **`plannedOnly: true` is NOT a block** for plan references. The flag
 * marks "listed in the catalog, not (yet) implemented in code" — plans
 * may carry the feature as a roadmap marker. Activation protection lives in
 * `getActiveFeatureKeys` (filter from entitlements). SPEC_V2 §8.2.
 *
 * The loader collects all violations and throws them bundled — so an
 * editor sees all errors at once and does not need twelve round-trips.
 */
function validateConsistency(catalog: PlanCatalog, source: string): void {
    const errors: string[] = [];

    const declaredFeatureKeys = new Set((catalog.features ?? []).map((f) => f.key));

    // Plan IDs unique?
    const planIds = new Set<string>();
    for (const plan of catalog.plans ?? []) {
        if (planIds.has(plan.id)) {
            errors.push(`plans[].id: Doppelte Plan-ID "${plan.id}"`);
        }
        planIds.add(plan.id);

        // Plan features reference declared features?
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
