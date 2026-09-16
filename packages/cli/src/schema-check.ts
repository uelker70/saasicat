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
//
// The two meet at a relation field: `Subscriber.paymentMethods` points at
// `SubscriberPaymentMethod`, and Prisma cannot express a relation to a model
// that is not there. Reporting such a field as missing would make the fragment
// it points at compulsory, in the same run that calls that fragment "not
// adopted — not an error", and the only way to satisfy both statements is to
// adopt the optional fragment. So a spec field whose type is a MODEL the
// consumer did not adopt belongs to that decision and is not drift.
//
// Models only, and the reason is the whole of the argument above: it is Prisma
// that cannot be satisfied. An enum field is satisfiable — copy the enum — and
// a model adopted without the enum one of its fields names is a fragment taken
// halfway, which is exactly the drift this check exists for. A fragment left
// out whole puts its model in `absentModels`, where no field of it is compared
// at all, so exempting enums would only ever have covered the partial case.

import { findFkPointers } from './fk-pointers.js';
import {
    blockBodyLines,
    extractBlocks,
    stripLineComment,
    structuralOnly,
} from './prisma-blocks.js';

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

/**
 * A relation that deletes a record the platform keeps past its tenant, together
 * with the tenant.
 */
export interface TenantCascade {
    model: string;
    /** The relation field that cascades, e.g. `tenant`. */
    field: string;
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
    /**
     * Relations that cascade from the tenant onto a model the platform keeps
     * after the tenant is gone, such as a contract.
     */
    tenantCascades: TenantCascade[];
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
    notAdopted: ReadonlySet<string>,
    missingFields: MissingField[],
    fieldMismatches: FieldMismatch[],
): void {
    for (const [name, spec] of specFields) {
        const app = appFields.get(name);
        if (!app) {
            // Absent because the model it names is absent: adopting the
            // fragment brings both, and demanding the field alone is a schema
            // Prisma refuses to load. Reported through the "not adopted" line
            // that already names the model.
            if (notAdopted.has(spec.type)) continue;
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
 * The platform models that outlive their tenant: the ones whose fragment
 * declares `tenantId` and deliberately comments no relation to `Tenant`.
 *
 * Read off the fragments rather than listed, so the next model kept past its
 * tenant is covered by being written that way. Every other model with a
 * `tenantId` ships the pointer a consumer enables, cascade and all.
 */
export function modelsKeptPastTheTenant(specSchema: string): string[] {
    const pointed = new Set(
        findFkPointers(specSchema)
            .filter((pointer) => pointer.target === 'Tenant')
            .map((pointer) => pointer.model),
    );
    return [...parseSchema(specSchema).models]
        .filter(([model, fields]) => fields.has('tenantId') && !pointed.has(model))
        .map(([model]) => model);
}

/**
 * The relations in a consumer's model that cascade from its `tenantId`.
 *
 * Compared without whitespace and on the structural part of each line, so a
 * relation commented out does not count and spacing does not hide one.
 */
function cascadesFromTenant(model: string, block: string): TenantCascade[] {
    const found: TenantCascade[] = [];
    for (const line of block.split('\n')) {
        const compact = structuralOnly(line).replace(/\s+/g, '');
        if (
            compact.includes('@relation(') &&
            compact.includes('fields:[tenantId]') &&
            compact.includes('onDelete:Cascade')
        ) {
            found.push({ model, field: line.trim().split(/\s/)[0] });
        }
    }
    return found;
}

/**
 * Compares a consumer schema against the canonical fragments. `specSchema` is
 * the concatenation of the fragments the check should cover.
 */
/**
 * @param knownModels Every model the shipped fragments declare, where the spec
 * passed in is a narrowed selection of them (`schema check --fragments=…`).
 * Omitted, the spec is taken to be the whole of it.
 */
export function checkSchema(
    specSchema: string,
    appSchema: string,
    knownModels?: ReadonlySet<string>,
): SchemaCheckReport {
    const spec = parseSchema(specSchema);
    const app = parseSchema(appSchema);

    const missingFields: MissingField[] = [];
    const fieldMismatches: FieldMismatch[] = [];
    const missingBlockAttributes: MissingBlockAttribute[] = [];

    // Which models the consumer did not adopt, before any field is compared: a
    // field of the first model can name the last one, so the answer cannot be
    // built up as the comparison walks.
    const absentModels = [...spec.models.keys()].filter((name) => !app.models.has(name));
    const absentEnums = [...spec.enums.keys()].filter((name) => !app.enums.has(name));
    // A model the platform ships and the consumer does not have. `known` is the
    // whole shipped set where a caller passes it and the spec otherwise, which
    // is what makes `--fragments=…` behave like a full run: with a narrowed
    // spec, the model a relation points at may not be in `spec` at all, and
    // without `known` the field would be reported as missing on exactly the
    // path a consumer reaches after `schema apply --fragments=…`.
    //
    // Bounded by what the platform declares either way. A type neither the
    // fragments nor the consumer have is a reference to something the consumer
    // owns and has not written, which is still drift.
    const shipped = knownModels ?? new Set(spec.models.keys());
    const notAdopted = new Set([...shipped].filter((name) => !app.models.has(name)));

    for (const [model, specFields] of spec.models) {
        const appFields = app.models.get(model);
        if (!appFields) continue;
        compareFields(
            model,
            specFields,
            appFields,
            app.enums,
            notAdopted,
            missingFields,
            fieldMismatches,
        );
        const specAttrs = spec.modelAttributes.get(model);
        const appAttrs = app.modelAttributes.get(model);
        if (specAttrs && appAttrs) {
            compareBlockAttributes(model, specAttrs, appAttrs, missingBlockAttributes);
        }
    }

    const appBlocks = extractBlocks(appSchema, 'model');
    const tenantCascades = modelsKeptPastTheTenant(specSchema).flatMap((model) => {
        const block = appBlocks.get(model);
        return block ? cascadesFromTenant(model, block) : [];
    });

    const missingEnumValues: MissingEnumValue[] = [];

    for (const [name, specValues] of spec.enums) {
        const appValues = app.enums.get(name);
        if (!appValues) continue;
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
        tenantCascades,
        checkedModelCount: spec.models.size - absentModels.length,
        checkedEnumCount: spec.enums.size - absentEnums.length,
        ok:
            missingFields.length === 0 &&
            missingEnumValues.length === 0 &&
            fieldMismatches.length === 0 &&
            tenantCascades.length === 0 &&
            !missingBlockAttributes.some(breaksContract),
    };
}
