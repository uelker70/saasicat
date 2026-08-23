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
//
// naming-history: the comments below name the retired spellings — they are
// what this file rewrites.

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

/** Every metacharacter, the backslash and the slash included — the set the lint asks for. */
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Every `from '…'` / `from "…"` in a text — the anchor a named import is read back from. */
const FROM_SPECIFIER = /from\s*(['"])([^'"]+)\1/g;

/** Whitespace, in one pass and without backtracking. */
const isSpace = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

/**
 * The specifier and the bound names of every `import { … } from '…'`.
 *
 * Read backwards from each `from`, one character at a time, instead of with
 * one regular expression over the statement: `\{([^}]*)\}\s+from` and its
 * siblings backtrack quadratically on a file full of `import {{`, and the
 * file is a consumer's — whatever they wrote, this must finish.
 */
export function namedImports(text: string): Array<{ names: string[]; specifier: string }> {
    const found: Array<{ names: string[]; specifier: string }> = [];
    for (const match of text.matchAll(FROM_SPECIFIER)) {
        let i = (match.index ?? 0) - 1;
        while (i >= 0 && isSpace(text[i])) i -= 1;
        if (text[i] !== '}') continue;
        const close = i;
        const open = text.lastIndexOf('{', close);
        if (open < 0) continue;
        i = open - 1;
        while (i >= 0 && isSpace(text[i])) i -= 1;
        let head = text.slice(Math.max(0, i - 3), i + 1);
        if (head === 'type') {
            i -= 4;
            while (i >= 0 && isSpace(text[i])) i -= 1;
            head = text.slice(Math.max(0, i - 5), i + 1);
        } else {
            head = text.slice(Math.max(0, i - 5), i + 1);
        }
        if (head !== 'import') continue;
        const names = text
            .slice(open + 1, close)
            .split(',')
            .map((raw) => {
                // `type X as Y` → `X`: the bound name is the one the entry exports.
                const words = raw.trim().split(/\s+/);
                if (words[0] === 'type') words.shift();
                return words[0] ?? '';
            })
            .filter((name) => name.length > 0);
        found.push({ names, specifier: match[2] });
    }
    return found;
}

/** Applies the table to one file's text. Idempotent: a second run changes nothing. */
export function rewriteNames(text: string, table: RenameTable): RenameResult {
    let next = text;
    let rewritten = 0;
    const ambiguous = new Set<string>();

    // 1. Tokens whose new name depends on the entry they come from. Decided
    //    per import statement; the name is then renamed across the file.
    const perEntry = new Map<string, string>();
    for (const { names, specifier } of namedImports(text)) {
        const mapping = table.entryTokens[specifier];
        for (const name of names) {
            const knownSomewhere = Object.values(table.entryTokens).some((m) => name in m);
            if (!knownSomewhere) continue;
            const already = perEntry.get(name);
            if (
                mapping &&
                name in mapping &&
                (already === undefined || already === mapping[name])
            ) {
                perEntry.set(name, mapping[name]);
            } else {
                // Unknown entry — or the same name taken from two entries in one
                // file, where one replacement would rewrite both to one token.
                if (already !== undefined) perEntry.delete(name);
                ambiguous.add(`${name} from '${specifier}'`);
            }
        }
    }
    for (const [from, to] of perEntry) {
        // eslint-disable-next-line no-restricted-syntax -- `escape` covers every metacharacter
        next = next.replace(new RegExp(`\\b${escape(from)}\\b`, 'g'), () => {
            rewritten += 1;
            return to;
        });
    }

    // 2. Identifier stems. `\w` on both sides is NOT required: the stem sits
    //    inside `createSaasPlatformTestModule` as well as at the front of
    //    `SaasPlatformModule`. Case-sensitive, so `saasicat` is never a stem.
    for (const [from, to] of Object.entries(table.identifierStems)) {
        // eslint-disable-next-line no-restricted-syntax -- `escape` covers every metacharacter
        next = next.replace(new RegExp(escape(from), 'g'), () => {
            rewritten += 1;
            return to;
        });
    }

    // 3. Registry keys — only inside a `Symbol.for` call or a plain string
    //    literal that starts with the prefix. The ui-vue prefix doubles as an
    //    import specifier, so that one is rewritten inside `Symbol.for` only.
    for (const [from, to] of Object.entries(table.registryKeys)) {
        // eslint-disable-next-line no-restricted-syntax -- `escape` covers every metacharacter
        const symbolFor = new RegExp(`(Symbol\\.for\\(\\s*['"\`])${escape(from)}`, 'g');
        next = next.replace(symbolFor, (_, head: string) => {
            rewritten += 1;
            return `${head}${to}`;
        });
        if (from.startsWith('@')) continue; // an import-looking prefix: Symbol.for only
        // eslint-disable-next-line no-restricted-syntax -- `escape` covers every metacharacter
        const literal = new RegExp(`(['"\`])${escape(from)}`, 'g');
        next = next.replace(literal, (_, quote: string) => {
            rewritten += 1;
            return `${quote}${to}`;
        });
    }

    // 4. Subpaths that were renamed inside a package.
    for (const [from, to] of Object.entries(table.subpaths)) {
        // eslint-disable-next-line no-restricted-syntax -- `escape` covers every metacharacter
        next = next.replace(new RegExp(escape(from), 'g'), () => {
            rewritten += 1;
            return to;
        });
    }

    return { text: next, rewritten, ambiguous: [...ambiguous].sort() };
}
