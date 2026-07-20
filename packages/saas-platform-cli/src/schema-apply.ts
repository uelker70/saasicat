// schema-apply — pure-function helpers for the `saas-platform schema apply`
// command. Idempotently inserts missing `model X { ... }` blocks from a Prisma
// fragment into an existing `schema.prisma`.
//
// Deliberately no `@prisma/internals` dep: for the quickstart feature a
// regex-based model-block detection is enough. Constraint/index conflicts
// are NOT detected — the user manually reviews what the CLI inserted.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P5.

/** Returns the names of all top-level `model X { ... }` blocks in the schema. */
export function extractModelNames(schema: string): string[] {
    const names: string[] = [];
    const lines = schema.split('\n');
    for (const line of lines) {
        const stripped = line.replace(/\/\/.*$/, '').trim();
        const match = stripped.match(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/);
        if (match) names.push(match[1]);
    }
    return names;
}

/**
 * Returns all `model X { ... }` blocks from a fragment as a map
 * `name -> complete block text incl. opening/closing braces`.
 *
 * Delimiting logic: we search for `^model X {` (start of line, possibly with
 * leading whitespace) and close as soon as the brace depth drops back to
 * 0. Strings/comments inside the block are, in simplified terms, not
 * counted, which is robust for Prisma schemas (no curly braces
 * in strings, comments only `//`-style).
 */
export function extractModelBlocks(fragment: string): Map<string, string> {
    const blocks = new Map<string, string>();
    const lines = fragment.split('\n');
    let current: { name: string; lines: string[]; depth: number } | null = null;

    for (const rawLine of lines) {
        const stripped = rawLine.replace(/\/\/.*$/, '');
        if (!current) {
            const match = rawLine.match(/^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/);
            if (match) {
                const openCount = (stripped.match(/\{/g) ?? []).length;
                const closeCount = (stripped.match(/\}/g) ?? []).length;
                current = { name: match[1], lines: [rawLine], depth: openCount - closeCount };
                if (current.depth === 0) {
                    blocks.set(current.name, current.lines.join('\n'));
                    current = null;
                }
            }
            continue;
        }
        current.lines.push(rawLine);
        current.depth += (stripped.match(/\{/g) ?? []).length;
        current.depth -= (stripped.match(/\}/g) ?? []).length;
        if (current.depth <= 0) {
            blocks.set(current.name, current.lines.join('\n'));
            current = null;
        }
    }
    return blocks;
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
        ? `\n\n// ============================================================\n// Eingefügt durch \`saas-platform schema apply\` aus ${options.fragmentLabel}\n// ============================================================\n`
        : `\n\n// Eingefügt durch \`saas-platform schema apply\`\n`;
    const trimmedSchema = schema.endsWith('\n') ? schema : schema + '\n';
    return {
        added,
        skipped,
        schema: trimmedSchema + header + additions.join('\n\n') + '\n',
    };
}
