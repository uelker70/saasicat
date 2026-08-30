// Assembles `docs/requirements.md` from the sources under `requirements/`.
//
// A concatenation and nothing more: the preamble, a note saying where the page
// comes from, then each chapter's heading over its body verbatim. The heading
// is the one thing rendered rather than copied, because its number lives in
// front matter — renumbering a chapter then moves it without touching a word of
// what it says.
//
// Everything else is deliberately not transformed. A generator that rewrote the
// prose would need a second reader to tell whether it had rewritten it
// faithfully, and the only honest way to have no such gap is to have no
// transformation.

export const BEGIN =
    '<!-- BEGIN chapters — generated, do not edit: node scripts/requirements/index.mjs --write -->';
export const END = '<!-- END chapters -->';

export const GENERATED_NOTE = (count) =>
    `Generated from \`requirements/\` — ${count} requirements. Do not edit by hand:\n` +
    '`node scripts/requirements/index.mjs --write`.';

/**
 * The chapter table, written into the source file that asks for it.
 *
 * It answers the question both readers arrive with: which chapter owns
 * `SC-PROMO-…`, where does chapter 11 sit, and where is the weight. Somebody
 * editing the sources needs that answer without opening twenty-four files, so
 * the table lives in `requirements/` beside the prose that explains how an
 * entry is built, rather than only in the page those files become.
 *
 * Maintained by hand it would be the one part of the document that could
 * quietly stop being true. A chapter renamed, renumbered or added rewrites it
 * in the same run — and an edit inside the markers is reported as drift and
 * then overwritten, which is what the markers say.
 */
export function renderChapters(chapters) {
    return [
        BEGIN,
        '',
        '| # | Chapter | Identifiers | Entries |',
        '| --- | --- | --- | --- |',
        ...chapters.map(
            (chapter) =>
                `| ${chapter.number} | ${chapter.title} | ` +
                `\`SC-${chapter.prefix.toUpperCase()}-…\` | ${chapter.entries.length} |`,
        ),
        '',
        standing(chapters.flatMap((chapter) => chapter.entries)),
        '',
        END,
    ].join('\n');
}

/**
 * One line of where the catalogue stands, rather than a column of zeroes.
 *
 * A per-chapter count of what is not yet delivered would be `0` in twenty of
 * twenty-four rows and would say less than this sentence does. The zeroes are
 * kept here on purpose: "none withdrawn" is a fact about a catalogue this
 * young, and it stops being true the day it stops being true.
 */
function standing(entries) {
    const count = (predicate) => entries.filter(predicate).length;
    const parts = [
        `${count((entry) => entry.status === 'current' && entry.delivered)} stand today`,
        `${count((entry) => entry.status === 'current' && !entry.delivered)} decided but not yet delivered`,
        `${count((entry) => entry.status === 'draft')} drafts`,
        `${count((entry) => entry.status === 'superseded')} superseded`,
        `${count((entry) => entry.status === 'withdrawn')} withdrawn`,
    ];
    return `Of ${entries.length} entries: ${parts.join(', ')}.`;
}

/**
 * Replaces the generated region of a front-matter file with a fresh table.
 *
 * The file is found by carrying the marker rather than by name, so renaming or
 * renumbering it moves the table with it and needs no second edit here.
 */
export function withChapterTable(text, chapters) {
    const from = text.indexOf(BEGIN);
    const to = text.indexOf(END);
    if (from === -1 || to === -1) return null;
    return text.slice(0, from) + renderChapters(chapters) + text.slice(to + END.length);
}

/**
 * The region markers do their work in the source and have none here.
 *
 * They tell whoever opens `02_structure.md` that the table below them is
 * rewritten by a command, which is worth saying there and nowhere else — the
 * published page has no region to delimit, already says in prose that it is
 * generated, and is read by people with no reason to meet the tooling. Dropping
 * two comment lines leaves every other guarantee intact: no requirement text is
 * touched on the way here, which is the property that matters.
 */
const withoutMarkers = (text) =>
    text
        .split('\n')
        .filter((line) => line !== BEGIN && line !== END)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n');

export function render(catalogue) {
    const parts = [
        catalogue.preamble.map((file) => withoutMarkers(file.text)).join('\n\n'),
        '',
        GENERATED_NOTE(catalogue.entries.length),
    ];
    for (const chapter of catalogue.chapters) {
        parts.push('', `## ${chapter.number}. ${chapter.title}`, '', chapter.body);
    }
    return `${parts.join('\n')}\n`;
}
