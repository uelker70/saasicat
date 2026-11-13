// What the plan catalogue's schema says of a document, asked wherever the
// platform takes one: the text of config/saas.yaml once its references are
// resolved, and the `tenantBilling` sections it reads from a catalogue handed
// over in code. One compiled schema, so a value the file is refused for is
// refused in code too, in the same words.

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { planCatalogSchema } from '@saasicat/spec';

import type { AjvErrorLike } from './plan-catalog-loader.js';

let ajv: Ajv2020 | undefined;
let wholeCatalogue: ValidateFunction | undefined;

/** The whole schema, compiled once; a section is validated as the part of it it is. */
function compiledCatalogue(): { ajv: Ajv2020; validate: ValidateFunction } {
    if (!ajv || !wholeCatalogue) {
        ajv = new Ajv2020({ strict: false, allErrors: true });
        addFormats.default(ajv);
        wholeCatalogue = ajv.compile(planCatalogSchema);
    }
    return { ajv, validate: wholeCatalogue };
}

/** What the schema finds wrong with `document` as a plan catalogue; empty when nothing is. */
export function planCatalogSchemaProblems(document: unknown): AjvErrorLike[] {
    const { validate } = compiledCatalogue();
    return validate(document) ? [] : [...(validate.errors ?? [])];
}

/**
 * What the schema finds wrong with `section` as `tenantBilling.<key>` of a
 * catalogue; empty when nothing is. Each problem is placed where it sits in
 * the whole document, so it reads as the file's would.
 *
 * The section's schema is taken from the compiled whole by its JSON pointer
 * rather than copied, so a reference inside it resolves as it does there.
 */
export function tenantBillingSectionProblems(key: string, section: unknown): AjvErrorLike[] {
    const { ajv: compiler } = compiledCatalogue();
    const id = planCatalogSchema['$id'];
    const validate =
        typeof id === 'string'
            ? compiler.getSchema(`${id}#/properties/tenantBilling/properties/${key}`)
            : undefined;
    if (!validate) {
        throw new Error(
            `plan-catalog.schema.json declares no tenantBilling.${key} — @saasicat/spec and ` +
                '@saasicat/nest are out of step.',
        );
    }
    if (validate(section)) return [];
    return (validate.errors ?? []).map((error) => ({
        ...error,
        instancePath: `/tenantBilling/${key}${error.instancePath ?? ''}`,
    }));
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

/** One problem as a line: where it is in the document, and what is wrong there. */
export function describeCatalogProblem(problem: AjvErrorLike): string {
    return `${locate(problem)}: ${problem.message ?? 'unknown'}`;
}
