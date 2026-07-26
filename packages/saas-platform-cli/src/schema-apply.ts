// schema-apply — pure-function helpers for the `saasicat schema apply`
// command. Idempotently inserts missing `model X { ... }` blocks from a Prisma
// fragment into an existing `schema.prisma`.
//
// `schema apply` only ever ADDS whole models. It does not carry enums, does
// not update models that already exist, and does not enable the commented-out
// consumer relations — use `saasicat schema check` to find out what a
// schema is missing after a package upgrade.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P5.

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

export interface ApplyResult {
    /** Number of models that were added. */
    added: string[];
    /** Number of models that were already present (no write). */
    skipped: string[];
    /** Resulting schema text. When `added.length === 0` identical to the input. */
    schema: string;
}

/**
 * Appends missing models from `fragmentBlocks` to the end of `schema`. Existing
 * models (same name) stay unchanged and are listed in `skipped`.
 */
export function applyFragmentBlocks(
    schema: string,
    fragmentBlocks: Map<string, string>,
    options: { fragmentLabel?: string } = {},
): ApplyResult {
    const existing = new Set(extractModelNames(schema));
    const added: string[] = [];
    const skipped: string[] = [];
    const additions: string[] = [];
    for (const [name, block] of fragmentBlocks) {
        if (existing.has(name)) {
            skipped.push(name);
        } else {
            added.push(name);
            additions.push(block);
        }
    }
    if (additions.length === 0) {
        return { added, skipped, schema };
    }
    const header = options.fragmentLabel
        ? `\n\n// ============================================================\n// Eingefügt durch \`saasicat schema apply\` aus ${options.fragmentLabel}\n// ============================================================\n`
        : `\n\n// Eingefügt durch \`saasicat schema apply\`\n`;
    const trimmedSchema = schema.endsWith('\n') ? schema : schema + '\n';
    return {
        added,
        skipped,
        schema: trimmedSchema + header + additions.join('\n\n') + '\n',
    };
}
