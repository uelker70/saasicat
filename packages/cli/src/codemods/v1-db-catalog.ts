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
// refuses to boot while the values are still passed, so it cannot be acted on
// halfway.
//
// Pure functions, like the other codemods: the caller reads the files.

import { SCANNED_FOR_MOVED_SETTINGS } from './v1-moved-settings.js';

/** Which files a `dbCatalog` can be passed in: code, not prose. */
export const SCANNED_FOR_DB_CATALOG = SCANNED_FOR_MOVED_SETTINGS;

export type DbCatalogShape = 'values' | 'reference';

export interface DbCatalogOccurrence {
    /** 1-based line of the `dbCatalog:` property. */
    readonly line: number;
    /**
     * `values` — an object literal with no `path` member: the old shape.
     * `reference` — anything else on the right of the colon: a variable, a
     * call, a spread. This cannot see what it carries, so it is named for a
     * person to look at rather than passed over.
     */
    readonly shape: DbCatalogShape;
}

export interface DbCatalogResult {
    readonly occurrences: readonly DbCatalogOccurrence[];
}

const PROPERTY = 'dbCatalog';

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

/** The index of the `}` closing the `{` at `open`, or -1 where the text ends first. */
function closingBrace(text: string, open: number): number {
    let depth = 0;
    for (let at = open; at < text.length; at += 1) {
        if (text[at] === '{') depth += 1;
        if (text[at] === '}') {
            depth -= 1;
            if (depth === 0) return at;
        }
    }
    return -1;
}

/** Whether an object literal's text has a `path` member of its own. */
function namesAPath(block: string): boolean {
    for (let at = block.indexOf('path'); at >= 0; at = block.indexOf('path', at + 1)) {
        if (isIdentifierChar(block[at - 1])) continue;
        if (block[at + 4] !== undefined && isIdentifierChar(block[at + 4])) continue;
        if (block[skipBlanks(block, at + 4)] === ':') return true;
    }
    return false;
}

/**
 * Every `dbCatalog:` property in one source file, with what stands to its right.
 *
 * A property, which means the name followed by a colon. The other codemod in
 * this family reports every word-boundary mention of a setting, including one
 * in a comment, on the reasoning that over-reporting inside code costs a
 * glance. That reasoning does not carry here: `saasicat init` writes the
 * sentence "pass `dbCatalog` instead" into every generated `app.module.ts`, so
 * a mention is the normal case and a report of it would be noise on every
 * upgrade. A type member (`dbCatalog?:`) is not a property either, and a
 * shorthand `{ dbCatalog }` is not seen — the value it carries is elsewhere,
 * and the module's refusal names it at boot.
 */
export function findDbCatalogBlocks(text: string): DbCatalogResult {
    const occurrences: DbCatalogOccurrence[] = [];

    for (let at = text.indexOf(PROPERTY); at >= 0; at = text.indexOf(PROPERTY, at + 1)) {
        if (isIdentifierChar(text[at - 1])) continue;
        const afterName = at + PROPERTY.length;
        if (isIdentifierChar(text[afterName])) continue;
        const colon = skipBlanks(text, afterName);
        if (text[colon] !== ':') continue;

        const value = skipBlanks(text, colon + 1);
        if (text[value] !== '{') {
            occurrences.push({ line: lineAt(text, at), shape: 'reference' });
            continue;
        }
        const close = closingBrace(text, value);
        const block = close === -1 ? text.slice(value) : text.slice(value, close + 1);
        if (namesAPath(block)) continue;
        occurrences.push({ line: lineAt(text, at), shape: 'values' });
    }

    return { occurrences };
}

/** What to write instead, for the report. */
export const WHERE_DB_CATALOG_GOES =
    "dbCatalog: { path: 'config/saas.yaml' } — the file the values were forwarded from. " +
    'Delete the values; the platform reads app, currency, vatRate, tenantBilling, marketing ' +
    'and notifications from the file it names, and the plans from the read sink as before.';
