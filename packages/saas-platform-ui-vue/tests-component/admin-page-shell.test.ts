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
const PAGES_DIR = resolve(process.cwd(), 'src/pages-standard');

// These three render outside AdminLayout — they are the login, the first-run
// setup and the manifest error screen, not admin content pages. They own their
// own frame and are deliberately out of the shell's scope.
const NON_CONTENT_PAGES = new Set([
    'AdminLayout.vue',
    'AdminManifestErrorPage.vue',
    'SuperAdminLoginPage.vue',
    'SuperAdminSetupWizard.vue',
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

    test('the only <h1> in the content pages is the one AdminHero renders', () => {
        const offenders = contentPageFiles().filter((file) =>
            /<h1[\s>]/.test(templateOf(readFileSync(file, 'utf8'))),
        );

        expect(offenders.map((f) => relative(PAGES_DIR, f))).toEqual([]);
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
