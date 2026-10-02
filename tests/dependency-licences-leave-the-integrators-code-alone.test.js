// Every package the published packages bring into an application is under a
// licence whose conditions stop at notices, so building a product on SaaSiCat
// never obliges anybody to publish or relicense their own code.
//
// The packages are read off the installed tree, from what each published
// manifest declares — dependencies and peer dependencies, all the way down —
// rather than from a list here, so a dependency added tomorrow is checked
// tomorrow. Development dependencies are not walked: they build and test
// SaaSiCat. The one way one still reaches an integrator is a file a package
// copies out of it into what it publishes, and those are checked below too.

// @requirement SC-SEC-012 — A new dependency's licence is part of the decision to add it

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';

import {
    dependencyTree,
    isPermissive,
    licenceOf,
    licenceOfText,
} from '../scripts/dependency-licences.mjs';
import {
    VENDOR_COPIES,
    isNotice,
    licenceFilesOf,
    licencesOfCopy,
} from '../packages/ui-vue/scripts/vendor-copies.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = join(ROOT, 'packages');

/** The directory of every package this repository publishes. */
function publishedPackageRoots() {
    return readdirSync(PACKAGES)
        .map((name) => join(PACKAGES, name))
        .filter((dir) => existsSync(join(dir, 'package.json')))
        .filter(
            (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).private !== true,
        );
}

describe('how a licence is read', () => {
    test('a permissive licence, in the spellings packages use, is accepted', () => {
        for (const expression of [
            'MIT',
            'Apache-2.0',
            'Apache 2.0',
            'BSD-3-Clause',
            'ISC',
            '0BSD',
        ]) {
            assert.equal(isPermissive(expression), true, expression);
        }
    });

    test('a copyleft licence is refused, weak or strong', () => {
        for (const expression of [
            'GPL-3.0-only',
            'AGPL-3.0-or-later',
            'LGPL-2.1',
            'MPL-2.0',
            'SSPL-1.0',
        ]) {
            assert.equal(isPermissive(expression), false, expression);
        }
    });

    test('a choice is accepted where one alternative is permissive, a combination only where all are', () => {
        assert.equal(isPermissive('(MIT OR GPL-3.0-only)'), true);
        assert.equal(isPermissive('(MIT AND GPL-3.0-only)'), false);
        assert.equal(isPermissive('(MIT AND BSD-3-Clause)'), true);
    });

    test('a licence that cannot be read is refused rather than assumed', () => {
        for (const expression of [null, undefined, '', 'UNLICENSED', 'SEE LICENSE IN LICENSE.md']) {
            assert.equal(isPermissive(expression), false, String(expression));
        }
    });

    test('the deprecated list form reads as alternatives', () => {
        assert.equal(
            licenceOf({ licenses: [{ type: 'MIT' }, { type: 'GPL-2.0' }] }),
            'MIT OR GPL-2.0',
        );
        assert.equal(licenceOf({ license: { type: 'ISC' } }), 'ISC');
        assert.equal(licenceOf({}), null);
    });
});

/** The two sentences every MIT licence file carries, broken across lines as files break them. */
const MIT_TEXT =
    'MIT License\n\nPermission is hereby granted, free\nof charge, to any person obtaining a copy ' +
    '...\nThe above copyright notice and this permission notice shall be included in all copies ' +
    'or\nsubstantial portions of the Software.';

describe('how a licence file is read', () => {
    test('the permissive licences are recognised by their own wording, across line breaks', () => {
        assert.equal(licenceOfText(MIT_TEXT), 'MIT');
        assert.equal(
            licenceOfText(
                'Apache License\n  Version 2.0, January 2004\n\nTERMS AND CONDITIONS FOR USE, ' +
                    'REPRODUCTION, AND\nDISTRIBUTION',
            ),
            'Apache-2.0',
        );
    });

    test('anything else, a copyleft licence or an empty file, is not recognised', () => {
        assert.equal(licenceOfText('GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007'), null);
        assert.equal(licenceOfText('Attribution-ShareAlike 4.0 International'), null);
        assert.equal(licenceOfText(''), null);
    });

    test('the Open Font Licence is not read as MIT, though it opens with the same sentence', () => {
        assert.equal(
            licenceOfText(
                'SIL OPEN FONT LICENSE Version 1.1\nPERMISSION & CONDITIONS\nPermission is hereby ' +
                    'granted, free of charge, to any person obtaining a copy of the Font Software',
            ),
            null,
        );
    });

    test('a text with a permissive part and another part is read as neither', () => {
        assert.equal(licenceOfText(`${MIT_TEXT}\n\nThe fonts: GNU GENERAL PUBLIC LICENSE`), null);
    });

    test('a file that only mentions a licence is not that licence', () => {
        assert.equal(
            licenceOfText('This file is compatible with the Apache License, Version 2.0.'),
            null,
        );
        assert.equal(
            licenceOfText('MIT License\nPermission is hereby granted, free of charge'),
            null,
        );
    });
});

describe('what the published packages bring into an application', () => {
    const { packages, unreadable } = dependencyTree(publishedPackageRoots());

    test('the walk reaches the tree', () => {
        // Without this the two below pass over nothing, which is what a
        // guard that has stopped looking looks like.
        assert.ok(packages.length >= 50, `only ${packages.length} packages found`);
        assert.ok(
            packages.some((entry) => entry.name === '@nestjs/common'),
            'a peer dependency is not followed',
        );
        // A peer of a peer: `@nestjs/common` requires it, no published manifest
        // names it, and every application that installs Nest gets it.
        assert.ok(
            packages.some((entry) => entry.name === 'reflect-metadata'),
            "a dependency's own peer dependency is not followed",
        );
    });

    test('every dependency it needs is installed, so its licence can be read', () => {
        assert.deepEqual(unreadable, []);
    });

    test('every one of them leaves the integrator’s code alone', () => {
        const refused = packages
            .filter((entry) => !isPermissive(entry.licence))
            .map(
                (entry) =>
                    `${entry.name}@${entry.version}: ${entry.licence ?? 'no licence stated'}`,
            );
        assert.deepEqual(
            refused,
            [],
            'a licence outside scripts/dependency-licences.mjs is a decision to make before ' +
                'the dependency is added, not after (SC-SEC-012)',
        );
    });
});

describe('what @saasicat/ui-vue copies out of a development dependency', () => {
    const require = createRequire(join(PACKAGES, 'ui-vue', 'package.json'));

    /** The manifest of the package a copy comes from. */
    function sourceManifest(copy) {
        const name = copy.from.startsWith('@')
            ? copy.from.split('/').slice(0, 2).join('/')
            : copy.from.split('/')[0];
        const root = licenceFilesOf(require.resolve(copy.from)).find((l) => l.packageRoot);
        assert.ok(root, `${name} states no licence at its root`);
        const manifest = JSON.parse(readFileSync(join(root.path, '..', 'package.json'), 'utf8'));
        assert.equal(manifest.name, name, 'the licence was read from another package');
        return manifest;
    }

    for (const copy of VENDOR_COPIES) {
        test(`${copy.what} comes from a package under a permissive licence`, () => {
            const manifest = sourceManifest(copy);
            assert.equal(
                isPermissive(licenceOf(manifest)),
                true,
                `${manifest.name}: ${licenceOf(manifest)}`,
            );
        });

        test(`${copy.what} is governed only by permissive licence texts`, () => {
            const refused = licencesOfCopy(copy, require.resolve(copy.from))
                .filter((licence) => !isNotice(licence))
                .filter(
                    (licence) => !isPermissive(licenceOfText(readFileSync(licence.path, 'utf8'))),
                )
                .map((licence) => licence.path);
            assert.deepEqual(refused, [], 'a licence text that is not one of the permissive ones');
        });
    }
});
