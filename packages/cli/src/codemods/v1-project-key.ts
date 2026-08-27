// Takes `projectKey` out of a consumer's code, where taking it out is decidable.
//
// project-key-history: this file names the retired identifier because removing
// it is the whole subject.
//
// A rename can be applied everywhere its stem appears; a removal cannot. The
// word `projectKey` is an ordinary property name, and a consumer's own object
// may carry one that has nothing to do with this platform — deleting those
// would be a data loss the codemod cannot see. So this rewrites the forms that
// are anchored to something only the platform produces, and *reports* the rest
// rather than guessing:
//
//   - `?projectKey=…` in a URL a consumer builds. The admin API no longer
//     reads the parameter, and a query string is not a place a consumer's own
//     `projectKey` can hide.
//   - a `projectKey:` member of an object literal that also carries a member
//     only the platform asks for (`apiBase`, `vatRate`, `planKey`, …). The
//     anchor is what makes it decidable.
//   - the top-level `projectKey:` line of a `config/saas.yaml`.
//
// Pure functions, like `v1-imports.ts` and `v1-rename.ts`: the caller reads and
// writes the files, which is what makes the rules testable without one.

/**
 * Members whose presence in an object literal identifies it as a platform
 * payload rather than the consumer's own data.
 *
 * Derived from what the removed field actually sat beside — the endpoint
 * constant, the `dbCatalog`/`PlanCatalogModule` identity, and the catalogue
 * create bodies. A literal carrying none of them is left alone and reported.
 */
const PLATFORM_SIBLINGS = [
    'apiBase',
    'vatRate',
    'planKey',
    'bundleKey',
    'featureKey',
    'quotaKey',
    'capabilityKey',
    'targetVersionId',
    'activeLocales',
    'internalLabel',
] as const;

export interface ProjectKeyResult {
    readonly text: string;
    /** How many occurrences were taken out. */
    readonly rewritten: number;
    /**
     * 1-based line numbers of the occurrences left in place.
     *
     * Reported rather than removed: the codemod could not tell them from a
     * consumer's own field, and a wrong deletion is worse than a named one.
     */
    readonly undecided: readonly number[];
}

/** Whitespace, in one pass and without backtracking. */
function isSpace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * The `?projectKey=…` and `&projectKey=…` parts of every URL in a text.
 *
 * Scanned rather than matched: `\?projectKey=[^&'"`]*` is fine on its own, but
 * the surrounding cleanup (a `?` left with nothing after it, a `&` that has to
 * become the new `?`) is easier to get right forwards than with a second
 * pattern over the result.
 */
function stripQueryParameter(text: string): { text: string; removed: number } {
    const NEEDLE = 'projectKey=';
    let out = '';
    let index = 0;
    let removed = 0;
    for (;;) {
        const at = text.indexOf(NEEDLE, index);
        if (at < 1) break;
        const separator = text[at - 1];
        if (separator !== '?' && separator !== '&') {
            out += text.slice(index, at + NEEDLE.length);
            index = at + NEEDLE.length;
            continue;
        }
        // The value runs to the next parameter separator or to whatever ends
        // the string the URL is written in.
        let end = at + NEEDLE.length;
        let depth = 0;
        while (end < text.length) {
            const ch = text[end];
            // `${…}` may legitimately contain `&`, `'` and a backtick.
            if (ch === '$' && text[end + 1] === '{') depth += 1;
            else if (ch === '}' && depth > 0) depth -= 1;
            else if (depth === 0 && (ch === '&' || ch === "'" || ch === '"' || ch === '`')) break;
            else if (depth === 0 && (ch === '\n' || ch === ' ')) break;
            end += 1;
        }
        out += text.slice(index, at - 1);
        if (separator === '?' && text[end] === '&') {
            // It was the first of several: the next one takes over the `?`.
            out += '?';
            index = end + 1;
        } else {
            index = end;
        }
        removed += 1;
    }
    return { text: out + text.slice(index), removed };
}

/** The object literal a `projectKey:` member sits in, or null when it has none. */
function enclosingObject(text: string, at: number): { open: number; close: number } | null {
    let open = -1;
    let depth = 0;
    for (let i = at - 1; i >= 0; i -= 1) {
        const ch = text[i];
        if (ch === '}') depth += 1;
        else if (ch === '{') {
            if (depth === 0) {
                open = i;
                break;
            }
            depth -= 1;
        }
    }
    if (open < 0) return null;

    depth = 0;
    for (let i = open + 1; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            if (depth === 0) return { open, close: i };
            depth -= 1;
        }
    }
    return null;
}

/** Where a `projectKey:` member ends: after its value's comma, or at the brace. */
function memberEnd(text: string, from: number, close: number): number {
    let depth = 0;
    for (let i = from; i < close; i += 1) {
        const ch = text[i];
        if (ch === '{' || ch === '[' || ch === '(') depth += 1;
        else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
        else if (depth === 0 && ch === ',') return i + 1;
    }
    return close;
}

/**
 * Whether an object literal carries one of the members that identify it.
 *
 * Scanned rather than matched: building `new RegExp(`…${sibling}…`)` is the
 * shape the guidelines forbid, and the check is a substring plus two character
 * tests either side of it.
 */
function hasPlatformSibling(body: string): boolean {
    for (const sibling of PLATFORM_SIBLINGS) {
        for (let at = body.indexOf(sibling); at >= 0; at = body.indexOf(sibling, at + 1)) {
            const before = at === 0 ? '{' : body[at - 1];
            if (before !== '{' && before !== ',' && !isSpace(before)) continue;
            let after = at + sibling.length;
            while (after < body.length && isSpace(body[after])) after += 1;
            if (body[after] === ':') return true;
        }
    }
    return false;
}

/** 1-based line number of an offset. */
function lineAt(text: string, at: number): number {
    let line = 1;
    for (let i = 0; i < at; i += 1) if (text[i] === '\n') line += 1;
    return line;
}

/**
 * Rewrites one source file.
 *
 * `yaml` switches to the config form: there the field is a top-level key in a
 * file the platform owns the schema of, so it is decidable without an anchor.
 */
export function removeProjectKey(
    text: string,
    kind: 'source' | 'yaml' = 'source',
): ProjectKeyResult {
    if (kind === 'yaml') return removeFromYaml(text);

    const query = stripQueryParameter(text);
    let working = query.text;
    let rewritten = query.removed;
    const undecided: number[] = [];

    // Right to left, so an earlier offset is still valid after a later cut.
    const members: number[] = [];
    for (
        let at = working.indexOf('projectKey');
        at >= 0;
        at = working.indexOf('projectKey', at + 1)
    ) {
        let after = at + 'projectKey'.length;
        while (after < working.length && isSpace(working[after])) after += 1;
        if (working[after] !== ':') continue;
        // A type declaration (`projectKey: string`) belongs to a consumer's own
        // interface; only a value assignment is a payload member.
        members.push(at);
    }

    for (const at of members.reverse()) {
        const object = enclosingObject(working, at);
        const decidable =
            object !== null && hasPlatformSibling(working.slice(object.open, object.close));
        if (!decidable) {
            undecided.push(lineAt(working, at));
            continue;
        }
        let start = at;
        while (start > 0 && (working[start - 1] === ' ' || working[start - 1] === '\t')) start -= 1;
        let end = memberEnd(working, at, object.close);
        if (end === object.close) {
            // It was the last member, so it had no comma of its own — the one
            // that separated it from its predecessor has to go with it, or the
            // literal is left as `{ apiBase: '…', }`.
            while (start > 0 && isSpace(working[start - 1])) start -= 1;
            if (working[start - 1] === ',') start -= 1;
        } else if (working[end] === '\n') {
            // Take the line's newline with it, so the cut leaves no blank line.
            end += 1;
        } else if (start > 0 && working[start - 1] === '\n') {
            start -= 1;
        }
        // Cutting the LAST member takes the whitespace before the closing brace
        // with it, and that whitespace is the literal's shape: a space on one
        // line, a newline and an indent on several. Put back exactly what was
        // there, or `{ a: 1 }` comes out as `{ a: 1}`.
        let joiner = '';
        if (end === object.close) {
            let ws = object.close;
            while (ws > start && isSpace(working[ws - 1])) ws -= 1;
            joiner = working.slice(ws, object.close);
        }
        working = working.slice(0, start) + joiner + working.slice(end);
        rewritten += 1;
    }

    return { text: working, rewritten, undecided: undecided.reverse() };
}

/** `projectKey: notesapp` at the top level of `config/saas.yaml`. */
function removeFromYaml(text: string): ProjectKeyResult {
    const lines = text.split('\n');
    const kept: string[] = [];
    let rewritten = 0;
    for (const line of lines) {
        if (line.startsWith('projectKey:')) {
            rewritten += 1;
            continue;
        }
        kept.push(line);
    }
    return { text: kept.join('\n'), rewritten, undecided: [] };
}
