import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every relative link in the documentation points at something that exists —
// the file, and the heading inside it.
//
// Written after breaking three links in one edit: inserting a section into the
// handbook renumbered `### 8.6 UI Language` to `8.7`, and the quickstart, the
// package README and the scaffolder template all pointed at `#86-ui-language`.
// Nothing complained. `no-dangling-doc-refs` only knows the names of private
// documents, and a wrong anchor is not a wrong name.
//
// A dead link is the cheapest possible way to lose a reader's trust: they click
// it precisely because they wanted the detail, and they land nowhere.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where documentation lives. Package READMEs count — they link into docs/. */
const SEARCH_ROOTS = ['docs', 'packages', 'examples', '.changeset'];
const SKIP = /node_modules|[\\/]dist[\\/]|CHANGELOG\.md$/;

/** GitHub's slug: lowercase, drop punctuation, spaces to dashes. */
function slug(heading) {
    return heading
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/ /g, '-');
}

function anchorsOf(markdown) {
    return new Set([...markdown.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])));
}

function markdownFiles() {
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (SKIP.test(full)) continue;
            if (statSync(full).isDirectory()) walk(full);
            else if (full.endsWith('.md')) found.push(full);
        }
    };
    for (const root of SEARCH_ROOTS) {
        const full = join(REPO_ROOT, root);
        if (existsSync(full)) walk(full);
    }
    found.push(join(REPO_ROOT, 'README.md'));
    return found.filter(existsSync);
}

describe('documentation links resolve', () => {
    const files = markdownFiles();

    test('the sweep found the documentation', () => {
        // Every assertion below reports "nothing broken" on an empty list, so a
        // moved directory would read as a clean bill of health.
        assert.ok(files.length >= 10, `only ${files.length} markdown files found`);
        assert.ok(
            files.some((f) => f.endsWith(join('docs', 'handbook.md'))),
            'the handbook is not among the files checked',
        );
    });

    test('every relative link points at a file that exists', () => {
        const broken = [];
        for (const file of files) {
            const markdown = readFileSync(file, 'utf8');
            for (const [, target] of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
                if (/^(https?:|mailto:|#)/.test(target)) continue;
                const [path] = target.split('#');
                if (!path) continue;
                if (!existsSync(resolve(dirname(file), path))) {
                    broken.push(`${relative(REPO_ROOT, file)} → ${target}`);
                }
            }
        }
        assert.deepEqual(broken, [], 'links to files that do not exist');
    });

    test('every anchor points at a heading that exists', () => {
        const cache = new Map();
        const broken = [];

        for (const file of files) {
            const markdown = readFileSync(file, 'utf8');
            for (const [, target] of markdown.matchAll(/\]\(([^)\s]+#[^)\s]+)\)/g)) {
                if (/^(https?:)/.test(target) && !target.includes('github.com/uelker70/saasicat')) {
                    continue;
                }
                const [path, anchor] = target
                    .replace(/^https:\/\/[^#]*blob\/main\//, '')
                    .split('#');
                // A bare `#anchor` refers to this file's own headings.
                const targetFile = path ? resolve(dirname(file), path) : file;
                if (!existsSync(targetFile)) continue; // reported by the test above
                if (!cache.has(targetFile)) {
                    cache.set(targetFile, anchorsOf(readFileSync(targetFile, 'utf8')));
                }
                if (!cache.get(targetFile).has(anchor)) {
                    broken.push(`${relative(REPO_ROOT, file)} → ${target}`);
                }
            }
        }

        assert.deepEqual(
            broken,
            [],
            'anchors with no matching heading — renumbering a section breaks every ' +
                'link into it, and the link keeps looking right',
        );
    });
});
