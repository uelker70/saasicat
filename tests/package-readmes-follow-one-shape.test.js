// Eleven packages, one shape of README.
//
// A reader who has just installed one of these wants three answers in a fixed
// order: what is this, what is this NOT, and how do I start. The middle one is
// the section this repository kept answering in issues instead — "@saasicat/core
// is a types package, right?" (it is not; it carries the runtime rules both
// sides apply) and "does @saasicat/spec run the migrations?" (it does not; the
// CLI merges its fragments into your schema).
//
// The entry-point table is checked against the export map rather than read: a
// package that gains a subpath and does not mention it has an entry nobody can
// find, which is the same defect as one that documents a subpath it never
// shipped.

// @requirement SC-READ-001 — Someone deciding whether to depend on SaaSiCat can judge what is tested

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(ROOT, 'packages');

/** Sections every package README carries, in this order. */
const REQUIRED = ['## What this is', '## What this is not', '## Next'];

/** The manifest exposes this subpath to a consumer; `package.json` is plumbing. */
function publicSubpaths(manifest) {
    return Object.keys(manifest.exports ?? {}).filter((key) => key !== './package.json');
}

export function packages() {
    return readdirSync(PACKAGES).map((dir) => ({
        dir,
        manifest: JSON.parse(readFileSync(join(PACKAGES, dir, 'package.json'), 'utf8')),
        readme: readFileSync(join(PACKAGES, dir, 'README.md'), 'utf8'),
    }));
}

/** The subpaths a README's entry-point table lists, from its first column. */
export function documentedSubpaths(readme) {
    const listed = [];
    let inTable = false;
    for (const line of readme.split('\n')) {
        if (line.startsWith('## ')) inTable = line.trim() === '## Entry points';
        if (!inTable || !line.trim().startsWith('|')) continue;
        const first = line.split('|')[1]?.trim() ?? '';
        if (first.startsWith('`') && first.endsWith('`')) listed.push(first.slice(1, -1));
    }
    return listed;
}

describe('every package README answers the same questions', () => {
    const all = packages();

    test('the sweep finds every package', () => {
        // Vacuously true on an empty list; `packages/` is read from disk.
        assert.ok(all.length >= 10, `only ${all.length} packages found`);
        assert.ok(
            all.some(({ readme }) => documentedSubpaths(readme).length > 1),
            'no entry-point table found — the check reads nothing',
        );
    });

    test('each README names its package and carries the three sections', () => {
        const offenders = [];
        for (const { dir, manifest, readme } of all) {
            if (!readme.startsWith(`# ${manifest.name}\n`)) {
                offenders.push(`${dir}: first line is not "# ${manifest.name}"`);
            }
            for (const section of REQUIRED) {
                if (!readme.includes(`\n${section}\n`)) offenders.push(`${dir}: no "${section}"`);
            }
        }
        assert.deepEqual(offenders, [], offenders.join('\n'));
    });

    test('a package with more than one entry point documents all of them', () => {
        const offenders = [];
        for (const { dir, manifest, readme } of all) {
            const exported = publicSubpaths(manifest);
            if (exported.length < 2) continue;

            const documented = documentedSubpaths(readme);
            const missing = exported.filter((subpath) => !documented.includes(subpath));
            const unknown = documented.filter((subpath) => !exported.includes(subpath));
            if (missing.length) offenders.push(`${dir}: undocumented ${missing.join(', ')}`);
            if (unknown.length)
                offenders.push(`${dir}: documents ${unknown.join(', ')}, not exported`);
        }
        assert.deepEqual(offenders, [], offenders.join('\n'));
    });

    test('"what this is not" says something concrete', () => {
        const thin = [];
        for (const { dir, readme } of all) {
            const section = readme.split('## What this is not')[1]?.split('\n## ')[0] ?? '';
            const words = section.trim().split(/\s+/).filter(Boolean).length;
            if (words < 20) thin.push(`${dir}: ${words} words`);
        }
        assert.deepEqual(
            thin,
            [],
            `This is the section that saves the question.\n${thin.join('\n')}`,
        );
    });
});
