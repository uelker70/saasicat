// The page shell is a contract, not a convention.
//
// This repo already tried to hold the admin pages to one page structure using
// CSS class names (the theme's component layer), and it did not hold: of eighteen pages,
// seven adopted `.sa-page-head`, four copied it into their own BEM variants,
// four pushed the header into a sub-component, and one shipped its title in a
// `<div>` with no heading tag at all. A class name is advice. These tests are
// the part that bites.
//
// Two halves: the components keep their promises (one `<h1>`, a named
// `<section>`, no `<main>`), and no page quietly reintroduces the hand-written
// markup they replace.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';

import AdminHero from '../src/ui/page/AdminHero.vue';
import AdminPage from '../src/ui/page/AdminPage.vue';
import AdminSection from '../src/ui/page/AdminSection.vue';
import { mountWithQuasar } from './support/mount-with-quasar.js';

// Vite rewrites `import.meta.url` to an http:// URL in the transformed module,
// so the package root has to come from the runner's cwd, which vitest sets to
// the `root` in vitest.config.ts.
const SRC_DIR = resolve(process.cwd(), 'src');
// Pages and the page-private parts they own. Before the 4.1 move both lived
// under `pages-standard/`; they are the same set of views, split across two
// directories now, and the shell contract applies to all of them.
const PAGE_DIRS = [resolve(SRC_DIR, 'pages'), resolve(SRC_DIR, 'internal')];

// These render outside AdminLayout — the login, the first-run setup, the
// manifest error screen and the tenant onboarding configurator. Each owns its
// frame and its own single <h1>, and is deliberately out of the shell's scope.
//
// Out of the SHELL's scope, not out of the THEME's: three of them read as
// exempt from `.sa-page` as well, and so shipped with none of the theme's
// Quasar corrections. `tests/theme-reaches-every-page.test.js` asks that
// question separately, and exempts nothing on this list.
const NON_CONTENT_PAGES = new Set([
    'AdminLayout.vue',
    'AdminManifestErrorPage.vue',
    'SuperAdminLoginPage.vue',
    'SuperAdminSetupWizard.vue',
    'OnboardingConfigurator.vue',
]);

function contentPageFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.vue') && !NON_CONTENT_PAGES.has(entry.name)) {
                found.push(full);
            }
        }
    };
    for (const dir of PAGE_DIRS) walk(dir);
    return found.sort();
}

/** Every `.vue` under src that lives inside the admin shell. */
function allVueFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.vue') && !NON_CONTENT_PAGES.has(entry.name)) {
                found.push(full);
            }
        }
    };
    walk(SRC_DIR);
    return found.sort();
}

/** Event names from a `defineEmits<{ (e: 'x'): void }>()` block. */
function declaredEmits(source: string): string[] {
    const block = /defineEmits<\{([\s\S]*?)\}>\(\)/.exec(source);
    if (!block) return [];
    return [...block[1]!.matchAll(/\(e: '([\w:]+)'/g)].map((m) => m[1]!);
}

function kebab(name: string): string {
    return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Name of the directory a file sits in.
 *
 * `basename(dirname(…))`, never a split on '/': these paths come from `join()`,
 * which uses backslashes on Windows. A split would return an empty string
 * there, every directory-based rule below would stop matching, and the suite
 * would pass without checking anything — a guardrail that silently switches
 * itself off on one platform is worse than none.
 */
function dirName(file: string): string {
    return basename(dirname(file));
}

function stripComments(markup: string): string {
    // Applied until it stops changing: a single pass over `<!--<!-- -->-->`
    // leaves a `<!--` behind, and the leftover would carry whatever the inner
    // comment said back into the checks below.
    let current = markup;
    let previous: string;
    do {
        previous = current;
        current = current.replace(/<!--[\s\S]*?-->/g, '');
    } while (current !== previous);
    return current;
}

function templateOf(source: string): string {
    // Only the template matters here; a `<style>` block legitimately mentions
    // the class names this test forbids in markup, and a comment may well spell
    // out the very tag it is explaining why not to use.
    const start = source.indexOf('<template>');
    const end = source.lastIndexOf('</template>');
    if (start === -1 || end === -1) return '';
    return stripComments(source.slice(start, end));
}

/**
 * The other half of the file — both blocks of a `<script setup>` plus
 * `<script>` pair, joined. The blocks are cut out rather than taken as
 * everything after the first `<script`, so a `<style>` sheet and a template
 * that follows the script stay out of what is read as code.
 */
function scriptOf(source: string): string {
    return [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script[^>]*>/gi)]
        .map((block) => block[1]!)
        .join('\n');
}

describe('AdminHero', () => {
    test('renders the title as the page heading', () => {
        const wrapper = mountWithQuasar(AdminHero, { props: { title: 'Plans & versions' } });

        const headings = wrapper.findAll('h1');
        expect(headings).toHaveLength(1);
        expect(headings[0]!.text()).toBe('Plans & versions');
    });

    test('omits the subtitle and the actions bar when neither is supplied', () => {
        const wrapper = mountWithQuasar(AdminHero, { props: { title: 'Tenants' } });

        expect(wrapper.find('.sa-page-head__sub').exists()).toBe(false);
        expect(wrapper.find('.sa-page-head__actions').exists()).toBe(false);
    });

    test('renders a markup subtitle through the slot', () => {
        const wrapper = mountWithQuasar(AdminHero, {
            props: { title: 'PROMO-2026' },
            slots: { subtitle: '<code>percent</code>' },
        });

        expect(wrapper.find('.sa-page-head__sub code').text()).toBe('percent');
    });
});

describe('AdminSection', () => {
    test('names the section by pointing aria-labelledby at its own heading', () => {
        const wrapper = mountWithQuasar(AdminSection, { props: { title: 'Active plans' } });

        const section = wrapper.find('section');
        const heading = wrapper.find('h2');
        const labelledBy = section.attributes('aria-labelledby');

        expect(labelledBy).toBeTruthy();
        expect(heading.attributes('id')).toBe(labelledBy);
        expect(heading.text()).toBe('Active plans');
    });

    test('gives sibling sections distinct heading ids', () => {
        // The reason this is a component rather than a bare <section>: an
        // unnamed section is not a landmark, and naming one by hand needs an id
        // that is unique per instance. Two sections sharing an id would point
        // both labels at the first heading.
        const host = defineComponent({
            components: { AdminSection },
            render: () => [
                h(AdminSection, { title: 'First' }),
                h(AdminSection, { title: 'Second' }),
            ],
        });
        const wrapper = mountWithQuasar(host);

        const ids = wrapper.findAll('h2').map((el) => el.attributes('id'));
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
    });

    test('renders no heading level above h2', () => {
        const wrapper = mountWithQuasar(AdminSection, { props: { title: 'Audit' } });

        expect(wrapper.find('h1').exists()).toBe(false);
    });
});

describe('page shell contract', () => {
    test('the source sweep actually finds the pages it claims to check', () => {
        // Without this, a wrong cwd would turn every check below into a
        // vacuous pass over an empty file list.
        expect(contentPageFiles().length).toBeGreaterThan(15);
    });

    test('AdminPage renders no <main> — the landmark belongs to AdminLayout', () => {
        const wrapper = mountWithQuasar(AdminPage);

        expect(wrapper.find('main').exists()).toBe(false);
        expect(wrapper.find('.sa-page').exists()).toBe(true);
    });

    test('no content page renders its own <main> or a QPage', () => {
        // QPage renders a <main> of its own, so a page using it lands a second
        // landmark inside AdminLayout's — the exact nesting bug this shell
        // exists to prevent.
        const offenders = contentPageFiles().filter((file) => {
            const template = templateOf(readFileSync(file, 'utf8'));
            return /<main[\s>]/.test(template) || /<q-page[\s>]/.test(template);
        });

        expect(offenders.map((f) => relative(SRC_DIR, f))).toEqual([]);
    });

    test('no content page hand-writes the hero markup instead of using AdminHero', () => {
        const offenders = contentPageFiles().filter((file) =>
            /class="[^"]*\bsa-page-head\b/.test(templateOf(readFileSync(file, 'utf8'))),
        );

        expect(offenders.map((f) => relative(SRC_DIR, f))).toEqual([]);
    });

    test('AdminHero renders the only <h1> in the package', () => {
        // Components too, not just pages: the plan detail kept its heading in a
        // `PlanDetailHeader` child, so the page itself was clean while the
        // rendered page carried two competing <h1>s. Checking pages alone is
        // what let that survive — a header pushed one directory down is the
        // most likely place for the next one.
        const HERO = resolve(SRC_DIR, 'ui/page/AdminHero.vue');
        const offenders = allVueFiles()
            .filter((file) => file !== HERO)
            .filter((file) => /<h1[\s>]/.test(templateOf(readFileSync(file, 'utf8'))));

        expect(offenders.map((f) => relative(SRC_DIR, f))).toEqual([]);
    });

    test('no view renders its hero inside the page body', () => {
        // AdminBody insets its content by 20px, so a hero nested inside it
        // lands 20px further in than every other page's — which is how the
        // plan editor and the review ended up visibly misaligned with the
        // rest of the admin. The hero is a sibling of the body, never a child.
        const offenders = allVueFiles().filter((file) => {
            const template = templateOf(readFileSync(file, 'utf8'));
            const open = template.indexOf('<AdminBody');
            if (open === -1) return false;
            const close = template.lastIndexOf('</AdminBody>');
            return template.slice(open, close).includes('<AdminHero');
        });

        expect(offenders.map((f) => relative(SRC_DIR, f))).toEqual([]);
    });

    test('no view hand-writes the reload button instead of using AdminRefreshBtn', () => {
        // Seven pages wrote this button by hand: three showed no progress, one
        // disabled itself without a spinner, and one shipped an icon-only
        // button with no accessible name at all.
        const BTN = resolve(SRC_DIR, 'ui/feedback/AdminRefreshBtn.vue');
        const offenders = allVueFiles()
            .filter((file) => file !== BTN)
            .filter((file) => /name="refresh"/.test(templateOf(readFileSync(file, 'utf8'))));

        expect(offenders.map((f) => relative(SRC_DIR, f))).toEqual([]);
    });

    test('no view writes its own table instead of using AdminTable', () => {
        // Nine pages used QTable directly and agreed on nothing: header look,
        // where actions sat, whether there was a pager. AdminTable also keeps
        // sorting and paging together — a page that sliced its own rows would
        // have its table sort the slice rather than the list.
        const TABLE = resolve(SRC_DIR, 'ui/data/AdminTable.vue');
        // Neither of these is a list. PlanMatrix compares plans across
        // components — plans are its columns, so rows and paging mean nothing.
        // PlanChangeWizard's limits table is a three-column before/after
        // comparison inside a tenant-facing wizard, outside the admin shell.
        const NOT_LISTS = new Set([
            resolve(SRC_DIR, 'features/plan/PlanMatrix.vue'),
            resolve(SRC_DIR, 'pages-tenant/PlanChangeWizard.vue'),
        ]);
        const offenders = allVueFiles()
            .filter((file) => file !== TABLE && !NOT_LISTS.has(file))
            .filter((file) => {
                const template = templateOf(readFileSync(file, 'utf8'));
                // A raw <table> counts too: the tenants list was hand-written
                // markup with its own <thead>, so a check for QTable alone
                // walked straight past the least uniform table in the admin.
                return /<q-table[\s>]/.test(template) || /<table[\s>]/.test(template);
            });

        expect(offenders.map((f) => relative(SRC_DIR, f))).toEqual([]);
    });

    test('a component whose only job is to emit is never used without a listener', () => {
        // The plan rename broke exactly this way: PlanTitleEdit's `updatePlan`
        // listener stayed behind on the component the editor was lifted out
        // of, so renaming a plan silently did nothing. Nothing else could see
        // it — an unhandled emit is neither a type error nor a runtime one.
        //
        // Limited to single-emit components on purpose: ignoring one of five
        // optional events is ordinary, ignoring the only one is a mistake.
        // One legitimate case: the promo code field is `disabled` while
        // editing — a code is stable once created — so its `update:code`
        // cannot fire there and the edit dialog binds it one way on purpose.
        const DELIBERATELY_IGNORED = new Set(['PromoCodeEditDialog.vue: PromoCodeDialogFields']);
        const offenders: string[] = [];

        for (const file of allVueFiles()) {
            const emits = declaredEmits(readFileSync(file, 'utf8'));
            if (emits.length !== 1) continue;

            const component = basename(file, '.vue');
            const listener = `@${kebab(emits[0]!)}=`;

            for (const other of allVueFiles()) {
                const template = templateOf(readFileSync(other, 'utf8'));
                const usage = new RegExp(`<${component}\\b[^>]*>`, 'g');
                for (const [tag] of template.matchAll(usage)) {
                    const arg = emits[0]!.startsWith('update:')
                        ? emits[0]!.slice('update:'.length)
                        : '';
                    const heard =
                        tag.includes(listener) ||
                        tag.includes(`@${emits[0]!}=`) ||
                        (arg !== '' && tag.includes(`v-model:${kebab(arg)}`)) ||
                        (arg === 'modelValue' && /\bv-model[=\s]/.test(tag)) ||
                        (arg === '' && tag.includes('v-model'));
                    const pair = `${basename(other)}: ${component}`;
                    if (!heard && !DELIBERATELY_IGNORED.has(pair)) {
                        offenders.push(
                            `${relative(SRC_DIR, other)}: <${component}> ignores ${emits[0]}`,
                        );
                    }
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    test('the actions column is filled through row-actions, not body-cell-actions', () => {
        // AdminTable synthesizes the actions column only for `row-actions`. A
        // leftover `#body-cell-actions` renders nothing at all, because there
        // is no column of that name any more — the email history lost its
        // resend and delete buttons exactly this way.
        const offenders = allVueFiles().filter((file) => {
            const template = templateOf(readFileSync(file, 'utf8'));
            return template.includes('<AdminTable') && template.includes('#body-cell-actions');
        });

        expect(offenders.map((f) => relative(SRC_DIR, f))).toEqual([]);
    });

    test('no page declares its own statistic tile styling', () => {
        // Seven near-copies of the same tile preceded AdminKpi, two of them
        // byte identical, three living in unscoped page-level <style> blocks
        // that leaked their classes app-wide. The tile look is one rule in
        // the theme's component layer now, and this keeps a page from starting an eighth.
        // Two things make a tile, and both are required before this complains:
        // a name that claims to be one, and a surface. A right-aligned
        // label/value pair in a diff header is not an eighth tile, and neither
        // is a `__status` badge that merely contains the letters "stat".
        const RULE = /\.([\w-]+)[^{]*\{([^}]*)\}/g;
        const NAMES_A_TILE = /(?:^|[-_])(?:kpi|kpis|stat|stats)(?:$|[-_])/;

        const offenders = contentPageFiles().filter((file) => {
            const source = readFileSync(file, 'utf8');
            const styleStart = source.indexOf('<style');
            if (styleStart === -1) return false;

            for (const [, className, body] of source.slice(styleStart).matchAll(RULE)) {
                if (NAMES_A_TILE.test(className!) && body!.includes('border-radius')) return true;
            }
            return false;
        });

        expect(offenders.map((f) => relative(SRC_DIR, f))).toEqual([]);
    });

    test('an unscoped page style reaches only its own sub-components', () => {
        // This is the defect the shell work started from: `.sa-bundles__head`
        // was declared in BundlesPage's unscoped <style> and silently restyled
        // `plans-page/PlanBundleOverview`, which happened to reuse the name.
        // It has recurred twice since, because nothing checked for it.
        //
        // A page styling the children in its OWN folder is the intended
        // arrangement — a scoped style cannot reach them. Reaching anywhere
        // else is a leak, and it only shows up once the other page has been
        // visited, which is why it survives review.
        const OWN_CHILDREN: Record<string, string> = {
            BundlesPage: 'bundles-page',
            DiscoveryPage: 'discovery-page',
            MarketingCatalogPage: 'marketing-catalog',
            PlanDetail: 'plan-detail',
            PlanVersionEditor: 'plan-version-editor',
        };

        const files = contentPageFiles();
        const markupClasses = (file: string): Set<string> => {
            const template = templateOf(readFileSync(file, 'utf8'));
            const found = new Set<string>();
            for (const [, group] of template.matchAll(/class="([^"]*)"/g)) {
                for (const cls of group!.split(/\s+/)) {
                    if (cls && !cls.includes('$')) found.add(cls);
                }
            }
            return found;
        };
        const unscopedClasses = (file: string): Set<string> => {
            const source = readFileSync(file, 'utf8');
            const found = new Set<string>();
            for (const [, body] of source.matchAll(
                /<style(?![^>]*scoped)[^>]*>([\s\S]*?)<\/style>/g,
            )) {
                for (const [, cls] of body!.matchAll(/\.([\w-]+)/g)) found.add(cls!);
            }
            return found;
        };

        const leaks: string[] = [];
        for (const source of files) {
            const declared = unscopedClasses(source);
            if (declared.size === 0) continue;
            const stem = basename(source, '.vue');
            const allowed = new Set([dirName(source), OWN_CHILDREN[stem]]);

            for (const other of files) {
                if (other === source || allowed.has(dirName(other))) continue;
                const shared = [...markupClasses(other)].filter((c) => declared.has(c));
                if (shared.length > 0) {
                    leaks.push(
                        `${relative(SRC_DIR, source)} → ${relative(SRC_DIR, other)}: ${shared.sort().join(', ')}`,
                    );
                }
            }
        }

        expect(leaks).toEqual([]);
    });

    test('no page block titles itself with a heading-shaped <div>', () => {
        // The failure this catches is the one the repo already shipped: a
        // block that looks like a section, reads like a section and is
        // announced as nothing, because its title is a styled <div>. Sighted
        // users cannot tell the difference, so it survives review.
        const HEADING_SHAPED =
            /<div[^>]*class="[^"]*\b[\w-]*(?:section-head|card-title|panel-title|__section-head)\b/;

        const offenders = contentPageFiles().filter((file) =>
            HEADING_SHAPED.test(templateOf(readFileSync(file, 'utf8'))),
        );

        expect(offenders.map((f) => relative(SRC_DIR, f))).toEqual([]);
    });

    test('no view writes its own disclosure instead of using AdminAccordion', () => {
        // The same story as rule 14 one component over. Eight surfaces opened a
        // body from a header and agreed on nothing measurable: three header
        // paddings, three body paddings, two radii, two colours for the open
        // border, two transition durations, and hover feedback on one of six
        // although five set `cursor: pointer`. Four of them were a `<div>` with
        // a click handler — no `tabindex`, no keyboard, nothing an assistive
        // technology could announce as a control.
        //
        // Rule 19 above is why this one is not written as a list of class
        // names. It looks for `section-head|card-title|panel-title`, and every
        // accordion header in the package walked straight past it, because none
        // of the eight happened to pick one of those three words. A guard that
        // enumerates the shapes it has already seen only ever catches those.
        //
        // So this asks what a disclosure IS, in two forms the source can be
        // read for:
        //
        //   1. A click that flips a value the template also renders a body on.
        //      The mechanical definition of "open this" — an assignment whose
        //      right-hand side reads the same path it writes, next to a `v-if`
        //      or `v-show` on that path. Assigning a CONSTANT is not a
        //      disclosure: `step = 'done'` beside `v-else-if="step === 'done'"`
        //      is a wizard advancing, and a rule that could not tell those
        //      apart would spend its life being suppressed.
        //
        //      Path, not root. Which of the two it compares decides the whole
        //      question once the state lives on an object; `statePath` below
        //      has the story.
        //
        //      The flip counts wherever it is written — in the attribute, or
        //      in the body of the function the attribute names. Those are the
        //      same disclosure and the same missing keyboard, and reading only
        //      the attribute would have made `toggleExpanded(p.id)` the way to
        //      write one this test cannot see. Nothing about a hand-rolled
        //      disclosure should turn on which of the two a file happens to
        //      pick.
        //
        //      And the body counts wherever it is rendered. `v-if` is one way
        //      a template shows one; handing the value to a child that renders
        //      its slot under a `v-if` is the other, and once `AdminAccordion`
        //      exists it is the ordinary one. `:open="expandedId === p.id"`
        //      decides precisely what `v-if="expandedId === p.id"` decides,
        //      one component over — so a second, hand-rolled trigger that
        //      writes `expandedId` was invisible here while the migration that
        //      introduced the component was landing. Which props those are is
        //      read out of the components (`bodyProps` below), not listed
        //      here: a list would name `open` and go blind on the next one.
        //   2. A control that says out loud that it is one — a hand-written
        //      `aria-expanded`, or a native `<details>`. Neither is a defect in
        //      itself; both mean this view decided to implement a disclosure,
        //      and that decision belongs to `AdminAccordion` unless there is a
        //      reason it cannot.
        //
        // Where there is such a reason, it goes in the file that carries the
        // surface, marked so this test can find it. Not a list of file names
        // here: a name in a test says which files are allowed, the marker says
        // WHY this one is — and it sits where the next person to touch the
        // surface will read it. The second half of the test then holds the
        // markers to their side of that bargain.
        //
        // A marker names the finding it excuses and subtracts exactly that:
        //
        //     // sa-disclosure-exempt(toggles `showRaw`, writes `aria-expanded`):
        //     // a tenant-facing raw payload toggle, in a directory that is leaving
        //
        // It used to name nothing, and a file that carried one was simply not
        // asked the question again. That is not what any of the four markers in
        // this package were written to say. Three of them explain a surface
        // whose findings are TWO of the strings below, and the fourth explains a
        // second trigger on an accordion that is already the shared one — none
        // of them argued that the file should stop being read. Under a silencer
        // the difference is invisible: adding a `<div>` with a click handler to
        // a marked file, the exact shape this rule exists for, kept the suite
        // green, and so did reverting a marked surface to the hand-rolled
        // disclosure the marker was written beside.
        //
        // Naming the finding also makes the stale half sharper. It used to ask
        // whether ANY disclosure was left in a marked file, so a marker survived
        // its own surface as long as some other surface in the same file kept
        // the file matching. Now each named finding has to still occur.
        //
        // What this still does not ask is WHICH occurrence. A finding is a kind
        // and an identifier, deduplicated — `writes \`aria-expanded\`` is one
        // string however many controls write it — so a second hand-written
        // `aria-expanded`, or a second `<details>`, inside an already-marked
        // file is covered by the marker for the first. A second toggle is
        // caught, unless it flips a path already named. Closing that would mean
        // a count or a line number in the marker, and both churn on every edit
        // near the surface; the residue is written down here rather than
        // papered over.
        //
        // Every `.vue` under src, with none of the shell's exemptions. A login
        // screen sits outside `AdminLayout` and so writes its own `<h1>` and its
        // own frame; none of that makes a hand-rolled disclosure on it any more
        // operable by keyboard.
        const ACCORDION = resolve(SRC_DIR, 'ui/page/AdminAccordion.vue');
        const MARKER_WORD = 'sa-disclosure-exempt';
        // The findings sit in the parentheses, comma-separated; the reason
        // follows the colon. A marker that does not parse is reported rather
        // than ignored — silently not matching would be a silencer again, one
        // typo wide.
        const MARKER = /sa-disclosure-exempt\(([^)]*)\):[ \t]*(.*)/;

        const everyVueFile = (): string[] => {
            const found: string[] = [];
            const walk = (dir: string): void => {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    const full = join(dir, entry.name);
                    if (entry.isDirectory()) walk(full);
                    else if (entry.name.endsWith('.vue')) found.push(full);
                }
            };
            walk(SRC_DIR);
            return found.sort();
        };

        /** Index just past the bracket group that opens at `at`. */
        const pastGroup = (text: string, at: number, open: string, close: string): number => {
            let depth = 0;
            for (let i = at; i < text.length; i++) {
                if (text[i] === open) depth++;
                else if (text[i] === close && --depth === 0) return i + 1;
            }
            return text.length;
        };

        /** Index of the next character that is not whitespace. */
        const nextNonSpace = (text: string, at: number): number => {
            let i = at;
            while (i < text.length && /\s/.test(text[i]!)) i++;
            return i;
        };

        /**
         * Index just past the `>` that ends the tag opening at `at`, quoted
         * attribute values skipped.
         *
         * Not `[^>]*`: `v-if="promotions.length > 0"` ends a tag halfway
         * through under that pattern, and everything written after it on the
         * same element — an `@click`, a `:open` — falls out of view.
         */
        const pastOpenTag = (template: string, at: number): number => {
            let quote = '';
            for (let i = at; i < template.length; i++) {
                const character = template[i]!;
                if (quote !== '') {
                    if (character === quote) quote = '';
                } else if (character === '"' || character === "'") quote = character;
                else if (character === '>') return i + 1;
            }
            return template.length;
        };

        /** Every opening tag in a template, with the attributes it carries. */
        const openTags = function* (template: string): Generator<{ name: string; tag: string }> {
            for (let i = 0; i < template.length;) {
                if (template[i] !== '<' || !/[A-Za-z]/.test(template[i + 1] ?? '')) {
                    i++;
                    continue;
                }
                const past = pastOpenTag(template, i);
                const tag = template.slice(i, past);
                yield { name: /^<([A-Za-z][\w.-]*)/.exec(tag)![1]!, tag };
                i = past;
            }
        };

        const VOID_TAGS = new Set([
            'area',
            'base',
            'br',
            'col',
            'embed',
            'hr',
            'img',
            'input',
            'link',
            'meta',
            'source',
            'track',
            'wbr',
        ]);

        /** The markup of the element whose tag opens at `at`, content included. */
        const elementAt = (template: string, at: number): string => {
            const past = pastOpenTag(template, at);
            const name = /^<([A-Za-z][\w.-]*)/.exec(template.slice(at, past))?.[1];
            if (!name) return '';
            if (template[past - 2] === '/' || VOID_TAGS.has(name.toLowerCase())) {
                return template.slice(at, past);
            }
            let depth = 0;
            for (let i = at; i < template.length;) {
                const closing = template.startsWith(`</${name}`, i);
                const opening = !closing && template.startsWith(`<${name}`, i);
                // `<div` must not count `<divider`.
                const after = template[i + name.length + (closing ? 2 : 1)] ?? '';
                if ((!closing && !opening) || !/[\s/>]/.test(after)) {
                    i++;
                    continue;
                }
                const end = pastOpenTag(template, i);
                if (closing) {
                    if (--depth === 0) return template.slice(at, end);
                } else if (template[end - 2] !== '/') depth++;
                i = end;
            }
            return template.slice(at);
        };

        /**
         * The props a component renders a BODY on — `open` for
         * `AdminAccordion`, read out of the component rather than named here.
         *
         * A prop qualifies when a `v-if`/`v-show` on it stands between the
         * template and a `<slot>`. That is what makes the caller's expression
         * a disclosure condition and not merely page state: `v-if="$slots.mark"`
         * gates a slot too, and is deliberately not one of these, because it
         * names nothing a caller could pass.
         */
        const bodyPropCache = new Map<string, Set<string>>();
        const bodyProps = (component: string): Set<string> => {
            const cached = bodyPropCache.get(component);
            if (cached) return cached;

            const template = templateOf(readFileSync(component, 'utf8'));
            const props = new Set<string>();
            const gate = /\sv-(?:if|show)="!?\s*([A-Za-z_$][\w$]*)\s*"/g;
            for (let hit = gate.exec(template); hit; hit = gate.exec(template)) {
                const opens = template.lastIndexOf('<', hit.index);
                if (opens !== -1 && elementAt(template, opens).includes('<slot')) {
                    props.add(hit[1]!);
                }
            }
            bodyPropCache.set(component, props);
            return props;
        };

        /**
         * The expressions this template hands to such a prop. Only components
         * this file imports by relative path, so the question stays one hop
         * deep and answerable from the sources: what a Quasar component does
         * with a prop is not readable here, and guessing would be worse than
         * the gap.
         */
        const bodyBindings = (file: string, template: string, script: string): string[] => {
            const imported = new Map<string, string>();
            for (const [, local, specifier] of script.matchAll(
                /import\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+\.vue)'/g,
            )) {
                imported.set(local!, resolve(dirname(file), specifier!));
            }

            const found: string[] = [];
            for (const { name, tag } of openTags(template)) {
                const component = imported.get(name);
                if (!component) continue;
                for (const prop of bodyProps(component)) {
                    const bound = new RegExp(
                        String.raw`(?::|v-bind:|v-model:)(?:${prop}|${kebab(prop)})="([^"]*)"`,
                    ).exec(tag);
                    if (bound) found.push(bound[1]!);
                }
            }
            return found;
        };

        /** The block that opens at `at`, or the single expression that starts there. */
        const regionAt = (text: string, at: number): string => {
            if (text[at] === '{') return text.slice(at, pastGroup(text, at, '{', '}'));
            // An arrow whose body is an expression: `() => (open = !open)`.
            let depth = 0;
            for (let i = at; i < text.length; i++) {
                const character = text[i]!;
                if ('([{'.includes(character)) depth++;
                else if (')]}'.includes(character)) depth--;
                else if (depth === 0 && (character === ';' || character === '\n')) {
                    return text.slice(at, i);
                }
            }
            return text.slice(at);
        };

        /**
         * The body of a function this file declares, so that naming the flip
         * hides it no better than writing it into the attribute. Between
         * `@click="expandedId = expandedId === p.id ? null : p.id"` and
         * `@click="toggleExpanded(p.id)"` there is a name and nothing else —
         * same click, same body, same missing keyboard.
         *
         * One level deep on purpose. A click that calls a function that calls
         * a function no longer describes what the click does, and the
         * condition this rule pairs it with is loose enough that ordinary page
         * state would start matching: `draftEditing` on the plans page is
         * merged into itself deep in a save path and read by a `v-if` at the
         * top of the same template, and it is a wizard step, not a disclosure.
         *
         * The braces are found by scanning rather than by the first `{` after
         * the name: a parameter list (`opts: { id: string }`) and a return
         * type (`): { value: string } {`) each bring one along, and this
         * package writes both.
         */
        const handlerBody = (script: string, name: string): string => {
            const declaration = new RegExp(
                // `function name(`, with or without `async`, or `const name =`
                // — never `props.name =`. `=(?![=>])` keeps a comparison and an
                // arrow out, exactly as in the attribute below.
                String.raw`(?<![.\w$])(?:(?:async\s+)?function\s+${name}\s*\(` +
                    String.raw`|(?:const|let|var)\s+${name}\s*=(?![=>]))`,
            ).exec(script);
            if (!declaration) return '';
            let at = declaration.index + declaration[0].length;

            if (declaration[0].endsWith('(')) {
                // `at - 1` is that `(`: the match ends on it.
                let opening = script.indexOf('{', pastGroup(script, at - 1, '(', ')'));
                // A return type's braces are followed by the block they
                // annotate; a body's are not.
                while (opening !== -1) {
                    const past = pastGroup(script, opening, '{', '}');
                    if (script[nextNonSpace(script, past)] !== '{') break;
                    opening = script.indexOf('{', past);
                }
                return opening === -1 ? '' : regionAt(script, opening);
            }

            // `const name = …`: the arrow, if this declaration has one, and
            // then whatever follows it. The search for it ends with the
            // statement, or `const emit = defineEmits<…>()` would adopt the
            // body of the next arrow function anywhere below it.
            at = nextNonSpace(script, at);
            if (script.startsWith('async', at)) at = nextNonSpace(script, at + 'async'.length);
            if (script[at] === '(') at = pastGroup(script, at, '(', ')');
            for (; at < script.length; at++) {
                const character = script[at]!;
                if (character === ';' || character === '\n') return '';
                if (character === '=' && script[at + 1] === '>') break;
            }
            const body = nextNonSpace(script, at + 2);
            return body < script.length ? regionAt(script, body) : '';
        };

        /**
         * Everywhere a click can write the flip: the attribute, and the body
         * of every function the attribute names — `@click="close"` and
         * `@click="openDetail(row)"` alike, but not `row.close()`, which is
         * not this file's to look into.
         */
        const clickRegions = (script: string, attribute: string): string[] => {
            const named = [...attribute.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(
                (m) => m[1]!,
            );
            const bare = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(attribute)?.[1];
            if (bare) named.push(bare);
            return [attribute, ...named.map((name) => handlerBody(script, name))];
        };

        /**
         * A reference as the source writes it — `open`, `expandedId.value`,
         * `expanded[row.id]` — reduced to the state it names.
         *
         * This rule pairs a click with a condition written somewhere else, so
         * two spellings of one piece of state have to survive the trip:
         *
         *   - `.value` is a ref unwrapped. The handler writes
         *     `expandedId.value` and the template reads `expandedId`; those
         *     are one piece of state, and a template cannot write the other
         *     spelling.
         *   - a subscript is a row key. The handler writes `expanded[id]`
         *     where the template reads `expanded[row.id]`. Which name the key
         *     goes by on each side is not what this asks, so every subscript
         *     reduces to `[]` — the store, not the row.
         *
         * What does NOT reduce is the property, and that is the point of
         * having this at all. `form.selected` and `form.panelOpen` are two
         * pieces of state that merely share a root, and comparing roots — as
         * this did — read `@click="form.selected = form.current"` beside
         * `v-if="form.panelOpen"` as a disclosure of `form`. Nothing is
         * flipped there. Assigning one property of an object while a body
         * hangs off another is the most ordinary shape a page has, and the
         * only way out of the finding would have been a marker excusing
         * something that is not a disclosure — which teaches the next reader
         * that these markers are how you get past the rule.
         */
        const PATH = String.raw`[A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+|\s*\[[^\]]*\])*`;
        const statePath = (path: string): string =>
            path
                .replace(/\s+/g, '')
                .replace(/\.value(?![\w$])/g, '')
                .replace(/\[[^\]]*\]/g, '[]');

        /**
         * Every path a snippet reads, reduced the same way. Whole paths only:
         * what sits inside a subscript is the key rather than the state, so
         * `expanded[row.id]` contributes `expanded[]` and not `row.id`.
         */
        const pathsIn = (text: string): Set<string> =>
            new Set([...text.matchAll(new RegExp(PATH, 'g'))].map((match) => statePath(match[0])));

        /** What makes this file a disclosure of its own, if anything does. */
        const ownDisclosures = (file: string, source: string): string[] => {
            const template = templateOf(source);
            const script = scriptOf(source);
            const findings: string[] = [];

            const conditions = [
                ...[...template.matchAll(/\sv-(?:if|else-if|show)="([^"]*)"/g)].map((m) => m[1]!),
                ...bodyBindings(file, template, script),
            ];
            /** Every path some body in this template is shown on. */
            const gated = new Set(conditions.flatMap((condition) => [...pathsIn(condition)]));

            for (const { tag } of openTags(template)) {
                const handler = /@click(?:\.\w+)*="([^"]*)"/.exec(tag);
                if (!handler) continue;
                for (const region of clickRegions(script, handler[1]!)) {
                    // `=(?![=>])` so a comparison and an arrow function are not
                    // read as assignments. Every assignment in the region, not
                    // the first: a function body holds several statements, and
                    // the flip is rarely the one at the top. The left-hand side
                    // is a whole `PATH` so that a keyed store counts —
                    // `expanded[row.id] = !expanded[row.id]` beside
                    // `v-if="expanded[row.id]"` is the ordinary way to hold
                    // per-row state, and reading only the dotted form let it
                    // through.
                    const assignments = region.matchAll(
                        new RegExp(String.raw`(${PATH})\s*=(?![=>])\s*(.+)`, 'g'),
                    );
                    for (const assignment of assignments) {
                        // A flip is one path: the right-hand side reads what
                        // the left-hand side writes, and a body hangs off that
                        // same path. Both halves ask about the path rather than
                        // its root, so an assignment that reads a SIBLING
                        // property is not one.
                        const written = statePath(assignment[1]!);
                        if (!pathsIn(assignment[2]!).has(written)) continue;
                        if (gated.has(written)) findings.push(`toggles \`${written}\``);
                    }
                }
            }

            if (/\baria-expanded\b/.test(template)) findings.push('writes `aria-expanded`');
            if (/<details[\s>]/.test(template)) findings.push('uses `<details>`');
            return [...new Set(findings)];
        };

        /**
         * The exemptions a file declares — one entry per finding named, with
         * the reason written beside it — and the markers that do not parse.
         *
         * A marker that failed to parse is reported rather than skipped. The
         * whole point of this round is that a marker subtracts one named thing,
         * and a typo inside the parentheses would otherwise subtract nothing
         * while still reading, to a human, like an accepted exemption.
         */
        const exemptionsOf = (
            source: string,
        ): { claims: Map<string, string>; malformed: string[] } => {
            const claims = new Map<string, string>();
            const malformed: string[] = [];
            const lines = source.split('\n');

            for (const [index, line] of lines.entries()) {
                if (!line.includes(MARKER_WORD)) continue;
                const parsed = MARKER.exec(line);
                const named = (parsed?.[1] ?? '')
                    .split(',')
                    .map((finding) => finding.trim())
                    .filter(Boolean);
                if (!parsed || named.length === 0) {
                    malformed.push(line.trim());
                    continue;
                }

                // The reason may run onto the next comment line. Naming two
                // findings and then explaining them does not fit on one, and a
                // marker nobody can read at a glance is its own kind of silence.
                const tail = parsed[2]!.trim();
                const reason =
                    tail !== ''
                        ? tail
                        : (lines[index + 1] ?? '').replace(/^\s*(?:\/\/|\*)\s*/, '').trim();
                for (const finding of named) claims.set(finding, reason);
            }

            return { claims, malformed };
        };

        /**
         * What one file still owes: the disclosures nobody explained, and the
         * explanations that no longer describe anything it does.
         *
         * The second direction is what keeps this test from going blind
         * unnoticed — the exempt files are the detector's fixtures. If a
         * surface is migrated its marker has to go, and if the detector stops
         * seeing a finding a marker is still written against, this says so.
         * Per finding, not per file: three of the four marked files have two
         * findings each, so a file-wide question was answered "yes, something
         * here is still a disclosure" by whichever of them was left.
         */
        const review = (
            name: string,
            findings: string[],
            source: string,
        ): { unexplained: string[]; stale: string[] } => {
            const { claims, malformed } = exemptionsOf(source);

            const unexplained = malformed.map(
                (marker) => `${name}: \`${marker}\` names no finding it excuses`,
            );
            for (const finding of findings) {
                if (!claims.has(finding)) unexplained.push(`${name}: ${finding}`);
            }
            for (const [finding, reason] of claims) {
                // A marker with a word or two after it is a silencer; the point
                // is that somebody had to write down a reason.
                if (reason.split(/\s+/).filter(Boolean).length < 5) {
                    unexplained.push(`${name}: exempt from ${finding} without a reason`);
                }
            }

            const stale = [...claims.keys()]
                .filter((finding) => !findings.includes(finding))
                .map((finding) => `${name}: exempt from ${finding}, which it no longer does`);

            return { unexplained, stale };
        };

        // The counter-proof, before the sweep that uses it.
        //
        // Three rounds of this rule shipped believing they asked "does a click
        // open a body", while each in fact asked how the flip was SPELLED —
        // attribute or named handler, dotted or bracketed path, `v-if` or
        // `:open`. Every one of them was green against the tree at the time,
        // because a detector that finds nothing and a tree with nothing in it
        // read exactly alike. These five sources are the shapes themselves, so
        // a detector that stops detecting says so by name.
        //
        // Answered against the real `AdminAccordion` — the fixture claims a
        // path under `src/ui/`, and never has to exist for the import
        // in it to resolve. If `open` stops being read out of that component,
        // the third case below goes silent and this fails.
        const FIXTURE = resolve(SRC_DIR, 'ui/DisclosureFixture.vue');
        const fixture = (markup: string, code: string): string =>
            `<template>${markup}</template>\n<script setup lang="ts">${code}</script>`;
        const IMPORTS_ACCORDION = `import AdminAccordion from './page/AdminAccordion.vue';`;

        // A body this view renders itself, flipped in the attribute.
        expect(
            ownDisclosures(
                FIXTURE,
                fixture(
                    `<div @click="open = !open">head</div><div v-if="open">body</div>`,
                    `const open = ref(false);`,
                ),
            ),
        ).toEqual(['toggles `open`']);

        // The same disclosure, on an element whose attributes contain a `>`.
        //
        // A separate defect from the three spellings above, and one that was in
        // the ORIGINAL rule rather than in what this change adds: tags were
        // matched with `<[A-Za-z][^>]*?>`, which ends a tag at the first `>` in
        // the source — including the one inside `v-if="rows.length > 0"`.
        // Everything written after it on the same element, `@click` included,
        // fell outside the "tag" and was never read. This file writes exactly
        // that comparison (`v-if="promotions.length > 0"`), so the shape is not
        // hypothetical; it happened to sit on a wrapper rather than on the
        // trigger, which is the only reason the bar below was reachable at all.
        expect(
            ownDisclosures(
                FIXTURE,
                fixture(
                    `<div v-if="rows.length > 0" @click="open = !open">head</div>` +
                        `<div v-if="open">body</div>`,
                    `const open = ref(false);`,
                ),
            ),
        ).toEqual(['toggles `open`']);

        // The same, per row, through a named handler and a keyed store. The
        // click writes `expanded[id]` and the template reads `expanded[row.id]`;
        // the finding names the store both spellings index, `expanded[]`, and
        // not whichever name the key happened to have on one of the two sides.
        expect(
            ownDisclosures(
                FIXTURE,
                fixture(
                    `<div @click="onToggle(row.id)">head</div><div v-if="expanded[row.id]">body</div>`,
                    `function onToggle(id: string): void { expanded[id] = !expanded[id]; }`,
                ),
            ),
        ).toEqual(['toggles `expanded[]`']);

        // A body `AdminAccordion` renders, opened from a second trigger of this
        // view's own. No `v-if` in this file mentions `expandedId`.
        expect(
            ownDisclosures(
                FIXTURE,
                fixture(
                    `<div @click="onToggle(bar.id)">bar</div>` +
                        `<AdminAccordion :open="expandedId === p.id">body</AdminAccordion>`,
                    `${IMPORTS_ACCORDION}
                     function onToggle(id: string): void {
                         expandedId.value = expandedId.value === id ? null : id;
                     }`,
                ),
            ),
        ).toEqual(['toggles `expandedId`']);

        // And the shape one hop away from all three: a named handler that
        // toggles something of its own, beside an `:open` on another name. A
        // rule that fires here is worse than no rule.
        expect(
            ownDisclosures(
                FIXTURE,
                fixture(
                    `<button type="button" @click="onPick(row.id)">pick</button>` +
                        `<AdminAccordion :open="panelOpen">body</AdminAccordion>`,
                    `${IMPORTS_ACCORDION}
                     function onPick(id: string): void {
                         selectedId.value = selectedId.value === id ? null : id;
                     }`,
                ),
            ),
        ).toEqual([]);

        // And the shape that shares a ROOT with a condition without sharing
        // anything else: a click that assigns one property of an object while a
        // body hangs off another. This is an object being updated, which every
        // page does, and every round of this rule so far called it a toggle of
        // `form`, because both expressions were reduced to that root.
        //
        // It belongs beside the four above and not in a corner labelled edge
        // case: a rule that fires here has no defence left. The file's author
        // reaches for the marker — it is right there, it makes the suite green,
        // and it now says in the source that an ordinary assignment is an
        // excused disclosure. One of those is cheaper to write than an argument
        // about the rule, so the rule ends up documenting its own defect.
        expect(
            ownDisclosures(
                FIXTURE,
                fixture(
                    `<div @click="form.selected = form.current">head</div>` +
                        `<div v-if="form.panelOpen">body</div>`,
                    `const form = reactive({ selected: null, current: null, panelOpen: false });`,
                ),
            ),
        ).toEqual([]);

        // Sharpened once more: the flip is real and the body is real, and they
        // are still two different pieces of state. `form.selected` is toggled
        // outright here, so only the CONDITION half separates this from a
        // disclosure — the half a fix aimed at the right-hand side alone would
        // have left comparing roots.
        expect(
            ownDisclosures(
                FIXTURE,
                fixture(
                    `<div @click="form.selected = !form.selected">head</div>` +
                        `<div v-if="form.panelOpen">body</div>`,
                    `const form = reactive({ selected: false, panelOpen: false });`,
                ),
            ),
        ).toEqual([]);

        // The other half, on its own: the condition IS on the property being
        // written, and the right-hand side is what says this is not a flip.
        // Bookkeeping beside a "is there anything" gate — no header, no body,
        // no disclosure — and under root comparison `counts.pending` stood in
        // for a read of `counts.total`.
        expect(
            ownDisclosures(
                FIXTURE,
                fixture(
                    `<div @click="counts.total = counts.pending">head</div>` +
                        `<div v-if="counts.total">body</div>`,
                    `const counts = reactive({ total: 0, pending: 0 });`,
                ),
            ),
        ).toEqual([]);

        // And the property that IS the one the body hangs off is still caught,
        // so the two above are about which property, not about objects.
        expect(
            ownDisclosures(
                FIXTURE,
                fixture(
                    `<div @click="form.panelOpen = !form.panelOpen">head</div>` +
                        `<div v-if="form.panelOpen">body</div>`,
                    `const form = reactive({ selected: false, panelOpen: false });`,
                ),
            ),
        ).toEqual(['toggles `form.panelOpen`']);

        // The counter-proof for the second half, on the same principle.
        //
        // The pairing is what this round changed, and it needs its own shapes
        // for the reason the detector needed its: from inside a file with one
        // finding, a silencer and a working exemption read exactly alike. Every
        // earlier round had a file like that, and every earlier round was green.
        const PROBE = 'probe.vue';
        const marked = (findings: string, reason: string): string =>
            `<script setup lang="ts">\n// ${MARKER_WORD}(${findings}): ${reason}\n</script>`;
        const WHY = 'a tenant-facing raw payload toggle, deliberately';

        // A marker subtracts the finding it names, and leaves the rest standing.
        // This is the whole change: under the file-level marker the second entry
        // was gone, and adding a keyboard-inoperable `<div>` to a marked file
        // kept the suite green.
        expect(
            review(
                PROBE,
                ['toggles `showRaw`', 'writes `aria-expanded`'],
                marked('toggles `showRaw`', WHY),
            ),
        ).toEqual({ unexplained: ['probe.vue: writes `aria-expanded`'], stale: [] });

        // Both named, both excused.
        expect(
            review(
                PROBE,
                ['toggles `showRaw`', 'writes `aria-expanded`'],
                marked('toggles `showRaw`, writes `aria-expanded`', WHY),
            ),
        ).toEqual({ unexplained: [], stale: [] });

        // Stale per finding, not per file: the file is still a disclosure, and
        // the marker still has to describe one this file actually does.
        expect(
            review(
                PROBE,
                ['writes `aria-expanded`'],
                marked('toggles `showRaw`, writes `aria-expanded`', WHY),
            ),
        ).toEqual({
            unexplained: [],
            stale: ['probe.vue: exempt from toggles `showRaw`, which it no longer does'],
        });

        // The reason requirement, unchanged in substance.
        expect(review(PROBE, ['uses `<details>`'], marked('uses `<details>`', 'because'))).toEqual({
            unexplained: ['probe.vue: exempt from uses `<details>` without a reason'],
            stale: [],
        });

        // A marker that names nothing — the old spelling among them — is a
        // finding of its own, not a marker this test quietly fails to see.
        expect(
            review(
                PROBE,
                ['uses `<details>`'],
                `<script setup lang="ts">\n// ${MARKER_WORD}: ${WHY}\n</script>`,
            ),
        ).toEqual({
            unexplained: [
                'probe.vue: `// sa-disclosure-exempt: a tenant-facing raw payload toggle, deliberately` names no finding it excuses',
                'probe.vue: uses `<details>`',
            ],
            stale: [],
        });

        // The reason may sit on the next comment line, so that naming the
        // findings does not push the sentence off the page.
        expect(
            review(
                PROBE,
                ['uses `<details>`'],
                `<script setup lang="ts">\n// ${MARKER_WORD}(uses \`<details>\`):\n// ${WHY}\n</script>`,
            ),
        ).toEqual({ unexplained: [], stale: [] });

        const files = everyVueFile();
        // The sweep reaches src at all. Without this both halves below pass by
        // finding nothing, which is exactly how they would read if the cwd moved.
        expect(files).toContain(ACCORDION);

        const unexplained: string[] = [];
        const stale: string[] = [];

        for (const file of files) {
            if (file === ACCORDION) continue;
            const source = readFileSync(file, 'utf8');
            const verdict = review(relative(SRC_DIR, file), ownDisclosures(file, source), source);
            unexplained.push(...verdict.unexplained);
            stale.push(...verdict.stale);
        }

        expect(unexplained).toEqual([]);
        expect(stale).toEqual([]);
    });
});
