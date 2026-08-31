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

import { anchor, HEADING, ICONS, PROOF_BEGIN, PROOF_END, SOURCE } from './parse.mjs';

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
        ...standing(chapters.flatMap((chapter) => chapter.entries)),
        '',
        END,
    ].join('\n');
}

/**
 * Where the catalogue stands, and which entries are not ordinary.
 *
 * A per-chapter column of what is not yet delivered would read `0` in twenty of
 * twenty-four rows and say less than one sentence does. The zeroes are kept in
 * the sentence on purpose: "none withdrawn" is a fact about a catalogue this
 * young, and it stops being true the day it stops being true.
 *
 * The lists under it are the reason this exists at all. Ten entries in three
 * thousand lines are visible once you reach them and unfindable before that,
 * and "what has this product promised and not yet built" is a question somebody
 * asks before they buy rather than while they scroll.
 */
function standing(entries) {
    const of = (predicate) => entries.filter(predicate);
    const counted = [
        [ICONS.current, of((e) => e.status === 'current' && e.delivered).length, 'stand today'],
        [
            ICONS.pending,
            of((e) => e.status === 'current' && !e.delivered).length,
            'decided but not yet delivered',
        ],
        [ICONS.draft, of((e) => e.status === 'draft').length, 'drafts'],
        [ICONS.superseded, of((e) => e.status === 'superseded').length, 'superseded'],
        [ICONS.withdrawn, of((e) => e.status === 'withdrawn').length, 'withdrawn'],
    ];

    const listed = [
        [
            ICONS.pending,
            'Decided, not yet delivered',
            of((e) => e.status === 'current' && !e.delivered),
        ],
        [ICONS.draft, 'Drafts', of((e) => e.status === 'draft')],
        [ICONS.superseded, 'Superseded', of((e) => e.status === 'superseded')],
        [ICONS.withdrawn, 'Withdrawn', of((e) => e.status === 'withdrawn')],
    ].filter(([, , found]) => found.length > 0);

    // Wrapped like the lists below it: Prettier leaves prose as it finds it, so
    // an unbroken sentence with five counts in it would fail the line-length
    // rule the rest of the repository keeps.
    const summary = wrap(
        `Of ${entries.length} entries: `,
        counted.map(([icon, count, what]) => `${icon} ${count} ${what}`),
    );

    return [
        ...summary.slice(0, -1),
        `${summary.at(-1)}.`,
        ...listed.flatMap(([icon, title, found]) => [
            '',
            ...wrap(
                `${icon} **${title}** — `,
                found.map((e) => `[${e.id}](#${anchor(e.heading)})`),
            ),
        ]),
    ];
}

/**
 * One paragraph of links, broken before the hundredth column.
 *
 * Prettier leaves prose exactly as it is found (`proseWrap: preserve`), so
 * whatever this writes is what ships — and an unbroken line of forty links
 * would fail the Markdown line-length rule the rest of the repository keeps.
 */
function wrap(prefix, items, width = 100) {
    const lines = [];
    let line = prefix;
    for (const [index, item] of items.entries()) {
        const piece = index === items.length - 1 ? item : `${item},`;
        if (line !== prefix && `${line} ${piece}`.length > width) {
            lines.push(line);
            line = piece;
        } else {
            line = line === prefix ? prefix + piece : `${line} ${piece}`;
        }
    }
    lines.push(line);
    return lines;
}

/**
 * The cases that prove one entry, written under it.
 *
 * At the requirement, because that is where the question is asked: a command
 * that prints the same list answers it somewhere else, and somewhere else is
 * where nobody is standing when they need it. Grouped by file, since that is
 * what a reader opens, and named exactly as the test runner prints them so the
 * name is the way back to the case.
 */
/**
 * A case name as Markdown, with its angle brackets made safe.
 *
 * Test names quote the markup they are about — `renders no <main>` — and
 * Markdown reads that as an HTML tag, which the linter refuses in prose. The
 * escape renders to the same characters a reader sees, so the name still says
 * what the test runner prints.
 */
const escaped = (name) => name.replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function proofBlock(cases) {
    if (cases.length === 0) return '';

    // File, then block, then case — three levels rather than one, because the
    // block title repeated on every case is most of the line and none of the
    // information, and the lines then outrun the width the rest of the
    // documentation keeps.
    const byFile = new Map();
    for (const one of cases) {
        const [block, name] = one.case.includes(' › ')
            ? [
                  one.case.slice(0, one.case.indexOf(' › ')),
                  one.case.slice(one.case.indexOf(' › ') + 3),
              ]
            : ['', one.case];
        if (!byFile.has(one.file)) byFile.set(one.file, new Map());
        const blocks = byFile.get(one.file);
        if (!blocks.has(block)) blocks.set(block, []);
        blocks.get(block).push(name);
    }

    const lines = [PROOF_BEGIN, '', '_Tested by:_', ''];
    for (const [file, blocks] of byFile) {
        lines.push(`- \`${file}\``);
        for (const [block, names] of blocks) {
            const indent = block ? '        ' : '    ';
            if (block) lines.push(`    - ${escaped(block)}`);
            for (const name of names) lines.push(...wrapped(`${indent}- `, escaped(name)));
        }
    }
    lines.push('', PROOF_END);
    return lines.join('\n');
}

/**
 * A chapter with every entry's proof block rewritten from the annotations.
 *
 * The block is cut out and put back rather than edited in place, so an entry
 * that has lost its last test loses its block with it instead of keeping a
 * stale one.
 */
/**
 * A list item that outruns the width, broken with a hanging indent.
 *
 * Test names are written by whoever wrote the test and some are long. Shortening
 * one here would break the only way back to the case, so the line wraps instead
 * — which is what the rest of the documentation does and what the linter asks.
 */
function wrapped(prefix, text, width = 100) {
    const hang = ' '.repeat(prefix.length);
    const lines = [];
    let line = prefix;
    for (const word of text.split(' ')) {
        const candidate = line.trimEnd() === prefix.trimEnd() ? line + word : `${line} ${word}`;
        if (candidate.length > width && line.trimEnd() !== prefix.trimEnd()) {
            lines.push(line);
            line = hang + word;
        } else {
            line = candidate;
        }
    }
    lines.push(line);
    return lines;
}

export function withProofs(text, casesById) {
    const lines = text.split('\n');
    const out = [];
    let id = null;

    for (let at = 0; at < lines.length; at++) {
        const line = lines[at];
        const heading = HEADING.exec(line);
        if (heading) id = heading[1];

        if (line.trim() === PROOF_BEGIN) {
            // Drop the old block; the fresh one is written after `_Source:_`.
            while (at < lines.length && lines[at].trim() !== PROOF_END) at++;
            // And the blank line that separated it.
            if (out.at(-1) === '') out.pop();
            continue;
        }

        out.push(line);
        if (!SOURCE.test(line) || !id) continue;
        const block = proofBlock(casesById.get(id) ?? []);
        if (block) out.push('', block);
        id = null;
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function withChapterTable(text, chapters) {
    // One opening, one closing, in that order. Reversed, the two slices overlap
    // and the prose between them is written twice; doubled, they choose a
    // region nobody meant. Both leave the file looking as though it carries the
    // markers, which is all the checker was asking.
    const opens = occurrences(text, BEGIN);
    const closes = occurrences(text, END);
    if (opens.length !== 1 || closes.length !== 1 || opens[0] > closes[0]) return null;
    return text.slice(0, opens[0]) + renderChapters(chapters) + text.slice(closes[0] + END.length);
}

/**
 * Whether a file carries the generated region, asked once for both readers.
 *
 * The checker counted files containing both markers and the renderer required
 * an ordered pair, so a reversed or doubled pair read as a carrier to one and
 * not to the other: the check passed, the splice was declined, and the table
 * went stale in silence.
 */
export function carriesChapterTable(text) {
    const opens = occurrences(text, BEGIN);
    const closes = occurrences(text, END);
    return opens.length === 1 && closes.length === 1 && opens[0] < closes[0];
}

function occurrences(text, marker) {
    const found = [];
    for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + 1)) {
        found.push(at);
    }
    return found;
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
