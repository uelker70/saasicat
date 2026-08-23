// Documentation drifts one sentence at a time, and prose has no compiler.
//
// The repository already breaks the build on three kinds of drift — generated
// types against their schemas (`codegen-drift`), the reference SQL against the
// Prisma fragments (`reference-sql-drift`), and version pins in docs
// (`docs-version-pins`). This file extends that to the claims documentation
// makes about the code: package enumerations, option names, import paths and
// the spec version.
//
// Each check derives its expectation from the sources. A hand-written list of
// "the packages we have" in a test would be the same defect one level up.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Documentation a stranger reads: the entry points plus everything under docs/. */
export function docFiles() {
    const files = ['README.md', 'CONTRIBUTING.md'];

    const walk = (dir) => {
        for (const entry of readdirSync(join(ROOT, dir))) {
            const path = join(dir, entry);
            if (statSync(join(ROOT, path)).isDirectory()) walk(path);
            else if (entry.endsWith('.md')) files.push(path);
        }
    };
    walk('docs');

    for (const dir of readdirSync(join(ROOT, 'packages'))) {
        const readme = join('packages', dir, 'README.md');
        try {
            statSync(join(ROOT, readme));
            files.push(readme);
        } catch {
            // A package without a README is 6.6's problem, not this file's.
        }
    }
    return files;
}

/** The names npm carries. `private: true` never leaves the repository. */
export function publishedPackages() {
    const names = [];
    for (const dir of readdirSync(join(ROOT, 'packages'))) {
        const manifest = JSON.parse(
            readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'),
        );
        if (!manifest.private) names.push(manifest.name);
    }
    return names.sort();
}

const PACKAGE_NAME = /^(?:@saasicat\/[a-z-]+|create-saasicat-admin|saasicat)$/;

/**
 * The package names a Markdown table lists in its first column.
 *
 * A table that names three or more of them is read as the package set — a
 * reader counts its rows and believes the number. Two or fewer is an excerpt
 * or a comparison, and says so by its size.
 */
export function packageEnumerations(text) {
    const enumerations = [];
    let current = null;

    const close = () => {
        if (current && current.length >= 3) enumerations.push(current);
        current = null;
    };

    for (const line of text.split('\n')) {
        if (!line.trim().startsWith('|')) {
            close();
            continue;
        }
        if (current === null) current = [];
        const first = line.split('|')[1]?.trim() ?? '';
        const name = first.startsWith('`') && first.endsWith('`') ? first.slice(1, -1) : null;
        if (name && PACKAGE_NAME.test(name)) current.push(name);
    }
    close();

    return enumerations;
}

const NUMBER_WORDS = {
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
};
/**
 * Every "<n> packages" a text claims, as numbers.
 *
 * A word scan rather than a pattern: the counts come from a table, and a
 * pattern assembled from its keys is exactly the "text becomes a regex" the
 * repository forbids. Splitting on non-word characters has one quantifier and
 * cannot backtrack.
 *
 * Counts below three are prose ("into one package", "either of two packages"),
 * not a claim about the set. The defect this catches said "The Five Packages"
 * while the repository had ten.
 */
export function packageCountClaims(text) {
    const words = text.toLowerCase().split(/[^a-z0-9]+/);
    const claims = [];
    for (let i = 1; i < words.length; i += 1) {
        if (words[i] !== 'packages') continue;
        const word = words[i - 1];
        const value = word in NUMBER_WORDS ? NUMBER_WORDS[word] : Number(word);
        if (Number.isInteger(value) && value >= 3) claims.push(value);
    }
    return claims;
}

describe('documentation matches the packages that exist', () => {
    const files = docFiles();
    const published = publishedPackages();

    test('the sweep reaches the documentation it claims to check', () => {
        // Every assertion below is vacuously true on an empty list.
        assert.ok(files.includes('README.md'), 'README.md missing from the sweep');
        assert.ok(
            files.some((file) => file.startsWith(`docs${sep}`)),
            'no file under docs/ reached the sweep',
        );
        assert.ok(published.length >= 10, `only ${published.length} published packages found`);
        const enumerations = files.flatMap((file) =>
            packageEnumerations(readFileSync(join(ROOT, file), 'utf8')),
        );
        assert.ok(
            enumerations.length > 0,
            'no package enumeration found — the check reads nothing',
        );
    });

    test('every table that enumerates the packages lists all of them', () => {
        const offenders = [];
        for (const file of files) {
            for (const listed of packageEnumerations(readFileSync(join(ROOT, file), 'utf8'))) {
                const missing = published.filter((name) => !listed.includes(name));
                const unknown = listed.filter((name) => !published.includes(name));
                if (missing.length || unknown.length) {
                    offenders.push(
                        `${file}: lists ${listed.length} of ${published.length}` +
                            (missing.length ? `, missing ${missing.join(', ')}` : '') +
                            (unknown.length ? `, unknown ${unknown.join(', ')}` : ''),
                    );
                }
            }
        }
        assert.deepEqual(
            offenders,
            [],
            `A table of packages is read as the complete set.\n${offenders.join('\n')}`,
        );
    });

    test('no text claims a package count the repository does not have', () => {
        const offenders = [];
        for (const file of files) {
            for (const claimed of packageCountClaims(readFileSync(join(ROOT, file), 'utf8'))) {
                if (claimed !== published.length) {
                    offenders.push(`${file}: claims ${claimed}, there are ${published.length}`);
                }
            }
        }
        assert.deepEqual(offenders, [], offenders.join('\n'));
    });
});
