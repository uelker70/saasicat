import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { planCatalogSchema } from '@saasicat/spec';
import type { PlanCatalog } from '@saasicat/core';

import {
    EnvironmentResolutionFailure,
    type EnvironmentVariables,
    resolveEnvironmentReferences,
    type SchemaNode,
} from './plan-catalog-environment.js';

// Plan catalog loader — pure function.
//
// Loads a YAML file, parses it as a JSON-compatible object, resolves the
// `${NAME}` references in it against the environment, validates the result
// against `@saasicat/spec/schemas/plan-catalog.schema.json`, and returns a typed
// `PlanCatalog` object. The order matters: references are resolved BEFORE the
// schema check, so a variable standing in for `monthly` is held to
// `integer, minimum: 0` like a number typed into the file would be.

/**
 * Schema validation error bundling all Ajv errors — one call returns
 * the full list, no round-trip editing needed.
 */
export interface AjvErrorLike {
    instancePath?: string;
    message?: string;
    schemaPath?: string;
    /** `envVar` names the variable behind a reference that could not be resolved. */
    params?: { missingProperty?: string; additionalProperty?: string; envVar?: string };
}

/**
 * Where in the document the violation is, as the editor of the document sees it.
 *
 * Ajv answers a missing property by pointing at its *parent* and naming the
 * child in `params`, so `/: must have required property 'tenantBilling'` is
 * what an integrator gets for a field two levels down. Joining the two gives
 * `tenantBilling.cancellationNoticeDays` — the thing to go and type.
 *
 * This is not decoration. Making `tenantBilling` required breaks every existing
 * config/saas.yaml on upgrade, so this message is the first thing every
 * integrator meets.
 *
 * A member the schema does not know is reported the same way: Ajv points at the
 * parent and names the offender in `params`, and `must NOT have additional
 * properties` without the name sends the editor hunting through the block.
 */
function locate(error: AjvErrorLike): string {
    const segments = (error.instancePath ?? '').split('/').filter(Boolean);
    const named = error.params?.missingProperty ?? error.params?.additionalProperty;
    if (named) segments.push(named);
    return segments.length > 0 ? segments.join('.') : '(document root)';
}

/**
 * `Error.name` for a document that could not be read as a catalog at all.
 *
 * A name rather than a class because the other failure of this kind comes from
 * the YAML parser and is not ours to subclass — one predicate has to cover
 * both, and a name is what both can carry.
 */
export const PLAN_CATALOG_UNREADABLE_ERROR = 'PlanCatalogUnreadableError';

export class PlanCatalogValidationError extends Error {
    constructor(
        public readonly source: string,
        public readonly errors: AjvErrorLike[],
    ) {
        const messages = errors.map((e) => `${locate(e)}: ${e.message ?? 'unknown'}`).join('\n  ');
        super(`Plan catalog validation failed for ${source}:\n  ${messages}`);
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
    /**
     * The variables a `${NAME}` in the file may resolve against. Left out,
     * `process.env`; a record of their own for tests; `null` to refuse every
     * reference, the way the string variant does without one.
     */
    env?: EnvironmentVariables;
}

export interface LoadPlanCatalogFromStringOptions {
    /** Names the document in error messages — a path, or where the text came from. */
    source: string;
    crossFieldChecks?: boolean;
    /**
     * The variables a `${NAME}` in the document may resolve against.
     *
     * Left out, every reference is refused: a document handed in as text did
     * not come from the installation's own file, and the catalogue import is
     * one such caller. Resolving references for an uploaded body would read
     * the server's environment for whoever can post one.
     */
    env?: EnvironmentVariables;
}

/**
 * Loads + validates a saas.yaml file.
 *
 * Throws `PlanCatalogValidationError` on schema violations, cross-field
 * violations, and references the environment cannot satisfy. Throws `Error`
 * on IO/YAML parse errors.
 */
export function loadPlanCatalogFromFile(opts: LoadPlanCatalogOptions): PlanCatalog {
    const absolutePath = resolvePath(opts.path);
    const raw = readFileSync(absolutePath, 'utf-8');
    const catalog = loadPlanCatalogFromString(raw, {
        source: absolutePath,
        crossFieldChecks: opts.crossFieldChecks ?? true,
        // `??` would turn an explicit `null` — refuse every reference — into
        // the process environment, the one thing that value asks not to read.
        env: opts.env === undefined ? process.env : opts.env,
    });
    SOURCES.set(catalog, absolutePath);
    return catalog;
}

/**
 * Where each loaded catalogue came from, kept beside the object rather than in
 * it: the schema closes the document (`additionalProperties: false`), so a
 * `source` member would fail the very validation that just passed, and a
 * consumer's `deepEqual` against the file's content would see a field the file
 * does not have.
 */
const SOURCES = new WeakMap<PlanCatalog, string>();

/**
 * The absolute path `loadPlanCatalogFromFile` read `catalog` from, or null for
 * a catalogue assembled in code — or copied: a spread of the loaded object is
 * a new object, and this cannot follow it.
 */
export function catalogSource(catalog: PlanCatalog): string | null {
    return SOURCES.get(catalog) ?? null;
}

/**
 * Variant for tests / in-memory loading: takes YAML content as a string,
 * `source` is only for error logging.
 */
export function loadPlanCatalogFromString(
    yamlContent: string,
    opts: LoadPlanCatalogFromStringOptions,
): PlanCatalog {
    const parsed = yaml.load(yamlContent);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        // Named, so a caller can tell "I could not read your document" from
        // "something failed further in". A scalar or a list parses cleanly and
        // is still not a catalog, and without the name that case answered 500.
        const error = new Error(`The YAML content of ${opts.source} is not an object`);
        error.name = PLAN_CATALOG_UNREADABLE_ERROR;
        throw error;
    }

    const resolved = resolveReferences(parsed, opts.source, opts.env ?? null);

    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats.default(ajv);
    const validate = ajv.compile(planCatalogSchema);

    if (!validate(resolved)) {
        throw new PlanCatalogValidationError(opts.source, validate.errors ?? []);
    }

    const catalog = resolved as PlanCatalog;

    if (opts.crossFieldChecks ?? true) {
        validateConsistency(catalog, opts.source);
    }

    return catalog;
}

/**
 * The document with its `${NAME}` references resolved, or a validation error
 * that names every one that could not be — in the same shape as a schema
 * violation, so the reader sees `field: what is wrong` either way.
 */
function resolveReferences(parsed: object, source: string, env: EnvironmentVariables): unknown {
    try {
        return resolveEnvironmentReferences(parsed, planCatalogSchema as SchemaNode, env);
    } catch (error) {
        if (error instanceof EnvironmentResolutionFailure) {
            throw new PlanCatalogValidationError(source, error.problems);
        }
        throw error;
    }
}

/**
 * Cross-field validations that JSON schema cannot express:
 *
 *   - Every feature key in a plan must be declared in `features[].key`.
 *   - Plan IDs are unique.
 *
 * Quota keys are deliberately NOT checked here — the source of truth is
 * the code (`@DefinesQuota`); the reconciliation runs at runtime via the
 * discovery snapshot (strict mode check).
 *
 * **`plannedOnly: true` is NOT a block** for plan references. The flag
 * marks "listed in the catalog, not (yet) implemented in code" — plans
 * may carry the feature as a roadmap marker. Activation protection lives in
 * `getActiveFeatureKeys` (filter from entitlements)..
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
            errors.push(`plans[].id: duplicate plan id "${plan.id}"`);
        }
        planIds.add(plan.id);

        // Plan features reference declared features?
        if (catalog.features) {
            for (const fk of plan.features) {
                if (!declaredFeatureKeys.has(fk)) {
                    errors.push(
                        `plans[id=${plan.id}].features: Unknown featureKey "${fk}" — not declared in catalog.features`,
                    );
                }
            }
        }
    }

    if (errors.length > 0) {
        const err = new Error(
            `Plan catalog consistency error in ${source}:\n  ${errors.join('\n  ')}`,
        );
        err.name = 'PlanCatalogConsistencyError';
        throw err;
    }
}
