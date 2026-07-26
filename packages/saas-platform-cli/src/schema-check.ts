// schema-check — pure-function helpers for `saasicat schema check`.
//
// Compares a consumer's `schema.prisma` against the canonical prisma-fragments
// and reports what the consumer is MISSING. Fields the consumer added on top of
// a platform model are never reported: extending platform models is supported
// (autohauspro carries `Subscription.customVehicles`, vereinsfux adds relations
// into its own models), so a drift check must tolerate it.
//
// The check deliberately separates two situations that look alike but mean
// opposite things:
//
//   - A model/enum the consumer does not have at all — they did not adopt that
//     fragment. That is a decision, not drift. Reported as information.
//   - A field/enum value missing from a model the consumer DOES have — the
//     consumer adopted the fragment and fell behind. That breaks platform code
//     at runtime, so it fails the check.

import { blockBodyLines, extractBlocks } from './prisma-blocks.js';

export interface FieldSignature {
    name: string;
    /** Type without `?`/`[]` modifiers, e.g. `String`, `BillingCycle`. */
    type: string;
    optional: boolean;
    list: boolean;
}

export interface ParsedSchema {
    models: Map<string, Map<string, FieldSignature>>;
    enums: Map<string, string[]>;
}

export interface MissingField {
    model: string;
    field: string;
    /** Rendered spec type incl. modifiers, e.g. `DateTime?`. */
    type: string;
}

export interface MissingEnumValue {
    enum: string;
    value: string;
}

export type FieldMismatchReason = 'type' | 'optionality' | 'list';

export interface FieldMismatch {
    model: string;
    field: string;
    reason: FieldMismatchReason;
    expected: string;
    actual: string;
}

export interface SchemaCheckReport {
    /** Platform models the consumer does not carry — informational. */
    absentModels: string[];
    /** Platform enums the consumer does not carry — informational. */
    absentEnums: string[];
    missingFields: MissingField[];
    missingEnumValues: MissingEnumValue[];
    fieldMismatches: FieldMismatch[];
    /** Models present in both schemas, i.e. actually compared. */
    checkedModelCount: number;
    /** Enums present in both schemas, i.e. actually compared. */
    checkedEnumCount: number;
    /** True when nothing that breaks platform code was found. */
    ok: boolean;
}

function renderType(signature: FieldSignature): string {
    return `${signature.type}${signature.list ? '[]' : ''}${signature.optional ? '?' : ''}`;
}

/** Parses the field lines of a `model` block into signatures, keyed by name. */
export function parseFields(block: string): Map<string, FieldSignature> {
    const fields = new Map<string, FieldSignature>();
    for (const line of blockBodyLines(block)) {
        const [name, rawType] = line.split(/\s+/);
        if (!rawType || name.startsWith('@')) continue;
        const list = rawType.includes('[]');
        const optional = rawType.endsWith('?');
        fields.set(name, {
            name,
            type: rawType.replace('[]', '').replace('?', ''),
            optional,
            list,
        });
    }
    return fields;
}

/**
 * Parses the members of an `enum` block. Values may share a line
 * (`enum Role { ADMIN USER }`); a trailing `@map(…)` attribute is not a value.
 */
export function parseEnumValues(block: string): string[] {
    const values: string[] = [];
    for (const line of blockBodyLines(block)) {
        for (const token of line.split(/\s+/)) {
            if (token.startsWith('@')) break;
            if (token.length > 0) values.push(token);
        }
    }
    return values;
}

/** Parses every `model` and `enum` declaration of a Prisma schema. */
export function parseSchema(schema: string): ParsedSchema {
    const models = new Map<string, Map<string, FieldSignature>>();
    for (const [name, block] of extractBlocks(schema, 'model')) {
        models.set(name, parseFields(block));
    }
    const enums = new Map<string, string[]>();
    for (const [name, block] of extractBlocks(schema, 'enum')) {
        enums.set(name, parseEnumValues(block));
    }
    return { models, enums };
}

/**
 * A consumer may replace a spec `String` with a locally declared enum — the
 * fragments document this explicitly ("Whoever prefers Postgres enums can
 * declare an enum locally"). Every other type difference is a real mismatch.
 */
function isDocumentedTypeSubstitution(
    spec: FieldSignature,
    app: FieldSignature,
    appEnums: Map<string, string[]>,
): boolean {
    return spec.type === 'String' && appEnums.has(app.type);
}

function compareFields(
    model: string,
    specFields: Map<string, FieldSignature>,
    appFields: Map<string, FieldSignature>,
    appEnums: Map<string, string[]>,
    missingFields: MissingField[],
    fieldMismatches: FieldMismatch[],
): void {
    for (const [name, spec] of specFields) {
        const app = appFields.get(name);
        if (!app) {
            missingFields.push({ model, field: name, type: renderType(spec) });
            continue;
        }
        const mismatch = (reason: FieldMismatchReason): FieldMismatch => ({
            model,
            field: name,
            reason,
            expected: renderType(spec),
            actual: renderType(app),
        });
        if (spec.type !== app.type && !isDocumentedTypeSubstitution(spec, app, appEnums)) {
            fieldMismatches.push(mismatch('type'));
        } else if (spec.list !== app.list) {
            fieldMismatches.push(mismatch('list'));
        } else if (!spec.optional && app.optional) {
            // Only this direction breaks: platform code reads the column with
            // the spec's non-null type, so a NULL row reaches it as `null` and
            // fails on first use. The reverse — the consumer being stricter
            // than the spec — is a deliberate tightening, and if the platform
            // ever writes NULL there the insert fails loudly instead.
            fieldMismatches.push(mismatch('optionality'));
        }
    }
}

/**
 * Compares a consumer schema against the canonical fragments. `specSchema` is
 * the concatenation of the fragments the check should cover.
 */
export function checkSchema(specSchema: string, appSchema: string): SchemaCheckReport {
    const spec = parseSchema(specSchema);
    const app = parseSchema(appSchema);

    const absentModels: string[] = [];
    const missingFields: MissingField[] = [];
    const fieldMismatches: FieldMismatch[] = [];

    for (const [model, specFields] of spec.models) {
        const appFields = app.models.get(model);
        if (!appFields) {
            absentModels.push(model);
            continue;
        }
        compareFields(model, specFields, appFields, app.enums, missingFields, fieldMismatches);
    }

    const absentEnums: string[] = [];
    const missingEnumValues: MissingEnumValue[] = [];

    for (const [name, specValues] of spec.enums) {
        const appValues = app.enums.get(name);
        if (!appValues) {
            absentEnums.push(name);
            continue;
        }
        for (const value of specValues) {
            if (!appValues.includes(value)) {
                missingEnumValues.push({ enum: name, value });
            }
        }
    }

    return {
        absentModels,
        absentEnums,
        missingFields,
        missingEnumValues,
        fieldMismatches,
        checkedModelCount: spec.models.size - absentModels.length,
        checkedEnumCount: spec.enums.size - absentEnums.length,
        ok:
            missingFields.length === 0 &&
            missingEnumValues.length === 0 &&
            fieldMismatches.length === 0,
    };
}
