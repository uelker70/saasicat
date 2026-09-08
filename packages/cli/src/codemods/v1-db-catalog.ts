// Finds a `dbCatalog` that still carries the settings as values.
//
// `dbCatalog` names `config/saas.yaml` now — `dbCatalog: { path: '…' }` — and
// the platform reads the settings from it. It used to take `app`, `currency`,
// `vatRate`, `tenantBilling` and `marketing` as values, which every consumer
// forwarded from the file it had loaded anyway.
//
// Reported rather than rewritten, like the settings next door. A rewrite would
// have to know which file the values were forwarded from, and that is a
// variable in another file more often than a literal in this one — `SAAS_CONFIG`
// loaded by a path constant three imports away. A guess would be wrong
// quietly. What makes the report safe rather than lax is that the module
// refuses to boot while a value is still passed, so it cannot be acted on
// halfway.
//
// Pure functions, like the other codemods: the caller reads the files.

import { DB_CATALOG_MEMBERS } from '@saasicat/nest/platform';

import { SCANNED_FOR_MOVED_SETTINGS } from './v1-moved-settings.js';

/** Which files a `dbCatalog` can be passed in: code, not prose. */
export const SCANNED_FOR_DB_CATALOG = SCANNED_FOR_MOVED_SETTINGS;

export type DbCatalogShape = 'values' | 'mixed' | 'reference';

export interface DbCatalogOccurrence {
    /** 1-based line of the `dbCatalog:` property. */
    readonly line: number;
    /**
     * `values` — an object literal with no `path`: the old shape whole.
     * `mixed` — a `path` with something beside it that the option does not
     * take: an upgrade that stopped halfway, and the platform refuses it too.
     * `reference` — anything else on the right of the colon: a variable, a
     * call, a spread. This cannot see what it carries, so it is named for a
     * person to look at rather than passed over.
     */
    readonly shape: DbCatalogShape;
    /**
     * The members that are not what the option takes — every one of a
     * `values` block, the ones left beside the path of a `mixed` one, and
     * nothing for a `reference`. A spread is listed as `...name`, because
     * what it carries is decided elsewhere.
     */
    readonly leftovers: readonly string[];
}

export interface DbCatalogResult {
    readonly occurrences: readonly DbCatalogOccurrence[];
}

const PROPERTY = 'dbCatalog';
const TAKEN: ReadonlySet<string> = new Set(DB_CATALOG_MEMBERS);

const isIdentifierStart = (ch: string | undefined): boolean =>
    ch !== undefined && /[A-Za-z_$]/.test(ch);

const isIdentifierChar = (ch: string | undefined): boolean =>
    ch !== undefined && /[A-Za-z0-9_$]/.test(ch);

const isBlank = (ch: string | undefined): boolean =>
    ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

function lineAt(text: string, index: number): number {
    let line = 1;
    for (let at = 0; at < index; at += 1) {
        if (text[at] === '\n') line += 1;
    }
    return line;
}

/** The index after the whitespace that starts at `from`. */
function skipBlanks(text: string, from: number): number {
    let at = from;
    while (isBlank(text[at])) at += 1;
    return at;
}

/** The index of the quote closing the one at `open`, or the text's end. */
function closingQuote(text: string, open: number): number {
    const quote = text[open];
    for (let at = open + 1; at < text.length; at += 1) {
        if (text[at] === '\\') {
            at += 1;
            continue;
        }
        if (text[at] === quote) return at;
    }
    return text.length;
}

/**
 * The index after the comment or string starting at `at`, or `at` itself where
 * none starts there. An unterminated one runs to the text's end.
 */
function skipCommentOrString(text: string, at: number): number {
    const ch = text[at];
    if (ch === '/' && text[at + 1] === '/') {
        const end = text.indexOf('\n', at);
        return end === -1 ? text.length : end;
    }
    if (ch === '/' && text[at + 1] === '*') {
        const end = text.indexOf('*/', at + 2);
        return end === -1 ? text.length : end + 2;
    }
    if (ch === "'" || ch === '"' || ch === '`') return closingQuote(text, at) + 1;
    return at;
}

interface ObjectLiteral {
    /** The names of the literal's own members, in order. */
    readonly members: readonly string[];
    /** The index after the closing brace, or the text's end where there is none. */
    readonly end: number;
}

/**
 * The own members of the object literal opening at `open`, read off its text.
 *
 * Depth is tracked so that a `path:` inside `app: { … }` is that block's
 * member and not this one's; strings and comments are skipped so that a
 * `// path:` or the colon inside `'config/saas.yaml'` decides nothing. A
 * member is a name in key position — before a colon, or on its own as a
 * shorthand — a quoted key, or a spread, listed as `...name`. Key position is
 * what tells `path: SAAS_CONFIG_PATH` apart from `{ path }`: the identifier
 * after a colon is a value, and a comma is what puts the next name back in
 * key position.
 */
function objectLiteralAt(text: string, open: number): ObjectLiteral {
    const members: string[] = [];
    let depth = 0;
    let expectingKey = true;
    let at = open + 1;
    while (at < text.length) {
        const ch = text[at] as string;
        if (ch === "'" || ch === '"' || ch === '`') {
            // A quoted key is a member; a string anywhere else is stepped over.
            const end = closingQuote(text, at);
            if (depth === 0 && expectingKey && text[skipBlanks(text, end + 1)] === ':') {
                members.push(text.slice(at + 1, end));
            }
            at = end + 1;
            continue;
        }
        const skipped = skipCommentOrString(text, at);
        if (skipped > at) {
            at = skipped;
            continue;
        }
        if (ch === '{' || ch === '[' || ch === '(') {
            depth += 1;
            at += 1;
            continue;
        }
        if (ch === '}' || ch === ']' || ch === ')') {
            if (depth === 0) return { members, end: at + 1 };
            depth -= 1;
            at += 1;
            continue;
        }
        if (depth === 0 && ch === ':') expectingKey = false;
        if (depth === 0 && ch === ',') expectingKey = true;
        if (depth === 0 && expectingKey && ch === '.' && text.startsWith('...', at)) {
            let end = at + 3;
            while (isIdentifierChar(text[end])) end += 1;
            members.push(text.slice(at, end));
            at = end;
            continue;
        }
        if (depth === 0 && expectingKey && isIdentifierStart(ch)) {
            let end = at;
            while (isIdentifierChar(text[end])) end += 1;
            const next = text[skipBlanks(text, end)];
            if (next === ':' || next === ',' || next === '}') members.push(text.slice(at, end));
            at = end;
            continue;
        }
        at += 1;
    }
    return { members, end: text.length };
}

/**
 * Every `dbCatalog:` property in one source file, with what stands to its right.
 *
 * A property in code, which means the name followed by a colon, outside any
 * comment or string. The other codemod in this family reports every
 * word-boundary mention of a setting, including one in a comment, on the
 * reasoning that over-reporting inside code costs a glance. That reasoning
 * does not carry here: `saasicat init` writes the sentence "pass `dbCatalog`
 * instead" into every generated `app.module.ts`, so a mention is the normal
 * case and a report of it would be noise on every upgrade — and a block
 * commented out, or quoted as a sample, is migration work that does not
 * exist. A type member (`dbCatalog?:`) is not a property either, and a
 * shorthand `{ dbCatalog }` is not seen — the value it carries is elsewhere,
 * and the module's refusal names it at boot.
 *
 * What counts as migrated is read off `DB_CATALOG_MEMBERS`, the list the
 * platform's own refusal reads, so the two cannot disagree about a block.
 */
export function findDbCatalogBlocks(text: string): DbCatalogResult {
    const occurrences: DbCatalogOccurrence[] = [];

    // One pass with the lexical context kept, the same way the literal is
    // read: a comment or a string is stepped over whole, so a `dbCatalog:`
    // inside one is never looked at.
    let at = 0;
    while (at < text.length) {
        const skipped = skipCommentOrString(text, at);
        if (skipped > at) {
            at = skipped;
            continue;
        }
        if (!text.startsWith(PROPERTY, at) || isIdentifierChar(text[at - 1])) {
            at += 1;
            continue;
        }
        const afterName = at + PROPERTY.length;
        if (isIdentifierChar(text[afterName])) {
            at = afterName;
            continue;
        }
        const colon = skipBlanks(text, afterName);
        if (text[colon] !== ':') {
            at = afterName;
            continue;
        }

        const value = skipBlanks(text, colon + 1);
        const line = lineAt(text, at);
        if (text[value] !== '{') {
            occurrences.push({ line, shape: 'reference', leftovers: [] });
            at = value;
            continue;
        }
        const { members, end } = objectLiteralAt(text, value);
        const leftovers = members.filter((member) => !TAKEN.has(member));
        if (!members.includes('path')) {
            occurrences.push({ line, shape: 'values', leftovers });
        } else if (leftovers.length > 0) {
            occurrences.push({ line, shape: 'mixed', leftovers });
        }
        at = end;
    }

    return { occurrences };
}

/** What to write instead, for the report. */
export const WHERE_DB_CATALOG_GOES =
    "dbCatalog: { path: 'config/saas.yaml' } — the file the values were forwarded from. " +
    'Delete the values; the platform reads app, currency, vatRate, tenantBilling, marketing ' +
    'and notifications from the file it names, and the plans from the read sink as before.';
