// schema-check — pure-function helpers for `saasicat schema check`.
//
// Compares a consumer's `schema.prisma` against the canonical prisma-fragments
// and reports what the consumer is MISSING. Fields the consumer added on top of
// a platform model are never reported: consumers may add fields and relations,
// so a drift check must tolerate supported schema extensions.
//
// The check deliberately separates two situations that look alike but mean
// opposite things:
//
//   - A model/enum the consumer does not have at all — they did not adopt that
//     fragment. That is a decision, not drift. Reported as information.
//   - A field/enum value missing from a model the consumer DOES have — the
//     consumer adopted the fragment and fell behind. That breaks platform code
//     at runtime, so it fails the check.

import { blockBodyLines, extractBlocks, stripLineComment } from './prisma-blocks.js';

export interface FieldSignature {
    name: string;
    /** Type without `?`/`[]` modifiers, e.g. `String`, `BillingCycle`. */
    type: string;
    optional: boolean;
    list: boolean;
}

export interface BlockAttributes {
    /** Field lists of `@@index`, normalised to `[a,b]` — attribute options dropped. */
    indexes: Set<string>;
    /** Same for `@@unique`. */
    uniques: Set<string>;
    /** `@@map` target, or the model name when unmapped. */
    map: string;
}

export interface ParsedSchema {
    models: Map<string, Map<string, FieldSignature>>;
    modelAttributes: Map<string, BlockAttributes>;
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

export type BlockAttributeKind = 'index' | 'unique' | 'map';

export interface MissingBlockAttribute {
    model: string;
    kind: BlockAttributeKind;
    /** Rendered attribute, e.g. `@@index([planId, validFrom])`. */
    expected: string;
    /** For `map`: what the consumer maps to instead. */
    actual?: string;
}

export interface SchemaCheckReport {
    /** Platform models the consumer does not carry — informational. */
    absentModels: string[];
    /** Platform enums the consumer does not carry — informational. */
    absentEnums: string[];
    missingFields: MissingField[];
    missingEnumValues: MissingEnumValue[];
    fieldMismatches: FieldMismatch[];
    /**
     * Block-level attributes the spec declares and the consumer lacks:
     * `@@index`, `@@unique`, and a diverging `@@map`.
     */
    missingBlockAttributes: MissingBlockAttribute[];
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

/**
 * Captures the `[…]` field list of `@@index`/`@@unique`, ignoring anything
 * after it. Matching up to `]` rather than to the closing paren is what makes
 * indexed field arguments work: in `@@index([title(sort: Desc)])` the first
 * `)` belongs to the argument, not to the attribute.
 */
function attributeFieldLists(block: string, attribute: string): Set<string> {
    // `attribute` is a literal this file passes (`unique`, `index`), not schema text.
    // eslint-disable-next-line no-restricted-syntax
    const pattern = new RegExp(`@@${attribute}\\(\\s*(\\[[^\\]]*\\])`, 'g');
    return new Set([...block.matchAll(pattern)].map((match) => match[1].replace(/\s+/g, '')));
}

/**
 * Parses the block-level attributes of a `model`. Comparing these is what
 * catches a missing index or unique constraint — differences the field-level
 * comparison is blind to.
 *
 * The block is reduced to its structural content first. A consumer who
 * comments out `// @@unique([tenantId])` has removed the constraint, and
 * reading the raw text would count it as present — passing the very check that
 * exists to catch its absence.
 */
export function parseBlockAttributes(name: string, block: string): BlockAttributes {
    // Comments removed, string contents kept — `@@map("subscriptions")` needs
    // its argument to survive.
    const active = block.split('\n').map(stripLineComment).join('\n');
    return {
        indexes: attributeFieldLists(active, 'index'),
        uniques: attributeFieldLists(active, 'unique'),
        map: active.match(/@@map\("([^"]+)"\)/)?.[1] ?? name,
    };
}

/** Parses every `model` and `enum` declaration of a Prisma schema. */
export function parseSchema(schema: string): ParsedSchema {
    const models = new Map<string, Map<string, FieldSignature>>();
    const modelAttributes = new Map<string, BlockAttributes>();
    for (const [name, block] of extractBlocks(schema, 'model')) {
        models.set(name, parseFields(block));
        modelAttributes.set(name, parseBlockAttributes(name, block));
    }
    const enums = new Map<string, string[]>();
    for (const [name, block] of extractBlocks(schema, 'enum')) {
        enums.set(name, parseEnumValues(block));
    }
    return { models, modelAttributes, enums };
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

function compareBlockAttributes(
    model: string,
    spec: BlockAttributes,
    app: BlockAttributes,
    out: MissingBlockAttribute[],
): void {
    if (spec.map !== app.map) {
        out.push({ model, kind: 'map', expected: `@@map("${spec.map}")`, actual: app.map });
    }
    for (const fields of spec.uniques) {
        if (!app.uniques.has(fields)) {
            out.push({ model, kind: 'unique', expected: `@@unique(${fields})` });
        }
    }
    for (const fields of spec.indexes) {
        if (!app.indexes.has(fields)) {
            out.push({ model, kind: 'index', expected: `@@index(${fields})` });
        }
    }
}

/**
 * A missing index costs query time; a missing `@@unique` or a diverging
 * `@@map` breaks correctness — the platform relies on the constraint holding,
 * and on finding the table under its canonical name. Only the latter two fail
 * the check.
 */
export function breaksContract(attribute: MissingBlockAttribute): boolean {
    return attribute.kind !== 'index';
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
    const missingBlockAttributes: MissingBlockAttribute[] = [];

    for (const [model, specFields] of spec.models) {
        const appFields = app.models.get(model);
        if (!appFields) {
            absentModels.push(model);
            continue;
        }
        compareFields(model, specFields, appFields, app.enums, missingFields, fieldMismatches);
        const specAttrs = spec.modelAttributes.get(model);
        const appAttrs = app.modelAttributes.get(model);
        if (specAttrs && appAttrs) {
            compareBlockAttributes(model, specAttrs, appAttrs, missingBlockAttributes);
        }
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
        missingBlockAttributes,
        checkedModelCount: spec.models.size - absentModels.length,
        checkedEnumCount: spec.enums.size - absentEnums.length,
        ok:
            missingFields.length === 0 &&
            missingEnumValues.length === 0 &&
            fieldMismatches.length === 0 &&
            !missingBlockAttributes.some(breaksContract),
    };
}
