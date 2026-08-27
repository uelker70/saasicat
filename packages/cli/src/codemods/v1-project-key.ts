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
// So this rewrites two forms and REPORTS everything else. The line between them
// took four attempts and three review rounds, and the reason it moved is worth
// writing down rather than repeating:
//
//   attempt            counter-example
//   ---------------    -----------------------------------------------------
//   comma-terminated   an interface separates members with `;`
//   `;`-free body      TypeScript permits `,` between type members
//   another member     a type literal may separate them with a newline alone
//   quoted value       `interface E { projectKey: 'app' }` — `tsc` accepts it
//
// Each was a proxy for one question: is this brace an object literal or a type
// literal? In TypeScript the two are LEXICALLY IDENTICAL. `{ projectKey: 'app',
// apiBase: string }` is a valid type and `{ projectKey: 'app', apiBase: '/a' }`
// is a valid value, and no amount of punctuation-reading separates them —
// only the enclosing grammar does, and reading that reliably means parsing.
//
// This codemod does not parse, so it does not decide. An object member is
// reported with its file and line; the migration guide's table says what each
// shape becomes, and a person's editor does the rest in one pass. That is the
// trade: minutes of somebody's attention against the chance of silently
// deleting a member of their own type.
//
// Rewritten, because neither needs the grammar:
//
//   - the top-level `projectKey:` line of a `config/saas.yaml`, a file whose
//     schema this platform owns outright.
//   - `?projectKey=…` in a URL whose path names `/catalog/`, the prefix every
//     endpoint that read the parameter sat under. A consumer's own
//     `/api/reports?projectKey=` is a request this platform never served.
//
// Reported, with the line: every `projectKey` in a source file that is not one
// of those two. Which way this errs is the point — it leaves work for a person,
// never removes theirs.
//
// Pure functions, like `v1-imports.ts` and `v1-rename.ts`: the caller reads and
// writes the files, which is what makes the rules testable without one.

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
        //
        // Every `{` counts, not only the one that opens an interpolation. The
        // scan used to increment on `${` and decrement on any `}`, so a nested
        // object inside the expression — `${flag ? { x: 1 } : b}` — closed the
        // depth on its own brace and the following space was read as the end of
        // the value. What came out was `/catalog/plans : b}&locale=de`, counted
        // as a rewrite.
        let end = at + NEEDLE.length;
        let depth = 0;
        while (end < text.length) {
            const ch = text[end];
            if (ch === '$' && text[end + 1] === '{') {
                depth += 1;
                end += 1;
            } else if (ch === '{' && depth > 0) depth += 1;
            else if (ch === '}' && depth > 0) depth -= 1;
            else if (depth === 0 && (ch === '&' || ch === "'" || ch === '"' || ch === '`')) break;
            else if (depth === 0 && (ch === '\n' || ch === ' ')) break;
            end += 1;
        }
        // An interpolation that never closed means the scan ran past the end of
        // the string it was reading. Nothing sound can be cut from that.
        if (depth > 0) {
            skipped.push(lineAt(text, at));
            out += text.slice(index, at + NEEDLE.length);
            index = at + NEEDLE.length;
            continue;
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
    const reported = new Set<number>(query.skipped);

    // Everything the query pass did not take is reported, whatever shape it is
    // in. A member, a shorthand, a type declaration, a string in a comment: the
    // codemod does not claim to know which, and saying so by line is worth more
    // than a guess that is right most of the time.
    for (
        let at = query.text.indexOf('projectKey');
        at >= 0;
        at = query.text.indexOf('projectKey', at + 1)
    ) {
        // A longer identifier that merely ends in it — `old_projectKey` — is
        // somebody else's name, and naming it would send a reader looking for
        // something that is not there.
        if (isIdentifierChar(query.text[at - 1])) continue;
        if (isIdentifierChar(query.text[at + 'projectKey'.length])) continue;
        reported.add(lineAt(query.text, at));
    }

    return {
        text: query.text,
        rewritten: query.removed,
        undecided: [...reported].sort((a, b) => a - b),
    };
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
