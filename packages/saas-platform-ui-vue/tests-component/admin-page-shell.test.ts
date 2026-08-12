// The page shell is a contract, not a convention.
//
// This repo already tried to hold the admin pages to one page structure using
// CSS class names (`sa-theme.css`), and it did not hold: of eighteen pages,
// seven adopted `.sa-page-head`, four copied it into their own BEM variants,
// four pushed the header into a sub-component, and one shipped its title in a
// `<div>` with no heading tag at all. A class name is advice. These tests are
// the part that bites.
//
// Two halves: the components keep their promises (one `<h1>`, a named
// `<section>`, no `<main>`), and no page quietly reintroduces the hand-written
// markup they replace.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';

import AdminHero from '../src/components/admin-page/AdminHero.vue';
import AdminPage from '../src/components/admin-page/AdminPage.vue';
import AdminSection from '../src/components/admin-page/AdminSection.vue';
import { mountWithQuasar } from './support/mount-with-quasar.js';

// Vite rewrites `import.meta.url` to an http:// URL in the transformed module,
// so the package root has to come from the runner's cwd, which vitest sets to
// the `root` in vitest.config.ts.
const SRC_DIR = resolve(process.cwd(), 'src');
const PAGES_DIR = resolve(SRC_DIR, 'pages-standard');

// These render outside AdminLayout — the login, the first-run setup, the
// manifest error screen and the tenant onboarding configurator. Each owns its
// frame and its own single <h1>, and is deliberately out of the shell's scope.
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
    walk(PAGES_DIR);
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

function dirName(file: string): string {
    return file.split('/').slice(-2, -1)[0] ?? '';
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

        expect(offenders.map((f) => relative(PAGES_DIR, f))).toEqual([]);
    });

    test('no content page hand-writes the hero markup instead of using AdminHero', () => {
        const offenders = contentPageFiles().filter((file) =>
            /class="[^"]*\bsa-page-head\b/.test(templateOf(readFileSync(file, 'utf8'))),
        );

        expect(offenders.map((f) => relative(PAGES_DIR, f))).toEqual([]);
    });

    test('AdminHero renders the only <h1> in the package', () => {
        // Components too, not just pages: the plan detail kept its heading in a
        // `PlanDetailHeader` child, so the page itself was clean while the
        // rendered page carried two competing <h1>s. Checking pages alone is
        // what let that survive — a header pushed one directory down is the
        // most likely place for the next one.
        const HERO = resolve(SRC_DIR, 'components/admin-page/AdminHero.vue');
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
        const BTN = resolve(SRC_DIR, 'components/admin-page/AdminRefreshBtn.vue');
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
        const TABLE = resolve(SRC_DIR, 'components/admin-page/AdminTable.vue');
        // Neither of these is a list. PlanMatrix compares plans across
        // components — plans are its columns, so rows and paging mean nothing.
        // PlanChangeWizard's limits table is a three-column before/after
        // comparison inside a tenant-facing wizard, outside the admin shell.
        const NOT_LISTS = new Set([
            resolve(SRC_DIR, 'components/plan-matrix/PlanMatrix.vue'),
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

            const component = file.split('/').pop()!.replace('.vue', '');
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
                    const pair = `${other.split('/').pop()}: ${component}`;
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
        // sa-theme.css now, and this keeps a page from starting an eighth.
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

        expect(offenders.map((f) => relative(PAGES_DIR, f))).toEqual([]);
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
            const stem = source.split('/').pop()!.replace('.vue', '');
            const allowed = new Set([dirName(source), OWN_CHILDREN[stem]]);

            for (const other of files) {
                if (other === source || allowed.has(dirName(other))) continue;
                const shared = [...markupClasses(other)].filter((c) => declared.has(c));
                if (shared.length > 0) {
                    leaks.push(
                        `${relative(PAGES_DIR, source)} → ${relative(PAGES_DIR, other)}: ${shared.sort().join(', ')}`,
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

        expect(offenders.map((f) => relative(PAGES_DIR, f))).toEqual([]);
    });
});
