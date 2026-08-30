// Reads the requirement sources under `requirements/` into one model.
//
// One file per chapter, not one per requirement. The chapter is the unit a
// person reads, and two entries in this catalogue already sit beside what they
// belong to rather than in numeric order — `SC-PLAN-025` next to the quota
// rules it qualifies, `SC-CFG-016` next to the settings it retires. A file per
// requirement would have to carry that order in a field; a file per chapter
// has it for free, in the only place it is ever read.
//
// The chapter body is not transformed on the way to `docs/requirements.md` —
// the document is those bodies concatenated under the preamble. Nothing is
// rewritten, so nothing can be lost in the rewriting, and a source file can be
// read exactly as it will be published.
//
// The front matter grammar is deliberately smaller than YAML: `key: value`, one
// per line, the value taken raw to the end of the line. No nesting, no lists,
// no quoting rules — so a title may contain a colon, a quote or a backtick and
// still mean itself, and the parser is thirty lines rather than a dependency.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { BEGIN, END } from './render.mjs';

export const ID = /^SC-([A-Z0-9]+)-(\d{3})$/;

/**
 * A chapter directory: its position, then the identifier prefix it owns.
 *
 * The number lives in the directory name and nowhere else. A listing then reads
 * in document order — which is what a reader opening `requirements/` for the
 * first time needs — and renumbering a chapter is a rename git follows rather
 * than an edit to a field that has to agree with something.
 */
export const DIRECTORY = /^(\d{2})_([a-z0-9]+)$/;

/**
 * A part of the preamble: the prose that opens the document, before chapter 1.
 *
 * The preamble is directory `00`, so `requirements/` holds one sequence of
 * numbered directories and nothing else — the parts of the opening and then the
 * chapters, reading top to bottom in the order the document does. Two sequences
 * side by side would put `01_roles.md` next to `01_scope/` and undo the reason
 * for numbering anything.
 *
 * `README.md` matches nothing here, which is how it stays out of the published
 * page: it is the note to whoever edits these files, not part of what they
 * produce.
 */
export const PREAMBLE = 0;
export const PART = /^(\d{2})_([a-z0-9-]+)\.md$/;
export const HEADING = /^### (SC-([A-Z0-9]+)-(\d{3})) — (.+)$/;

/** Anything shaped like a heading, so a malformed one is seen rather than skipped. */
export const HEADING_LIKE = /^### .*$/;

/** Anything shaped like a field marker, for the same reason. */
export const MARKER_LIKE = /^_[^_]*:_/;

export const SOURCE = /^_Source:_ (.+)$/;
/**
 * One colour per state, in the entry and in the index that lists them.
 *
 * The colour is not decoration and it is not the state either — the words are.
 * It is there so that scrolling a three-thousand-line page shows where the
 * ordinary entries stop, which reading the words one at a time does not. Since
 * a colour that disagrees with its words is worse than no colour, the checker
 * insists the two match.
 *
 * `current` has a colour and no entry wears it. Marking the ordinary case would
 * put a green dot on three hundred and eighty-nine entries and hide the ten
 * that are not ordinary among them — the opposite of what the colours are for.
 * It appears once, in the line under the chapter table, so that the vocabulary
 * is complete where somebody looks it up.
 */
export const ICONS = {
    current: '🟢',
    draft: '⚪',
    superseded: '🔵',
    withdrawn: '🔴',
    pending: '🟡',
};

// Written out rather than built from ICONS above: a regex assembled from a
// template is opaque to `eslint-plugin-regexp`, and the backtracking rule this
// repository runs is exactly the kind that has to read the pattern to work. The
// `u` flag is not optional either — three of the four icons are outside the
// basic plane, and without it a character class matches half a surrogate pair.

export const SUPERSEDED =
    /^(?:([⚪🔵🔴🟡])\s)?_\(Superseded\son\s(\d{4}-\d{2}-\d{2})\sby\s`(SC-[A-Z0-9]+-\d{3})`\.\)_\s?/u;
export const WITHDRAWN = /^(?:([⚪🔵🔴🟡])\s)?_\(Withdrawn\son\s(\d{4}-\d{2}-\d{2})\.\)_\s?/u;
// Dated like the others, because the risk a draft carries is staleness: an
// entry proposed a year ago and never decided reads exactly like one proposed
// last week, and only one of the two is still somebody's intention.
export const DRAFT = /^(?:([⚪🔵🔴🟡])\s)?_\(Draft\ssince\s(\d{4}-\d{2}-\d{2})\.\)_\s?/u;
export const NOT_DELIVERED = '_(Decided, not yet delivered.)_';
// Every gap is `\s`, not a space. These files are wrapped by hand at a hundred
// columns, and two committed entries wrap this marker across the break — so
// they read as delivered, vanished from the index of what is not built yet, and
// nothing asked why they had no colour.
export const PENDING = /\s?(?:([⚪🔵🔴🟡])\s)?_\(Decided,\snot\syet\sdelivered\.\)_/u;

/** Every identifier mentioned in a piece of prose. */
export const REFERENCES = /\bSC-[A-Z0-9]+-\d{3}(?![\w-])/g;

const FENCE = '---';
const FRONT_MATTER_KEY = /^([a-z][a-zA-Z]*): ?(.*)$/;

/**
 * Splits `---` front matter from the body.
 *
 * Throws rather than returning a partial result: a chapter whose front matter
 * did not parse has no number, and a caller that skipped it would drop every
 * requirement in it from every check that follows — including the one that
 * notices requirements going missing.
 */
export function frontMatter(text, where) {
    const lines = text.split('\n');
    if (lines[0] !== FENCE) throw new Error(`${where}: does not start with '${FENCE}'`);
    const end = lines.indexOf(FENCE, 1);
    if (end === -1) throw new Error(`${where}: front matter is not closed with '${FENCE}'`);

    const fields = {};
    for (let i = 1; i < end; i++) {
        const match = FRONT_MATTER_KEY.exec(lines[i]);
        if (!match) throw new Error(`${where}: line ${i + 1} is not 'key: value' — ${lines[i]}`);
        if (match[1] in fields) throw new Error(`${where}: '${match[1]}' appears twice`);
        fields[match[1]] = match[2].trim();
    }
    return { fields, body: trim(lines.slice(end + 1)).join('\n'), offset: end + 2 };
}

function trim(lines) {
    const out = [...lines];
    while (out.length && out[0].trim() === '') out.shift();
    while (out.length && out.at(-1).trim() === '') out.pop();
    return out;
}

/**
 * Cuts a chapter body into its introduction and its entries.
 *
 * The split is on the heading line alone. A malformed heading — an ordinary
 * hyphen where the document uses an em dash, a two-digit number — is kept as a
 * heading with no identifier rather than folded into the entry above it, so it
 * fails a check instead of disappearing into the prose of its neighbour.
 */
export function entriesIn(body, where, startLine) {
    const lines = body.split('\n');
    const intro = [];
    const entries = [];
    let current = null;

    lines.forEach((line, index) => {
        if (!HEADING_LIKE.test(line)) {
            (current ? current.lines : intro).push(line);
            return;
        }
        const match = HEADING.exec(line);
        current = {
            where: `${where}:${startLine + index}`,
            heading: line,
            id: match?.[1],
            prefix: match?.[2],
            number: match ? Number(match[3]) : null,
            title: match?.[4],
            lines: [],
        };
        entries.push(current);
    });

    return { intro: trim(intro).join('\n'), entries: entries.map(finishEntry) };
}

function finishEntry(entry) {
    const lines = trim(entry.lines);
    const sources = [];
    const body = [];
    for (const line of lines) {
        const source = SOURCE.exec(line);
        if (source) sources.push(source[1]);
        else body.push(line);
    }

    let text = trim(body).join('\n');
    let status = 'current';
    let supersededBy;

    // The dates are matched and not kept. Their job is to be mandatory: a
    // marker without one does not match, so `_(Draft.)_` stays prose and the
    // check for a near-miss state catches it. Nothing reads the value, and a
    // field nobody reads is a field that stops being true unnoticed.
    let icon;
    const superseded = SUPERSEDED.exec(text);
    const withdrawn = WITHDRAWN.exec(text);
    const draft = DRAFT.exec(text);
    if (superseded) {
        status = 'superseded';
        [, icon, , supersededBy] = superseded;
        text = text.slice(superseded[0].length);
    } else if (withdrawn) {
        status = 'withdrawn';
        [, icon] = withdrawn;
        text = text.slice(withdrawn[0].length);
    } else if (draft) {
        status = 'draft';
        [, icon] = draft;
        text = text.slice(draft[0].length);
    }
    // Stripped, not just detected. Delivering a promise is not a change to the
    // promise: leaving the marker in the text would make the edit that removes
    // it read as a rewrite, and the author's only ways past that would be a
    // false editorial claim or a supersession of something that never changed.
    const pending = PENDING.exec(text);
    if (pending) text = text.replace(PENDING, '').trim();

    return {
        ...entry,
        lines,
        sources,
        source: sources[0],
        text,
        status,
        icon,
        pendingIcon: pending?.[1],
        supersededBy,
        delivered: !pending,
        // Derived, never written down: the prose is the only place a
        // relationship is stated, so it is the only place it can go stale.
        references: [...new Set(text.match(REFERENCES) ?? [])].filter((id) => id !== entry.id),
    };
}

/** A chapter from its text, so a test can build one without a directory. */
export function parseChapter(text, directory) {
    const where = `requirements/${directory}/chapter.md`;
    const { fields, body, offset } = frontMatter(text, where);
    const { intro, entries } = entriesIn(body, where, offset);
    const named = DIRECTORY.exec(directory);
    return {
        fields,
        where,
        directory,
        number: named ? Number(named[1]) : null,
        prefix: named?.[2],
        title: fields.title,
        intro,
        body,
        entries,
    };
}

/** A catalogue from chapter texts, so a test can build one without a tree. */
export function catalogueOf(chapters, preamble = [`# Requirements\n\n${BEGIN}\n${END}`]) {
    const parsed = chapters
        .map(([directory, text]) => parseChapter(text, directory))
        .sort((a, b) => a.number - b.number);
    return {
        preamble: preamble.map((text, number) => ({
            where: `requirements/00_preamble/${String(number).padStart(2, '0')}_part.md`,
            number,
            text,
        })),
        chapters: parsed,
        entries: parsed.flatMap((chapter) => chapter.entries),
    };
}

function readPreamble(base, directory) {
    return readdirSync(join(base, directory))
        .filter((entry) => PART.test(entry))
        .sort()
        .map((entry) => ({
            where: `requirements/${directory}/${entry}`,
            number: Number(PART.exec(entry)[1]),
            text: readFileSync(join(base, directory, entry), 'utf8').trimEnd(),
        }));
}

/** The whole catalogue: preamble, chapters in document order, every entry. */
export function readCatalogue(root) {
    const base = join(root, 'requirements');
    const directories = readdirSync(base)
        .filter((entry) => statSync(join(base, entry)).isDirectory())
        .sort();

    const preamble = directories
        .filter((directory) => Number(DIRECTORY.exec(directory)?.[1]) === PREAMBLE)
        .flatMap((directory) => readPreamble(base, directory));

    const chapters = directories
        .filter((directory) => Number(DIRECTORY.exec(directory)?.[1]) !== PREAMBLE)
        .map((directory) =>
            parseChapter(readFileSync(join(base, directory, 'chapter.md'), 'utf8'), directory),
        );

    return { preamble, chapters, entries: chapters.flatMap((chapter) => chapter.entries) };
}

/**
 * GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens.
 *
 * The em dash between an identifier and its title is punctuation, so it leaves
 * the two spaces around it behind and the anchor carries a double hyphen. That
 * is not a quirk to tidy up — it is what the rendered page actually links to.
 */
export function anchor(heading) {
    return heading
        .replace(/^#+ /, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N} -]/gu, '')
        .replace(/ /g, '-');
}
