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

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

const TEXTS = join(ROOT, 'scripts', 'licence-texts');

/** The MIT licence as the accepted text has it: a title and a placeholder notice. */
const MIT = readFileSync(join(TEXTS, 'MIT.txt'), 'utf8');

/** The MIT licence as a package ships it, under a title and a holder of its own. */
const SHIPPED_MIT = MIT.replace('MIT License', 'The MIT License (MIT)').replace(
    '<year> <copyright holders>',
    '2015-present Razvan Stoenescu',
);

/** The licence files that govern a copy and are not one of the permissive texts. */
const refusedLicences = (copy, source) =>
    licencesOfCopy(copy, source)
        .filter((licence) => !isNotice(licence))
        .filter((licence) => !isPermissive(licenceOfText(readFileSync(licence.path, 'utf8'))))
        .map((licence) => licence.path);

describe('how a licence file is read', () => {
    test('a permissive licence is recognised word for word, whatever its title, holders and line breaks', () => {
        assert.equal(licenceOfText(MIT), 'MIT');
        assert.equal(licenceOfText(SHIPPED_MIT), 'MIT');
        assert.equal(
            licenceOfText(
                SHIPPED_MIT.replace(
                    'Copyright (c) 2015-present Razvan Stoenescu',
                    'Copyright (c) 2015 One\nCopyright 2016 Another',
                ),
            ),
            'MIT',
        );
        // Wrapped elsewhere, so that a sentence opens a line with "copyright".
        assert.equal(
            licenceOfText(
                SHIPPED_MIT.replace('AUTHORS OR COPYRIGHT', 'AUTHORS OR\nCOPYRIGHT').replace(
                    'to deal\nin',
                    'to deal in',
                ),
            ),
            'MIT',
        );
        assert.equal(
            licenceOfText(readFileSync(join(TEXTS, 'Apache-2.0.txt'), 'utf8')),
            'Apache-2.0',
        );
    });

    test('a permissive licence with anything added to it is not recognised', () => {
        for (const added of [
            'The font files are licensed under the SIL OFL 1.1.',
            'Icons: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
            'Portions are GPL-3.0.',
            '"Commons Clause" License Condition v1.0',
        ]) {
            assert.equal(licenceOfText(`${SHIPPED_MIT}\n${added}`), null, added);
        }
        assert.equal(licenceOfText(`MIT License, except the fonts\n\n${MIT}`), null);
    });

    test('a reworded licence is not recognised until somebody has read it', () => {
        assert.equal(licenceOfText(SHIPPED_MIT.replace('and/or sell', 'and/or')), null);
    });

    test('a copyright notice is not read, whatever else it says', () => {
        // The one place the reading looks away: holders and years differ in
        // every copy, so terms named inside a notice are not seen.
        assert.equal(
            licenceOfText(SHIPPED_MIT.replace('Stoenescu', 'Stoenescu; the fonts are OFL-1.1')),
            'MIT',
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
            assert.deepEqual(
                refusedLicences(copy, require.resolve(copy.from)),
                [],
                'a licence text that is not one of the permissive ones',
            );
        });
    }

    describe('a copy whose font is under terms of its own, in a package under MIT', () => {
        const scratch = mkdtempSync(join(tmpdir(), 'licence-texts-'));
        after(() => rmSync(scratch, { recursive: true, force: true }));
        const pkg = join(scratch, 'node_modules', 'font-pkg');
        mkdirSync(join(pkg, 'font'), { recursive: true });
        writeFileSync(join(pkg, 'package.json'), '{"name":"font-pkg","license":"MIT"}');
        writeFileSync(join(pkg, 'LICENSE'), SHIPPED_MIT);
        writeFileSync(join(pkg, 'font', 'font.css'), '@font-face {}');
        writeFileSync(
            join(pkg, 'font', 'OFL.txt'),
            'SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007',
        );
        const source = join(pkg, 'font', 'font.css');

        test('is refused for the font’s licence, whatever the file holding it is called', () => {
            assert.deepEqual(
                refusedLicences({ from: source, to: 'font/font.css', directory: true }, source),
                [join(dirname(source), 'OFL.txt')],
            );
        });
    });
});
