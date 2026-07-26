// prisma-blocks — regex-based extraction of top-level Prisma declaration
// blocks (`model X { … }`, `enum Y { … }`).
//
// Deliberately no `@prisma/internals` dep: the CLI must stay installable
// without pulling Prisma's engine downloads. Nested braces do not occur in
// the Prisma DSL, so brace counting is sufficient.

/**
 * Cuts off a trailing `//` comment. Deliberately index-based instead of
 * `replace(/\/\/.*$/, '')`: the regex backtracks quadratically on lines with
 * many single slashes.
 */
export function stripLineComment(line: string): string {
    const commentStart = line.indexOf('//');
    return commentStart === -1 ? line : line.slice(0, commentStart);
}

function declarationPattern(keyword: string): RegExp {
    return new RegExp(`^\\s*${keyword}\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*\\{`);
}

/** Returns the names of all top-level `<keyword> X { … }` blocks. */
export function extractBlockNames(schema: string, keyword: string): string[] {
    const pattern = declarationPattern(keyword);
    const names: string[] = [];
    for (const line of schema.split('\n')) {
        const match = stripLineComment(line).match(pattern);
        if (match) names.push(match[1]);
    }
    return names;
}

/**
 * Returns all top-level `<keyword> X { … }` blocks as a map
 * `name -> complete block text incl. opening/closing braces`.
 *
 * Delimiting logic: we search for `^<keyword> X {` (start of line, possibly
 * with leading whitespace) and close as soon as the brace depth drops back
 * to 0. Braces inside comments are not counted.
 */
export function extractBlocks(schema: string, keyword: string): Map<string, string> {
    const pattern = declarationPattern(keyword);
    const blocks = new Map<string, string>();
    let current: { name: string; lines: string[]; depth: number } | null = null;

    for (const rawLine of schema.split('\n')) {
        const stripped = stripLineComment(rawLine);
        const openCount = (stripped.match(/\{/g) ?? []).length;
        const closeCount = (stripped.match(/\}/g) ?? []).length;

        if (!current) {
            const match = stripped.match(pattern);
            if (!match) continue;
            current = { name: match[1], lines: [rawLine], depth: openCount - closeCount };
        } else {
            current.lines.push(rawLine);
            current.depth += openCount - closeCount;
        }

        if (current.depth <= 0) {
            blocks.set(current.name, current.lines.join('\n'));
            current = null;
        }
    }
    return blocks;
}

/**
 * Returns a block's body lines — comments stripped, blank lines, block-level
 * attributes (`@@index`, `@@map`) and the enclosing braces removed.
 *
 * Cuts between the first `{` and the last `}` rather than dropping the first
 * and last line, so single-line blocks (`model X { id String @id }`) yield
 * their body too.
 */
export function blockBodyLines(block: string): string[] {
    const bodyStart = block.indexOf('{');
    const bodyEnd = block.lastIndexOf('}');
    if (bodyStart === -1 || bodyEnd <= bodyStart) return [];
    return block
        .slice(bodyStart + 1, bodyEnd)
        .split('\n')
        .map((line) => stripLineComment(line).trim())
        .filter((line) => line.length > 0 && !line.startsWith('@@'));
}
