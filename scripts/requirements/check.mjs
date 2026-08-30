// What the sources have to satisfy before they become a document.
//
// Every rule here was a convention the hand-written catalogue relied on and
// nothing enforced: identifiers unique and never reused, numbering that does
// not skip, a source on every entry, a cross-reference that resolves. The file
// held to all of them because one person wrote it in one sitting. That is not a
// property, it is a coincidence, and it ends the first time an entry is added
// under time pressure.
//
// Two of these checks exist for what *nearly* matches rather than what clearly
// does not. A heading with an ordinary hyphen where the document uses an em
// dash, or a `_Sources:_` line with one letter too many, reads correctly to a
// person and is invisible to a pattern — so the entry falls out of every check
// including the one that notices entries going missing. Matching the shape
// loosely and then insisting on the exact form is what turns a silent
// disappearance into a message.
//
// The rules a machine cannot check are not listed here and are not pretended to
// be: whether a promise is true, whether it is one statement rather than three,
// whether its source is the real reason. Those stay prose and are named as
// prose in `docs/explanation/requirements-as-sources.md`.

import { anchor, DIRECTORY, HEADING, ICONS, MARKER_LIKE, SOURCE } from './parse.mjs';
import { BEGIN, END } from './render.mjs';

const CHAPTER_KEYS = new Set(['title']);
const RETIRED = new Set(['superseded', 'withdrawn']);
const STATES = new Set(['draft', 'current', 'superseded', 'withdrawn']);

/** A state marker, or something wearing enough of one to be meant as one. */
const NEARLY_A_STATE = /^(?:\p{Extended_Pictographic}\uFE0F? )?_\(/u;

/** A link into the repository, which resolves differently here and on the page. */
const REPO_LINK = /\]\((?!#|https?:)([^)]+)\)/g;

export function check(catalogue) {
    const problems = [];
    const say = (where, message) => problems.push(`${where}: ${message}`);

    const byId = new Map();
    for (const entry of catalogue.entries) {
        if (!entry.id) continue;
        const seen = byId.get(entry.id);
        if (seen) say(entry.where, `'${entry.id}' is also at ${seen.where}`);
        else byId.set(entry.id, entry);
    }

    checkPreamble(catalogue, say);
    checkChapters(catalogue, say);
    for (const chapter of catalogue.chapters) {
        for (const entry of chapter.entries) checkEntry(entry, chapter, byId, say);
        checkNumbering(chapter, say);
    }
    checkReferences(catalogue, byId, say);
    checkFragments(catalogue, say);

    return problems;
}

/**
 * The prose before chapter 1 — what the catalogue is and how to read it.
 *
 * Without it the document opens on "## 1." and a stranger has no way to learn
 * what an identifier means or why one is never reused. A missing part here
 * would fail nothing else: every chapter would still render.
 */
function checkPreamble(catalogue, say) {
    if (catalogue.preamble.length === 0) {
        say('requirements/00_preamble/', 'holds no <nn>_<name>.md part to open the document with');
        return;
    }
    // Exactly one file carries the chapter table. None, and the table is
    // simply absent — nothing else here would notice, and the one page that
    // tells a reader which chapter owns `SC-PROMO-…` would quietly stop
    // existing. Two, and a reader would find two tables and no rule saying
    // which is current.
    const carriers = catalogue.preamble.filter(
        (file) => file.text.includes(BEGIN) && file.text.includes(END),
    );
    if (carriers.length !== 1) {
        say(
            'requirements/',
            `${carriers.length} files carry the chapter-table markers, expected exactly 1`,
        );
    }

    catalogue.preamble.forEach((file, index) => {
        if (file.number !== index) {
            say(
                file.where,
                `is numbered ${file.number}, expected ${String(index).padStart(2, '0')}`,
            );
        }
        if (!file.text.trim()) say(file.where, 'is empty');
    });
}

function checkChapters(catalogue, say) {
    const numbers = new Set();
    for (const chapter of catalogue.chapters) {
        for (const key of Object.keys(chapter.fields)) {
            if (!CHAPTER_KEYS.has(key)) say(chapter.where, `unknown field '${key}'`);
        }
        if (!DIRECTORY.test(chapter.directory)) {
            say(chapter.where, `directory is not '<nn>_<prefix>' — ${chapter.directory}`);
            continue;
        }
        if (numbers.has(chapter.number)) {
            say(chapter.where, `number ${chapter.number} is used twice`);
        }
        numbers.add(chapter.number);
        if (!chapter.title) say(chapter.where, "'title' is missing");
        if (!chapter.intro) say(chapter.where, 'has no introduction');
        // A chapter with no entries renders as a heading over nothing, which is
        // what a directory left behind after its last requirement moved looks
        // like. Silence there would publish the hole.
        if (chapter.entries.length === 0) say(chapter.where, 'has no requirements');
    }

    // Chapter numbers are read as an order, so a gap is not cosmetic: the
    // document would skip from 7 to 9 and a reader would look for what is
    // missing instead of reading on.
    const actual = catalogue.chapters.map((chapter) => chapter.number);
    const expected = actual.map((_, index) => index + 1);
    if (String(actual) !== String(expected)) {
        say(
            'requirements/',
            `chapter numbers are ${actual.join(', ')}, expected 1..${actual.length}`,
        );
    }
}

function checkEntry(entry, chapter, byId, say) {
    const { where } = entry;
    if (!HEADING.test(entry.heading)) {
        // The em dash is not decoration here: it is what separates the
        // identifier from the title, and a hyphen in its place leaves an entry
        // with no identifier at all.
        say(where, `heading is not '### SC-<CHAPTER>-<NNN> — <title>' — ${entry.heading}`);
        return;
    }
    if (entry.prefix.toLowerCase() !== chapter.prefix) {
        say(where, `'${entry.id}' does not belong in chapter '${chapter.directory}'`);
    }
    if (!entry.title.trim()) say(where, `'${entry.id}' has an empty title`);

    if (entry.sources.length === 0) {
        say(where, `'${entry.id}' has no '_Source:_' line`);
    } else if (entry.sources.length > 1) {
        say(where, `'${entry.id}' has ${entry.sources.length} '_Source:_' lines`);
    }

    for (const line of entry.lines) {
        if (MARKER_LIKE.test(line) && !SOURCE.test(line)) {
            say(where, `'${entry.id}' carries an unknown marker line — ${line}`);
        }
        // A relative link is right in exactly one of the two places this text
        // is read. Written to resolve from the published page it is broken in
        // the file somebody edits, and the other way round. The catalogue names
        // a document as a code-formatted path 174 times and as a link twice;
        // the path is right in both places and misleads in neither.
        for (const [, target] of line.matchAll(REPO_LINK)) {
            say(where, `'${entry.id}' links to '${target}' — name the file as \`path\` instead`);
        }
    }

    // The promise text is optional, and deliberately so: the preamble asks for
    // a reason only "where a requirement has a reason that is not obvious from
    // the requirement itself". Nineteen entries state the whole promise in
    // their heading and would only repeat it below.
    checkState(entry, say);
    if (RETIRED.has(entry.status)) checkRetired(entry, byId, say);
}

/**
 * Which claims a state is allowed to make alongside itself.
 *
 * Each combination refused below is one that says two things at once. A draft
 * that is "decided, not yet delivered" is decided and not decided; a retired
 * entry with a delivery claim describes the present tense of something that no
 * longer holds. Nothing else would notice: the document renders every one of
 * them, and a reader would be left working out which half to believe.
 */
function checkState(entry, say) {
    const { where, status } = entry;
    if (!STATES.has(status)) {
        say(where, `'${entry.id}' has an unknown state '${status}'`);
        return;
    }
    if (status !== 'current' && !entry.delivered) {
        say(
            where,
            `'${entry.id}' is ${status} and also marked as decided-but-not-delivered. ` +
                'That claim belongs to a promise that stands.',
        );
    }
    // A colour that disagrees with its words is worse than no colour: it is
    // read faster than the words are, so the reader who trusts it is the one
    // who is misled. Missing is refused for the same reason — a retired entry
    // with no colour reads as ordinary in a scan.
    if (status !== 'current' && entry.icon !== ICONS[status]) {
        say(
            where,
            `'${entry.id}' is ${status} but opens with ${entry.icon ?? 'no colour'}, not ${ICONS[status]}`,
        );
    }
    if (!entry.delivered && entry.pendingIcon !== ICONS.pending) {
        say(
            where,
            `'${entry.id}' is not yet delivered but marks it with ` +
                `${entry.pendingIcon ?? 'no colour'}, not ${ICONS.pending}`,
        );
    }

    // A state marker that nearly matches is the dangerous one. `_(Draft.)_`
    // with no date, `_(Obsolete.)_`, a supersession missing its successor —
    // each reads as a state to a person and as ordinary prose to the parser, so
    // the entry counts as a promise that stands. Same failure as `_Sources:_`,
    // one line further down.
    //
    // The colour is part of what nearly matches. `🟢 _(Draft since …)_` uses a
    // colour no state has, so the state patterns miss it — and a check for text
    // beginning `_(` misses it too, because the colour is in the way.
    if (NEARLY_A_STATE.test(entry.text)) {
        const shown = entry.text.slice(0, entry.text.indexOf(')_') + 2) || entry.text.slice(0, 40);
        say(where, `'${entry.id}' opens with something shaped like a state — ${shown}`);
    }
}

function checkRetired(entry, byId, say) {
    const { where } = entry;
    if (entry.status !== 'superseded') return;

    // The successor is the entire value of superseding rather than withdrawing:
    // it is what a reader arriving from an old reference follows. Without a
    // successor that resolves, the two states are the same state.
    if (entry.supersededBy === entry.id) {
        say(where, `'${entry.id}' is superseded by itself`);
        return;
    }
    const successor = byId.get(entry.supersededBy);
    if (!successor) {
        say(where, `'${entry.id}' names successor '${entry.supersededBy}', which does not exist`);
        return;
    }
    if (successor.status === 'withdrawn') {
        say(where, `'${entry.id}' names successor '${successor.id}', which is withdrawn`);
        return;
    }
    // A chain is legitimate — a promise can be reworded twice — but it has to
    // end. A cycle would send a reader in circles and a walker into a loop.
    const seen = new Set([entry.id]);
    let current = successor;
    while (current?.status === 'superseded') {
        if (seen.has(current.id)) {
            say(where, `'${entry.id}' starts a supersession chain that loops at '${current.id}'`);
            return;
        }
        seen.add(current.id);
        current = byId.get(current.supersededBy);
    }
}

/**
 * Numbering is checked per chapter and against the set, not the order.
 *
 * Two entries in this catalogue sit beside what they qualify rather than in
 * numeric order, which is how a reader wants them. What must hold is that the
 * numbers run 001..N with nothing skipped: a gap is either an entry deleted
 * where it should have been superseded, or a number about to be handed out
 * twice.
 */
function checkNumbering(chapter, say) {
    const numbers = chapter.entries.map((entry) => entry.number).filter((n) => n !== null);
    const sorted = [...numbers].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] === i + 1) continue;
        say(chapter.where, `numbering skips from ${sorted[i - 1] ?? 0} to ${sorted[i]}`);
        return;
    }
}

/**
 * In-document links, checked across the whole catalogue rather than per file.
 *
 * A chapter file is a fragment of one page, so an anchor into another chapter
 * is correct where it lands and unresolvable where it is written — which is why
 * MD051 is off for these sources and this check is on.
 */
function checkFragments(catalogue, say) {
    const anchors = new Set([
        ...catalogue.entries.map((entry) => anchor(entry.heading)),
        ...catalogue.chapters.map((chapter) => anchor(`## ${chapter.number}. ${chapter.title}`)),
    ]);
    for (const chapter of catalogue.chapters) {
        for (const [, fragment] of chapter.body.matchAll(/\]\(#([^)]+)\)/g)) {
            if (!anchors.has(fragment))
                say(chapter.where, `links to '#${fragment}', which is no heading`);
        }
    }
}

function checkReferences(catalogue, byId, say) {
    for (const entry of catalogue.entries) {
        for (const reference of entry.references) {
            const target = byId.get(reference);
            if (!target) {
                say(entry.where, `'${entry.id}' refers to '${reference}', which does not exist`);
                continue;
            }
            // Identifiers are never reused so that a reference from outside
            // cannot quietly come to mean something else. A reference from
            // inside is held to more: it has to be right, and a promise leaning
            // on one that is no longer in force is not.
            if (entry.status === 'current' && RETIRED.has(target.status)) {
                say(
                    entry.where,
                    `'${entry.id}' refers to '${reference}', which is ${target.status}` +
                        (target.supersededBy ? ` — see '${target.supersededBy}'` : ''),
                );
            }
        }
    }
}
