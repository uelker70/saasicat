// `docs/requirements.md` is derived, and this is what keeps it so.
//
// Same pattern as `reference-pages-are-generated`, for a different reason. That
// page falls behind the code it describes; this one fell behind its own
// conventions. The catalogue was written by one person in one sitting and held
// to every rule its preamble states — identifiers unique and never reused,
// numbering that does not skip, a source on every entry — because that person
// remembered them, not because anything insisted. The first entry added under
// time pressure is where a convention nobody enforces stops being one.
//
// The counter-proofs below matter more than the two tests above them. A checker
// that never rejects anything passes a clean catalogue exactly as well as a
// correct one does, and there is no way to tell the two apart by watching it
// succeed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    catalogueOf,
    entriesIn,
    frontMatter,
    readCatalogue,
} from '../scripts/requirements/parse.mjs';
import { BEGIN, END } from '../scripts/requirements/render.mjs';
import { check } from '../scripts/requirements/check.mjs';
import { ROOT, TARGET, renderCatalogue } from '../scripts/requirements/index.mjs';

// Rendered on first use, not in the `describe` callback: `node --test` exits 0
// when a describe body throws, so a parser that refused to read the sources
// would mark the suite ✖ and still report a successful run.
let pending;
const rendered = () => (pending ??= renderCatalogue());

describe('the requirements document is generated, not maintained', () => {
    test('the sources yield a catalogue worth checking', async () => {
        const { catalogue } = await rendered();
        // Vacuously true on an empty catalogue, which is what a moved directory
        // or a failed read produces — and every assertion below would hold.
        assert.ok(catalogue.chapters.length >= 20, `only ${catalogue.chapters.length} chapters`);
        assert.ok(catalogue.entries.length >= 300, `only ${catalogue.entries.length} requirements`);
        assert.ok(catalogue.entries.every((entry) => entry.id));
    });

    test('the document on disk is what the generator produces', async () => {
        const { text } = await rendered();
        assert.equal(
            readFileSync(join(ROOT, TARGET), 'utf8'),
            text,
            `${TARGET} differs from its sources.\n` +
                'Run: node scripts/requirements/index.mjs --write',
        );
    });

    test('the index names every entry that is not ordinary', async () => {
        // Ten entries in three thousand lines are visible once you reach them
        // and unfindable before that. Without the list, "what has this product
        // promised and not yet built" is answered by scrolling.
        const { catalogue, text } = await rendered();
        const pending = catalogue.entries.filter((e) => e.status === 'current' && !e.delivered);
        assert.ok(pending.length > 0, 'no undelivered entries to index');
        for (const entry of pending) {
            assert.ok(text.includes(`[${entry.id}](#`), `${entry.id} is not in the index`);
        }
        // The counter-proof: the ordinary ones are not listed, or the index
        // would be the catalogue again.
        assert.ok(!text.includes(`[${catalogue.entries.find((e) => e.delivered).id}](#`));
    });

    test('the region markers stay in the sources', async () => {
        // They tell whoever opens the source that the table is rewritten by a
        // command. The published page has no region to delimit and is read by
        // people with no reason to meet the tooling — and it already says in
        // prose that it is generated.
        const { text } = await rendered();
        assert.ok(!text.includes(BEGIN), 'the document carries the opening marker');
        assert.ok(!text.includes(END), 'the document carries the closing marker');
        // The counter-proof: dropping the markers must not drop the table.
        assert.match(text, /^## Chapters and identifiers$/m);
        assert.match(text, /\|\s+3\s+\|\s+Plans and their versions\s+\|/);
    });

    test('the page and the source it was spliced into say the same thing', async () => {
        // They are produced in one run from one catalogue, and used to
        // disagree: the region was written from the fresh chapters and the page
        // from what had been on disk before it. `--write` then needed a second
        // run to converge, which somebody eventually does not do.
        const { files, text } = await rendered();
        const summary = /^Of \d+ entries: .*$/m;
        assert.match(files[0].text, summary);
        assert.equal(summary.exec(files[0].text)[0], summary.exec(text)[0]);
    });

    test('the generated region inside the sources is current too', async () => {
        // The chapter table is written into a source file, so it can go stale
        // where the document cannot: a chapter added, renamed or renumbered
        // leaves the table describing the catalogue as it was.
        const { files } = await rendered();
        assert.equal(files.length, 1, `${files.length} files carry a generated region`);
        for (const file of files) {
            assert.equal(
                readFileSync(join(ROOT, file.where), 'utf8'),
                file.text,
                `${file.where} differs from its sources.\n` +
                    'Run: node scripts/requirements/index.mjs --write',
            );
        }
    });

    test('the sources satisfy every rule the checker can state', () => {
        assert.deepEqual(check(readCatalogue(ROOT)), []);
    });
});

describe('the parser reads the entry, not the prose around it', () => {
    test('a value keeps its colons, quotes and backticks', () => {
        const { fields } = frontMatter('---\ntitle: A plan: `what` it "means"\n---\n\nBody.', 'x');
        assert.equal(fields.title, 'A plan: `what` it "means"');
    });

    test('front matter that never closes is an error, not an empty chapter', () => {
        // Returning nothing here would drop a whole chapter from the catalogue,
        // and the document would be published with the hole in it.
        assert.throws(() => frontMatter('---\nnumber: 1\n\n## 1. Title', 'x'), /not closed/);
    });

    test('a heading with a hyphen is kept as an entry with no identifier', () => {
        // Folding it into the entry above would hide it from every check,
        // including the one that notices identifiers going missing.
        const { entries } = entriesIn('### SC-A-001 - Title\n\n_Source:_ #1', 'x', 1);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].id, undefined);
    });

    test('dependencies come from the prose, and never point at the entry itself', () => {
        const chapter = parse(
            '### SC-A-001 — T\n\nAs SC-A-002 says, and SC-A-001 too.\n\n_Source:_ #1',
        );
        assert.deepEqual(chapter.entries[0].references, ['SC-A-002']);
    });

    test('a draft is read from its own first words', () => {
        const chapter = parse(
            '### SC-A-001 — T\n\n⚪ _(Draft since 2026-09-01.)_ Proposed wording.\n\n_Source:_ #1',
        );
        assert.equal(chapter.entries[0].status, 'draft');
        assert.equal(chapter.entries[0].text, 'Proposed wording.');
    });

    test('a marker wrapped across a line still counts', () => {
        // These files are wrapped by hand at a hundred columns, and two
        // committed entries wrapped this marker across the break. They read as
        // delivered, vanished from the index of what is not built yet, and
        // nothing asked why they carried no colour — the colour check could not
        // see a marker the parser had not found.
        const [entry] = parse(
            '### SC-A-001 — T\n\nProse that runs on. 🟡 _(Decided, not\nyet delivered.)_\n\n' +
                '_Source:_ #1',
        ).entries;
        assert.equal(entry.delivered, false);
        assert.equal(entry.text, 'Prose that runs on.');
    });

    test('an entry with no marker is current and delivered', () => {
        // The default is silence, so the ordinary entry carries no marker at
        // all. Requiring one would put 389 of them into a document people read.
        const [entry] = parse('### SC-A-001 — T\n\nProse.\n\n_Source:_ #1').entries;
        assert.equal(entry.status, 'current');
        assert.equal(entry.delivered, true);
    });

    test('a retired entry is read from its own first words', () => {
        const chapter = parse(
            '### SC-A-001 — T\n\n🔵 _(Superseded on 2026-09-01 by `SC-A-002`.)_ Old wording.\n\n' +
                '_Source:_ #1\n\n### SC-A-002 — T\n\nNew wording.\n\n_Source:_ #2',
        );
        const [first] = chapter.entries;
        assert.equal(first.status, 'superseded');
        assert.equal(first.supersededBy, 'SC-A-002');
        assert.equal(first.text, 'Old wording.');
    });
});

describe('the checks refuse what the conventions used to leave to care', () => {
    const complains = (chapters, expected, front) => {
        const problems = check(front ? catalogueOf(chapters, front) : catalogueOf(chapters));
        assert.ok(
            problems.some((problem) => problem.includes(expected)),
            `expected a problem mentioning ${JSON.stringify(expected)}, got ${JSON.stringify(problems)}`,
        );
    };

    test('a clean chapter is accepted', () => {
        // The counter-proof to every case below: without it they would all pass
        // against a checker that rejects everything.
        assert.deepEqual(check(catalogueOf([['01_a', chapter(['SC-A-001', 'SC-A-002'])]])), []);
    });

    test('an identifier used twice', () => {
        complains([['01_a', chapter(['SC-A-001', 'SC-A-001'])]], 'is also at');
    });

    test('a heading with a hyphen instead of an em dash', () => {
        complains([['01_a', `${head()}\n### SC-A-001 - Title\n\n_Source:_ #1`]], 'heading is not');
    });

    test('an entry with no source', () => {
        complains([['01_a', `${head()}\n### SC-A-001 — Title\n\nProse.`]], "has no '_Source:_'");
    });

    test('an entry with two sources', () => {
        complains(
            [['01_a', `${head()}\n### SC-A-001 — Title\n\n_Source:_ #1\n\n_Source:_ #2`]],
            "has 2 '_Source:_'",
        );
    });

    test('a marker line with a letter too many', () => {
        // `_Sources:_` reads correctly and matches nothing. Without this check
        // the entry would have no source and no complaint about it either.
        complains(
            [['01_a', `${head()}\n### SC-A-001 — Title\n\n_Sources:_ #1\n\n_Source:_ #1`]],
            'unknown marker line',
        );
    });

    test('a number skipped inside a chapter', () => {
        complains([['01_a', chapter(['SC-A-001', 'SC-A-003'])]], 'numbering skips');
    });

    test('an entry filed under the wrong chapter', () => {
        complains([['01_a', chapter(['SC-A-001', 'SC-B-002'])]], 'does not belong in chapter');
    });

    test('a reference to an identifier that does not exist', () => {
        complains(
            [['01_a', `${head()}\n### SC-A-001 — Title\n\nAs SC-A-404 says.\n\n_Source:_ #1`]],
            "refers to 'SC-A-404', which does not exist",
        );
    });

    test('a promise leaning on one that no longer holds', () => {
        complains(
            [
                [
                    'a',
                    `${head()}\n### SC-A-001 — Title\n\n` +
                        '🔵 _(Superseded on 2026-09-01 by `SC-A-002`.)_ Old.\n\n_Source:_ #1\n\n' +
                        '### SC-A-002 — Title\n\nNew.\n\n_Source:_ #2\n\n' +
                        '### SC-A-003 — Title\n\nRests on SC-A-001.\n\n_Source:_ #3',
                ],
            ],
            "which is superseded — see 'SC-A-002'",
        );
    });

    test('a successor that does not exist', () => {
        complains(
            [
                [
                    'a',
                    `${head()}\n### SC-A-001 — Title\n\n` +
                        '🔵 _(Superseded on 2026-09-01 by `SC-A-404`.)_ Old.\n\n_Source:_ #1',
                ],
            ],
            'which does not exist',
        );
    });

    test('a promise superseded by a draft', () => {
        // A promise replaced by something nobody has decided is a promise
        // removed with nothing in its place — a withdrawal wearing a redirect,
        // and it reads to whoever follows the trail as though there were
        // something to follow it to.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\n` +
                        '🔵 _(Superseded on 2026-09-01 by `SC-A-002`.)_ Old.\n\n_Source:_ #1\n\n' +
                        '### SC-A-002 — Title\n\n⚪ _(Draft since 2026-09-01.)_ Proposed.\n\n' +
                        '_Source:_ #2',
                ],
            ],
            'which is draft',
        );
    });

    test('a chain that ends where nothing stands', () => {
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\n` +
                        '🔵 _(Superseded on 2026-09-01 by `SC-A-002`.)_ One.\n\n_Source:_ #1\n\n' +
                        '### SC-A-002 — Title\n\n' +
                        '🔵 _(Superseded on 2026-09-02 by `SC-A-003`.)_ Two.\n\n_Source:_ #2\n\n' +
                        '### SC-A-003 — Title\n\n🔴 _(Withdrawn on 2026-09-03.)_ Three.\n\n' +
                        '_Source:_ #3',
                ],
            ],
            'which is withdrawn',
        );
    });

    test('a chain that arrives at a promise that stands is accepted', () => {
        // The counter-proof: superseding twice is legitimate, and the rule must
        // not refuse a chain that ends somewhere real.
        assert.deepEqual(
            check(
                catalogueOf([
                    [
                        '01_a',
                        `${head()}\n### SC-A-001 — Title\n\n` +
                            '🔵 _(Superseded on 2026-09-01 by `SC-A-002`.)_ One.\n\n_Source:_ #1\n\n' +
                            '### SC-A-002 — Title\n\n' +
                            '🔵 _(Superseded on 2026-09-02 by `SC-A-003`.)_ Two.\n\n_Source:_ #2\n\n' +
                            '### SC-A-003 — Title\n\nThree.\n\n_Source:_ #3',
                    ],
                ]),
            ),
            [],
        );
    });

    test('a supersession chain that loops', () => {
        // Two entries pointing at each other: a reader following the trail
        // never arrives, and a walker without this guard never returns.
        complains(
            [
                [
                    'a',
                    `${head()}\n### SC-A-001 — Title\n\n` +
                        '🔵 _(Superseded on 2026-09-01 by `SC-A-002`.)_ One.\n\n_Source:_ #1\n\n' +
                        '### SC-A-002 — Title\n\n' +
                        '🔵 _(Superseded on 2026-09-02 by `SC-A-001`.)_ Two.\n\n_Source:_ #2',
                ],
            ],
            'loops at',
        );
    });

    test('a chapter number that skips', () => {
        complains(
            [
                ['01_a', chapter(['SC-A-001'])],
                ['03_b', chapter(['SC-B-001'])],
            ],
            'chapter numbers are',
        );
    });

    test('an anchor that lands on no heading', () => {
        // Chapter files are fragments of one page, so an anchor into another
        // chapter is unresolvable where it is written and correct where it
        // lands. MD051 is off for these sources because it can only see one
        // file; this is what replaces it.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\nSee [that](#sc-a-404-gone).\n\n_Source:_ #1`,
                ],
            ],
            "links to '#sc-a-404-gone'",
        );
    });

    test('an anchor across chapters resolves', () => {
        // The counter-proof: without it the check above would pass against one
        // that rejects every fragment, and the two real links in the catalogue
        // would have had to go.
        assert.deepEqual(
            check(
                catalogueOf([
                    [
                        '01_a',
                        `${head()}\n### SC-A-001 — Title\n\n` +
                            'See [that](#sc-b-001--title).\n\n_Source:_ #1',
                    ],
                    ['02_b', chapter(['SC-B-001'])],
                ]),
            ),
            [],
        );
    });

    test('a draft that also claims to be decided but not delivered', () => {
        // It would be decided and not decided at once. The document renders
        // both markers happily and leaves a reader to pick.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\n⚪ _(Draft since 2026-09-01.)_ Prose. ` +
                        '_(Decided, not yet delivered.)_\n\n_Source:_ #1',
                ],
            ],
            'also marked as decided-but-not-delivered',
        );
    });

    test('a colour that disagrees with its words', () => {
        // The colour is read faster than the words are, so a reader who trusts
        // it is the one who is misled. A wrong one is worse than none.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\n🔴 _(Draft since 2026-09-01.)_ Prose.\n\n` +
                        '_Source:_ #1',
                ],
            ],
            'opens with 🔴, not ⚪',
        );
    });

    test('a retired entry with no colour at all', () => {
        // It reads as ordinary in a scan, which is the one thing a retired
        // entry must never do.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\n_(Withdrawn on 2026-09-01.)_ Prose.\n\n` +
                        '_Source:_ #1',
                ],
            ],
            'opens with no colour, not 🔴',
        );
    });

    test('an undelivered promise with no colour', () => {
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\nProse. _(Decided, not yet delivered.)_\n\n` +
                        '_Source:_ #1',
                ],
            ],
            'marks it with no colour',
        );
    });

    test('a state marker appended after the prose', () => {
        // The near-miss check was anchored to the opening, so a marker written
        // at the end opened nothing and was never seen. The entry counted as
        // current and delivered, in the generated index and in the ratchet.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\nOld promise. ` +
                        '🔴 _(Withdrawn on 2026-09-01.)_\n\n_Source:_ #1',
                ],
            ],
            'opens with something shaped like a state',
        );
    });

    test('a colour with no space before its marker', () => {
        // `🔴_(Withdrawn …)_` matches no state pattern, because those ask for a
        // separator — and a near-miss check hard-coding one space missed it for
        // the same reason. The entry counted as an ordinary delivered promise
        // in the index and in the proof ratchet both.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\n🔴_(Withdrawn on 2026-09-01.)_ Gone.\n\n` +
                        '_Source:_ #1',
                ],
            ],
            'opens with something shaped like a state',
        );
    });

    test('a colour with two spaces before its marker still parses', () => {
        // The counter-proof: separators are whitespace, and asking for exactly
        // one is what created the case above.
        const [entry] = parse(
            '### SC-A-001 — T\n\n🔴  _(Withdrawn on 2026-09-01.)_ Gone.\n\n_Source:_ #1',
        ).entries;
        assert.equal(entry.status, 'withdrawn');
    });

    test('a state marker that nearly matches', () => {
        // `_(Draft since.)_` has no date, so it is not a draft — it is prose,
        // and the entry counts as a promise that stands. It reads as a draft to
        // everyone who opens the file. The date is not optional because the
        // risk a draft runs is time: one opened a year ago reads exactly like
        // one opened last week, and only one is still somebody's intention.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\n_(Draft since.)_ Prose.\n\n_Source:_ #1`,
                ],
            ],
            'opens with something shaped like a state',
        );
    });

    test('a state marker wearing a colour no state has', () => {
        // `🟢` belongs to no state, so the state patterns miss it — and a check
        // for text beginning `_(` misses it too, because the colour is in the
        // way. The entry then counts as an ordinary delivered promise.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\n🟢 _(Draft since 2026-09-01.)_ Prose.\n\n` +
                        '_Source:_ #1',
                ],
            ],
            'opens with something shaped like a state',
        );
    });

    test('an identifier with a digit missing', () => {
        // `SC-PLAN-04` matches the exact form nowhere, so nothing resolved it
        // and nothing complained — the broken identifier was published as
        // prose, and a reader following it found nothing.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\nSee SC-PLAN-04 for this.\n\n_Source:_ #1`,
                ],
            ],
            "names 'SC-PLAN-04', which is not an identifier",
        );
    });

    test('a link into the repository', () => {
        // A relative link is right in exactly one of the two places this text
        // is read: written to resolve from the published page it is broken in
        // the file somebody edits, and the other way round. The catalogue names
        // a document as a code-formatted path 174 times and as a link twice.
        complains(
            [
                [
                    '01_a',
                    `${head()}\n### SC-A-001 — Title\n\nSee [that](guides/x.md).\n\n_Source:_ #1`,
                ],
            ],
            "links to 'guides/x.md'",
        );
    });

    test('an anchor inside the document is still a link', () => {
        // The counter-proof: the rule must not eat the two cross-chapter
        // anchors the catalogue actually uses.
        assert.deepEqual(
            check(
                catalogueOf([
                    [
                        '01_a',
                        `${head()}\n### SC-A-001 — Title\n\nSee [that](#sc-a-002--title).\n\n` +
                            '_Source:_ #1\n\n### SC-A-002 — Title\n\nProse.\n\n_Source:_ #2',
                    ],
                ]),
            ),
            [],
        );
    });

    test('a state word nobody defined', () => {
        complains(
            [['01_a', `${head()}\n### SC-A-001 — Title\n\n_(Obsolete.)_ Prose.\n\n_Source:_ #1`]],
            'opens with something shaped like a state',
        );
    });

    test('a directory that does not say where it belongs', () => {
        // The position lives in the directory name and nowhere else, so a
        // directory without one has no place to be rendered in.
        complains([['plan', chapter(['SC-PLAN-001'])]], "directory is not '<nn>_<prefix>'");
    });

    test('nothing carrying the chapter table', () => {
        // Without it the table is simply absent, and nothing else here notices:
        // every chapter still renders, and the one page telling a reader which
        // chapter owns `SC-PROMO-…` has quietly stopped existing.
        complains([['01_a', chapter(['SC-A-001'])]], 'expected exactly 1', ['# No markers here']);
    });

    test('two files carrying it', () => {
        const both = `# Front\n\n${BEGIN}\n${END}`;
        complains([['01_a', chapter(['SC-A-001'])]], 'expected exactly 1', [both, both]);
    });

    test('markers in the wrong order', () => {
        // Both are present, so counting them accepted the file — while the
        // splice declined it, the table was never written, and it went stale in
        // silence. One question, asked by both readers.
        complains([['01_a', chapter(['SC-A-001'])]], 'expected exactly 1', [
            `# Front\n\n${END}\n${BEGIN}`,
        ]);
    });

    test('a doubled pair of markers', () => {
        complains([['01_a', chapter(['SC-A-001'])]], 'expected exactly 1', [
            `# Front\n\n${BEGIN}\n${END}\n\n${BEGIN}\n${END}`,
        ]);
    });

    test('Markdown that nothing reads', () => {
        // A name one character off is not read, and not being read has never
        // looked like anything: rename `01_roles.md` to `01-roles.md` and that
        // prose leaves the published document while every check stays green.
        const catalogue = catalogueOf([['01_a', chapter(['SC-A-001'])]]);
        catalogue.strays = ['requirements/00_preamble/01-roles.md'];
        assert.ok(
            check(catalogue).some((problem) => problem.includes('nothing reads')),
            'a file nothing reads was not reported',
        );
    });

    test('the file that is deliberately not published is not one', () => {
        // The counter-proof: `README.md` is the note to whoever edits, and a
        // rule that reported it would be one nobody could satisfy.
        assert.deepEqual(check(catalogueOf([['01_a', chapter(['SC-A-001'])]])), []);
    });

    test('nothing to open the document with', () => {
        // Every chapter would render perfectly well without it, and the page
        // would begin at "## 1." with no word about what an identifier means.
        // Nothing else here would notice.
        complains([['01_a', chapter(['SC-A-001'])]], 'no <nn>_<name>.md part', []);
    });

    test('a preamble part numbered out of sequence', () => {
        const catalogue = catalogueOf([['01_a', chapter(['SC-A-001'])]], ['# One', '# Two']);
        catalogue.preamble[1].number = 5;
        assert.ok(check(catalogue).some((problem) => problem.includes('is numbered 5')));
    });

    test('a chapter field nobody reads', () => {
        complains(
            [['01_a', `---\ntitle: T\nowner: me\n---\n\nIntro.\n\n${entry('SC-A-001')}`]],
            'unknown field',
        );
    });

    test('a chapter with a heading and nothing under it', () => {
        complains([['01_a', '---\ntitle: T\n---\n\nIntro.']], 'has no requirements');
    });
});

const head = () => '---\ntitle: Title\n---\n\nIntro.\n';
const entry = (id) => `### ${id} — Title\n\nProse.\n\n_Source:_ #1`;
const chapter = (ids) => `${head()}\n${ids.map(entry).join('\n\n')}`;
const parse = (body) => catalogueOf([['01_a', `${head()}\n${body}`]]).chapters[0];
