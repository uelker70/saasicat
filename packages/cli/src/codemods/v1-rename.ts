// Rewrites what the 1.0 rename changed in a consumer's own code.
//
// Phase 5 gave the product one spelling, one module class, one registry-key
// namespace and one name per token. A consumer meets that as four kinds of
// text: an identifier with an old stem, a `Symbol.for` string with an old
// prefix, a token that now has a different name per entry, and one export
// subpath. The rules are not written here — they are read from
// `v1-rename.map.json`, the table the rename was done from, so a rewrite
// cannot disagree with what the platform actually exports. Pure functions, as
// `v1-imports.ts`: the caller reads and writes files.

/** One entry of the rename table. */
export interface RenameTable {
    /** An identifier stem, matched anywhere in an identifier, and its replacement. */
    readonly identifierStems: Readonly<Record<string, string>>;
    /** A registry-key prefix (or a whole key) inside a string literal, and its replacement. */
    readonly registryKeys: Readonly<Record<string, string>>;
    /** Per import specifier: a name that means something different per entry. */
    readonly entryTokens: Readonly<Record<string, Readonly<Record<string, string>>>>;
    /** A module specifier prefix and its replacement. */
    readonly subpaths: Readonly<Record<string, string>>;
}

export interface RenameResult {
    readonly text: string;
    readonly rewritten: number;
    /**
     * Names the table knows only per entry, imported from somewhere the table
     * does not cover. Reported rather than guessed: which registry the
     * consumer meant is not in the text.
     */
    readonly ambiguous: readonly string[];
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The specifier and the bound names of every `import { … } from '…'`. */
const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+(['"])([^'"]+)\2/g;

/** Applies the table to one file's text. Idempotent: a second run changes nothing. */
export function rewriteNames(text: string, table: RenameTable): RenameResult {
    let next = text;
    let rewritten = 0;
    const ambiguous = new Set<string>();

    // 1. Tokens whose new name depends on the entry they come from. Decided
    //    per import statement; the name is then renamed across the file.
    const perEntry = new Map<string, string>();
    for (const match of text.matchAll(NAMED_IMPORT)) {
        const [, names, , specifier] = match;
        const mapping = table.entryTokens[specifier];
        for (const raw of names.split(',')) {
            const name = raw
                .trim()
                .replace(/^type\s+/, '')
                .split(/\s+as\s+/)[0]
                ?.trim();
            if (!name) continue;
            const knownSomewhere = Object.values(table.entryTokens).some((m) => name in m);
            if (!knownSomewhere) continue;
            if (mapping && name in mapping) perEntry.set(name, mapping[name]);
            else ambiguous.add(`${name} from '${specifier}'`);
        }
    }
    for (const [from, to] of perEntry) {
        next = next.replace(new RegExp(`\\b${escape(from)}\\b`, 'g'), () => {
            rewritten += 1;
            return to;
        });
    }

    // 2. Identifier stems. `\w` on both sides is NOT required: the stem sits
    //    inside `createSaasPlatformTestModule` as well as at the front of
    //    `SaasPlatformModule`. Case-sensitive, so `saasicat` is never a stem.
    for (const [from, to] of Object.entries(table.identifierStems)) {
        next = next.replace(new RegExp(escape(from), 'g'), () => {
            rewritten += 1;
            return to;
        });
    }

    // 3. Registry keys — only inside a `Symbol.for` call or a plain string
    //    literal that starts with the prefix. The ui-vue prefix doubles as an
    //    import specifier, so that one is rewritten inside `Symbol.for` only.
    for (const [from, to] of Object.entries(table.registryKeys)) {
        const symbolFor = new RegExp(`(Symbol\\.for\\(\\s*['"\`])${escape(from)}`, 'g');
        next = next.replace(symbolFor, (_, head: string) => {
            rewritten += 1;
            return `${head}${to}`;
        });
        if (from.startsWith('@')) continue; // an import-looking prefix: Symbol.for only
        const literal = new RegExp(`(['"\`])${escape(from)}`, 'g');
        next = next.replace(literal, (_, quote: string) => {
            rewritten += 1;
            return `${quote}${to}`;
        });
    }

    // 4. Subpaths that were renamed inside a package.
    for (const [from, to] of Object.entries(table.subpaths)) {
        next = next.replace(new RegExp(escape(from), 'g'), () => {
            rewritten += 1;
            return to;
        });
    }

    return { text: next, rewritten, ambiguous: [...ambiguous].sort() };
}
