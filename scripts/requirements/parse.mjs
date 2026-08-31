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
 * The generated block naming the cases that prove an entry.
 *
 * Written by the generator, never by hand, and cut out again before an entry is
 * read — it is a fact about the tests rather than part of the promise, so it
 * must not reach the text a change is compared against. Otherwise annotating a
 * test would read as rewriting a requirement.
 */
export const PROOF_BEGIN = '<!-- BEGIN proof -->';
export const PROOF_END = '<!-- END proof -->';
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
    /^(?:([⚪🔵🔴🟡])\s+)?_\(Superseded\s+on\s+(\d{4}-\d{2}-\d{2})\s+by\s+`(SC-[A-Z0-9]+-\d{3})`\.\)_\s?/u;
export const WITHDRAWN = /^(?:([⚪🔵🔴🟡])\s+)?_\(Withdrawn\s+on\s+(\d{4}-\d{2}-\d{2})\.\)_\s?/u;
// Dated like the others, because the risk a draft carries is staleness: an
// entry proposed a year ago and never decided reads exactly like one proposed
// last week, and only one of the two is still somebody's intention.
export const DRAFT = /^(?:([⚪🔵🔴🟡])\s+)?_\(Draft\s+since\s+(\d{4}-\d{2}-\d{2})\.\)_\s?/u;

/**
 * The ordinary state, written down like every other.
 *
 * It carries no words because it qualifies nothing — no date, no successor —
 * and "this is an ordinary requirement" is what the absence of anything else
 * already said. What it does carry is a mark, so that no state has to be read
 * out of a blank: reading absence is how a marker wrapped across a line went a
 * day unnoticed, counted as a promise the product keeps.
 *
 * Or the end of the text, because nineteen entries state their whole promise in
 * the heading and have nothing under it but this.
 */
export const CURRENT = /^(🟢)(?:\s+|$)/u;

/**
 * What a breach of this promise costs, where it costs more than the ordinary.
 *
 * Three values and not five, because a scale nobody can apply is a scale
 * everybody applies differently. Money and law are one bucket: both are
 * somebody's real loss and both are argued in the same room. Tenant separation
 * and access are the other. Everything else carries no mark, which is the
 * common case and should stay quiet.
 *
 * It is optional and it is not the state — an entry without one is not
 * unassessed, it is ordinary. Marking every entry would say nothing, the same
 * way marking none did.
 */
export const RISKS = { money: '💰', tenancy: '🔒' };

export const RISK = /^([💰🔒])\s+/u;
export const NOT_DELIVERED = '_(Decided, not yet delivered.)_';
// Every gap is `\s`, not a space. These files are wrapped by hand at a hundred
// columns, and two committed entries wrap this marker across the break — so
// they read as delivered, vanished from the index of what is not built yet, and
// nothing asked why they had no colour.
export const PENDING = /\s?(?:([⚪🔵🔴🟡])\s+)?_\(Decided,\s+not\s+yet\s+delivered\.\)_/u;

/** The same marker where an entry opens with it, which is where it belongs. */
export const PENDING_OPENS = /^(🟡)\s+_\(Decided,\s+not\s+yet\s+delivered\.\)_\s*/u;

/** Every identifier mentioned in a piece of prose. */
export const REFERENCES = /\bSC-[A-Z0-9]+-\d{3}(?![\w-])/g;

/**
 * Anything an author could have meant as an identifier, deliberately wider.
 *
 * Held against `ID` to find the near-misses. It consumes every character that
 * could continue a name, because stopping earlier hands back a valid-looking
 * prefix of a broken token — `SC-PLAN-004_extra` read as `SC-PLAN-004`, which
 * passed while the reference itself resolved to nothing.
 */
export const LOOKS_LIKE_AN_ID = /\bSC-[A-Za-z0-9][A-Za-z0-9_-]*/g;

/**
 * The prose of an entry, which is its title and its body.
 *
 * Nineteen entries carry their whole promise in the title, and a title can name
 * another requirement as readily as a paragraph can. Reading references from
 * the body alone left those unresolved and unchecked.
 */
export const proseOf = (entry) => `${entry.title ?? ''}\n${entry.text}`;

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

/** Everything outside the generated proof block, which is the entry as written. */
function withoutProof(lines) {
    const from = lines.findIndex((line) => line.trim() === PROOF_BEGIN);
    if (from === -1) return lines;
    const to = lines.findIndex((line, at) => at > from && line.trim() === PROOF_END);
    return to === -1 ? lines.slice(0, from) : [...lines.slice(0, from), ...lines.slice(to + 1)];
}

function finishEntry(entry) {
    const lines = trim(withoutProof(entry.lines));
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
    // What the entry opens with, before anything is stripped. Every entry opens
    // with exactly one state marker, so that no state is read out of a blank.
    const opensWith = [CURRENT, SUPERSEDED, WITHDRAWN, DRAFT, PENDING_OPENS]
        .map((pattern) => pattern.exec(text)?.[1])
        .find(Boolean);

    let icon;
    const superseded = SUPERSEDED.exec(text);
    const withdrawn = WITHDRAWN.exec(text);
    const draft = DRAFT.exec(text);
    const current = CURRENT.exec(text);
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
    } else if (current) {
        [, icon] = current;
        text = text.slice(current[0].length);
    }
    // Stripped, not just detected. Delivering a promise is not a change to the
    // promise: leaving the marker in the text would make the edit that removes
    // it read as a rewrite, and the author's only ways past that would be a
    // false editorial claim or a supersession of something that never changed.
    const pending = PENDING.exec(text);
    if (pending) text = text.replace(PENDING, '').trim();

    // After whatever opened the entry — a state or the delivery marker — and
    // before the promise. Read last because a pending entry opens with its own
    // marker, and the risk sits behind that rather than in front of it.
    const risk = RISK.exec(text);
    if (risk) text = text.slice(risk[0].length);

    return {
        ...entry,
        lines,
        sources,
        source: sources[0],
        text,
        status,
        opensWith,
        risk: risk?.[1],
        icon,
        pendingIcon: pending?.[1],
        supersededBy,
        delivered: !pending,
        // Derived, never written down: the prose is the only place a
        // relationship is stated, so it is the only place it can go stale.
        references: [...new Set(`${entry.title ?? ''}\n${text}`.match(REFERENCES) ?? [])].filter(
            (id) => id !== entry.id,
        ),
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
        strays: [],
        preamble: preamble.map((text, number) => ({
            where: `requirements/00_preamble/${String(number).padStart(2, '0')}_part.md`,
            number,
            text,
        })),
        chapters: parsed,
        entries: parsed.flatMap((chapter) => chapter.entries),
    };
}

/** The one file that is deliberately not part of the document. */
const NOT_PUBLISHED = 'README.md';

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

/**
 * Markdown that is in the tree and in nothing else.
 *
 * A file whose name does not match is not read, and not being read has never
 * looked like anything: rename `01_roles.md` to `01-roles.md` and that prose
 * leaves the published document while every check stays green. The same holds
 * for a stray file beside a `chapter.md`. Collected here and reported by the
 * checker, because the parser's job is to say what is there.
 */
function straysIn(base, directories) {
    const strays = [];
    for (const directory of directories) {
        const isPreamble = Number(DIRECTORY.exec(directory)?.[1]) === PREAMBLE;
        for (const name of readdirSync(join(base, directory))) {
            if (!name.endsWith('.md')) continue;
            if (isPreamble ? PART.test(name) : name === 'chapter.md') continue;
            strays.push(`requirements/${directory}/${name}`);
        }
    }
    for (const name of readdirSync(base)) {
        if (name.endsWith('.md') && name !== NOT_PUBLISHED) strays.push(`requirements/${name}`);
    }
    return strays;
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

    return {
        preamble,
        chapters,
        strays: straysIn(base, directories),
        entries: chapters.flatMap((chapter) => chapter.entries),
    };
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
