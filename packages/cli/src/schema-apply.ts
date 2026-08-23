// schema-apply — pure-function helpers for the `saasicat schema apply`
// command. Idempotently inserts missing `model X { ... }` blocks from a Prisma
// fragment into an existing `schema.prisma`.
//
// `schema apply` only ever ADDS whole models. It does not carry enums, does
// not update models that already exist, and does not enable the commented-out
// consumer relations — use `saasicat schema check` to find out what a
// schema is missing after a package upgrade.
//

import { extractBlockNames, extractBlocks } from './prisma-blocks.js';

/** Returns the names of all top-level `model X { ... }` blocks in the schema. */
export function extractModelNames(schema: string): string[] {
    return extractBlockNames(schema, 'model');
}

/**
 * Returns all `model X { ... }` blocks from a fragment as a map
 * `name -> complete block text incl. opening/closing braces`.
 */
export function extractModelBlocks(fragment: string): Map<string, string> {
    return extractBlocks(fragment, 'model');
}

/** Returns all `enum X { ... }` blocks from a fragment, keyed by name. */
export function extractEnumBlocks(fragment: string): Map<string, string> {
    return extractBlocks(fragment, 'enum');
}

/** Names of all top-level `enum X { ... }` blocks in the schema. */
export function extractEnumNames(schema: string): string[] {
    return extractBlockNames(schema, 'enum');
}

/**
 * What a fragment contributes: its enums and its models. Both travel
 * together, because a model's `BillingCycle` field is a validation error in
 * a schema that has the model and not the enum — which is what `apply` used
 * to produce for every consumer whose schema did not already carry the enums
 * by hand, and what the example app masked by carrying them.
 */
export interface FragmentBlocks {
    enums: Map<string, string>;
    models: Map<string, string>;
}

export function extractFragmentBlocks(fragment: string): FragmentBlocks {
    return { enums: extractEnumBlocks(fragment), models: extractModelBlocks(fragment) };
}

export interface ApplyResult {
    /** Models that were added. */
    added: string[];
    /** Models that were already present (no write). */
    skipped: string[];
    /** Enums that were added, before the models that use them. */
    addedEnums: string[];
    /** Enums that were already present (no write). */
    skippedEnums: string[];
    /** Resulting schema text. When nothing was added, identical to the input. */
    schema: string;
}

/**
 * Appends missing enums and models from `fragmentBlocks` to the end of
 * `schema`. Existing blocks (same name) stay unchanged and are listed as
 * skipped. A plain map of models is accepted for the callers that only ever
 * had models; the enums are then `[]`, which is what they were before.
 */
export function applyFragmentBlocks(
    schema: string,
    fragmentBlocks: FragmentBlocks | Map<string, string>,
    options: { fragmentLabel?: string } = {},
): ApplyResult {
    const blocks: FragmentBlocks =
        fragmentBlocks instanceof Map
            ? { enums: new Map(), models: fragmentBlocks }
            : fragmentBlocks;
    const existingModels = new Set(extractModelNames(schema));
    const existingEnums = new Set(extractEnumNames(schema));
    const added: string[] = [];
    const skipped: string[] = [];
    const addedEnums: string[] = [];
    const skippedEnums: string[] = [];
    const additions: string[] = [];
    // Enums first: Prisma does not care about order, a reader does — the type
    // should stand above the field that uses it.
    for (const [name, block] of blocks.enums) {
        if (existingEnums.has(name)) {
            skippedEnums.push(name);
        } else {
            addedEnums.push(name);
            additions.push(block);
        }
    }
    for (const [name, block] of blocks.models) {
        if (existingModels.has(name)) {
            skipped.push(name);
        } else {
            added.push(name);
            additions.push(block);
        }
    }
    if (additions.length === 0) {
        return { added, skipped, addedEnums, skippedEnums, schema };
    }
    const header = options.fragmentLabel
        ? `\n\n// ============================================================\n// Inserted by \`saasicat schema apply\` from ${options.fragmentLabel}\n// ============================================================\n`
        : `\n\n// Inserted by \`saasicat schema apply\`\n`;
    const trimmedSchema = schema.endsWith('\n') ? schema : schema + '\n';
    return {
        added,
        skipped,
        addedEnums,
        skippedEnums,
        schema: trimmedSchema + header + additions.join('\n\n') + '\n',
    };
}
