// Takes `projectKey` out of a consumer's code, where taking it out is decidable.
//
// project-key-history: this file names the retired identifier because removing
// it is the whole subject.
//
// A rename can be applied everywhere its stem appears; a removal cannot. The
// word `projectKey` is an ordinary property name, and a consumer's own object
// may carry one that has nothing to do with this platform — deleting those is
// data loss the codemod cannot see afterwards.
//
// Three review rounds landed on this one predicate before it was measured
// rather than patched again, so here is the measurement. Counted over the two
// real consumer repositories, every occurrence takes one of five shapes, and
// the field that separates them is the shape of the VALUE:
//
//   | shape                        | count | decidable |
//   | ---------------------------- | ----- | --------- |
//   | `projectKey: 'vereinsfux'`   |  ~83  | yes — a quoted literal is a value and cannot be a type
//   | `projectKey,` (shorthand)    |   46  | no — no value to read at all
//   | `projectKey: PROJECT_KEY`    |   30  | no — a const and a type reference are the same tokens
//   | `projectKey: string`         |   11  | no by separator, yes by value: not quoted
//   | `?projectKey=…` in a URL     |    6  | yes — if the path is one the platform served it on
//
// So the rule is the value's shape, not the separator around it. Separators
// were the first three attempts and each had a counter-example: an interface
// uses `;`, a type literal may use a newline, and TypeScript permits `,`
// between type members — the punctuation never says which side it is on. A
// quoted string does: no type expression is one.
//
// Rewritten automatically, because each is decidable:
//
//   - a `projectKey:` member whose value is a QUOTED STRING, inside an object
//     that also carries a member only the platform asks for (`apiBase`,
//     `vatRate`, `planKey`, …), where `projectKey` is the whole identifier.
//   - `?projectKey=…` in a URL whose path names `/catalog/`, which is the
//     prefix every endpoint that read the parameter sat under. A consumer's own
//     `/api/reports?projectKey=` is not one of them and is left alone.
//   - the top-level `projectKey:` line of a `config/saas.yaml`, whose schema
//     this platform owns outright.
//
// Everything else is REPORTED by file and line: a bare-identifier value, a type
// member, a shorthand, a query part on somebody else's endpoint, an object with
// no platform member beside it. Which way this errs is the point — it leaves
// work for a person, never removes theirs. An integrator who reads the report
// finishes in minutes; one who does not still has compiling code.
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
function stripQueryParameter(text: string): {
    text: string;
    removed: number;
    skipped: number[];
} {
    const NEEDLE = 'projectKey=';
    let out = '';
    let index = 0;
    let removed = 0;
    const skipped: number[] = [];
    for (;;) {
        const at = text.indexOf(NEEDLE, index);
        if (at < 0) break;
        // `at === 0` is the needle with nothing in front of it, so it is not a
        // query part. It has to fall through to the copy-and-continue branch
        // rather than end the scan, or a later occurrence in the same file
        // would go unrewritten.
        const separator = at === 0 ? '' : text[at - 1];
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
        // Whose endpoint is this? Every admin route that read the parameter sat
        // under `/catalog/`; a consumer's own `/api/reports?projectKey=` is
        // their business, and rewriting it would silently change a request the
        // platform never served.
        if (!servesTheCatalogue(text, at)) {
            skipped.push(lineAt(text, at));
            out += text.slice(index, at + NEEDLE.length);
            index = at + NEEDLE.length;
            continue;
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
    return { text: out + text.slice(index), removed, skipped };
}

/**
 * Whether the URL a query part sits in is one the platform served it on.
 *
 * Read backwards from the parameter to whatever opened the string, and ask
 * whether `/catalog/` is in it. Frozen on purpose rather than derived: this
 * describes the endpoints as they were before 1.0, and the past does not move.
 */
function servesTheCatalogue(text: string, at: number): boolean {
    let start = at;
    while (start > 0) {
        const ch = text[start - 1];
        if (ch === '`' || ch === "'" || ch === '"' || ch === '\n') break;
        start -= 1;
    }
    return text.slice(start, at).includes('/catalog/');
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

/**
 * Where a `projectKey:` member ends: after its separator, or at the brace.
 *
 * Both separators count. A comma ends a member of an object literal; a
 * semicolon ends one of an interface or type literal, and treating it as part
 * of the value is how this cut through `planKey: string;` and everything after
 * it, emptying a consumer's interface. `isTypeBody` keeps such a body out of
 * the codemod's way entirely — this is the second line of defence, so no shape
 * either of them fails to classify can take more than its own member.
 *
 * Quotes are tracked, not just brackets. `projectKey: 'my,app'` would otherwise
 * end at the comma inside the string and leave half a literal behind — a
 * consumer's value is theirs, and a scanner that assumes it holds no separator
 * is a scanner that corrupts the one file it was meant to fix.
 */
function memberEnd(text: string, from: number, close: number): number {
    let depth = 0;
    let quote = '';
    for (let i = from; i < close; i += 1) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\') i += 1;
            else if (ch === quote) quote = '';
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') quote = ch;
        else if (ch === '{' || ch === '[' || ch === '(') depth += 1;
        else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
        else if (depth === 0 && (ch === ',' || ch === ';')) return i + 1;
    }
    return close;
}

/**
 * Whether an object body is a type's rather than a value's.
 *
 * An interface or a type literal separates its members with `;`, and its
 * `projectKey` is a declaration, not a payload — removing it rewrites what a
 * consumer's own code *says about* a shape rather than what it sends. The
 * distinction was claimed in a comment here and never implemented, and the
 * cost was not a wrong member but a wrong span: with no comma to stop at, the
 * cut ran to the closing brace and took every member after it.
 *
 * `?:` is already excluded upstream — a member scan requires the colon to
 * follow the name directly, so `projectKey?: string` never reaches here. This
 * is the required form, `projectKey: string`.
 */
function isTypeBody(body: string): boolean {
    let depth = 0;
    let quote = '';
    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (quote) {
            if (ch === '\\') i += 1;
            else if (ch === quote) quote = '';
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') quote = ch;
        else if (ch === '{' || ch === '[' || ch === '(') depth += 1;
        else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
        else if (depth === 0 && ch === ';') return true;
    }
    return false;
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

/**
 * Whether a member's value is a quoted string — the one shape that is a value
 * and cannot be a type.
 *
 * `projectKey: PROJECT_KEY` is not accepted: a constant and a type reference
 * are the same tokens, and this codemod does not guess between them. Thirty
 * occurrences in the two consumer repositories take that form and are reported
 * instead, which is a minute of a person's attention against the alternative
 * of deleting a type member that looked like one.
 */
function hasQuotedValue(text: string, colonAt: number, close: number): boolean {
    let i = colonAt + 1;
    while (i < close && isSpace(text[i])) i += 1;
    const ch = text[i];
    return ch === "'" || ch === '"' || ch === '`';
}

/** Whether an identifier character sits next to an offset — a longer name. */
function isIdentifierChar(ch: string | undefined): boolean {
    return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
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
    const undecided: number[] = [...query.skipped];

    // Right to left, so an earlier offset is still valid after a later cut.
    // Every occurrence of the whole identifier is collected, member or not:
    // one that cannot be rewritten still has to be reported, and the shorthand
    // `{ projectKey }` — 46 of them in one consumer repository — was passing
    // through in silence while the codemod claimed to be done.
    const occurrences: Array<{ at: number; colon: number | null }> = [];
    for (
        let at = working.indexOf('projectKey');
        at >= 0;
        at = working.indexOf('projectKey', at + 1)
    ) {
        // A longer identifier that merely ends in it — `old_projectKey` — is
        // somebody else's name. Cutting from inside one left `{ apiBase: '/x',
        // old_ }` and called it rewritten.
        if (isIdentifierChar(working[at - 1])) continue;
        let after = at + 'projectKey'.length;
        if (isIdentifierChar(working[after])) continue;
        while (after < working.length && isSpace(working[after])) after += 1;
        occurrences.push({ at, colon: working[after] === ':' ? after : null });
    }

    for (const { at, colon } of occurrences.reverse()) {
        const object = colon === null ? null : enclosingObject(working, at);
        // From INSIDE the brace: including it would open a depth of one, and
        // every separator in the body would then read as nested.
        const body = object === null ? '' : working.slice(object.open + 1, object.close);
        // The value's shape is what decides, per the measurement in the header.
        // The other three are cheap corroboration, not the discriminator.
        const decidable =
            object !== null &&
            colon !== null &&
            hasQuotedValue(working, colon, object.close) &&
            !isTypeBody(body) &&
            hasPlatformSibling(body);
        if (!decidable || object === null) {
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

    // One line, one entry. A query part the scan skipped is also an occurrence
    // the member scan sees, and reporting `loaders.ts:12` twice tells a reader
    // there are two things to look at when there is one.
    const reported = [...new Set(undecided)].sort((a, b) => a - b);
    return { text: working, rewritten, undecided: reported };
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
