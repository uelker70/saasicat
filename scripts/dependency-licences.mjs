// The licences of what the published packages bring into an integrator's
// application, and whether each one leaves that application's own code alone.
//
// SaaSiCat ships under PolyForm Shield, and an integrator builds a product of
// their own on it. A copyleft dependency anywhere below would put conditions on
// that product — publishing its source, licensing it alike — that neither
// SaaSiCat's terms nor the integrator agreed to (`SC-SEC-012`). Only licences
// whose conditions stop at notices are accepted; anything else, including a
// licence that cannot be read, is reported rather than assumed.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Licences whose conditions are notices and attribution, nothing that reaches
 * the code of whoever uses the package. A licence missing here is not a verdict
 * on it: it is a decision somebody has to make before the dependency is added.
 */
export const PERMISSIVE = new Set([
    '0BSD',
    'Apache-2.0',
    'BlueOak-1.0.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'CC0-1.0',
    'ISC',
    'MIT',
    'MIT-0',
    'Python-2.0',
    'Unlicense',
    'Zlib',
]);

/** Spellings packages use for a licence on the list, by the SPDX id they mean. */
const SPELLINGS = new Map([['Apache 2.0', 'Apache-2.0']]);

/**
 * What a licence file's text states, as an SPDX id — or null where it is none
 * of these, or where it also carries another licence's wording.
 *
 * A text is recognised by phrases from each licence's body rather than its
 * title, and by more than its opening sentence: the MIT permission sentence
 * also opens the SIL Open Font Licence, so MIT needs its notice clause too, and
 * Apache-2.0 needs its terms heading, which a file that only mentions it lacks.
 * A text that also uses the wording of a licence off the list — a file with an
 * MIT part and a GPL part, say — is read as neither. Plain substring tests,
 * compared without case: the text is another package's file, and nothing of it
 * becomes a pattern.
 */
const LICENCE_TEXTS = [
    [
        'Apache-2.0',
        [
            'apache license',
            'version 2.0',
            'terms and conditions for use, reproduction, and distribution',
        ],
    ],
    [
        'MIT',
        [
            'permission is hereby granted, free of charge',
            'shall be included in all copies or substantial portions of the software',
        ],
    ],
    ['ISC', ['permission to use, copy, modify, and/or distribute this software for any purpose']],
    ['BSD-3-Clause', ['redistribution and use in source and binary forms', 'neither the name']],
    ['BSD-2-Clause', ['redistribution and use in source and binary forms']],
];

/** Wording of licences that are not on the list; any of it disqualifies a text. */
const OTHER_LICENCES = [
    // GPL, LGPL and AGPL alike.
    'general public license',
    'mozilla public license',
    'eclipse public license',
    'european union public licence',
    'common development and distribution license',
    'server side public license',
    'creative commons',
    'open font license',
    'font software',
];

export function licenceOfText(text) {
    const flat = String(text).toLowerCase().split(/\s+/).join(' ');
    if (OTHER_LICENCES.some((wording) => flat.includes(wording))) return null;
    for (const [id, phrases] of LICENCE_TEXTS) {
        if (phrases.every((phrase) => flat.includes(phrase))) return id;
    }
    return null;
}

/** A manifest's licence as one SPDX expression, or null where it states none. */
export function licenceOf(manifest) {
    if (typeof manifest.license === 'string') return manifest.license;
    if (manifest.license && typeof manifest.license.type === 'string') return manifest.license.type;
    // The form npm deprecated: a list of alternatives.
    if (Array.isArray(manifest.licenses) && manifest.licenses.length > 0) {
        const types = manifest.licenses.map((entry) => entry?.type).filter(Boolean);
        return types.length > 0 ? types.join(' OR ') : null;
    }
    return null;
}

/**
 * Whether an SPDX expression leaves the user's code alone: one alternative of
 * an `OR` that does is enough, and every part of an `AND` has to. Parentheses
 * are read only as far as these packages write them — one level, one operator.
 */
export function isPermissive(expression) {
    if (typeof expression !== 'string' || expression.trim() === '') return false;
    const bare = expression.trim().replace(/^\((.*)\)$/, '$1');
    if (bare.includes(' OR ')) return bare.split(' OR ').some((part) => isPermissive(part));
    if (bare.includes(' AND ')) return bare.split(' AND ').every((part) => isPermissive(part));
    const id = SPELLINGS.get(bare.trim()) ?? bare.trim();
    return PERMISSIVE.has(id);
}

/**
 * The directory of `name` as Node would find it from `fromDir`: the nearest
 * `node_modules/<name>` on the way up. Read directly rather than through
 * `require.resolve`, which an `exports` map without `./package.json` refuses.
 */
function packageDir(name, fromDir) {
    for (let dir = fromDir; ; dir = dirname(dir)) {
        const candidate = join(dir, 'node_modules', name);
        if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
        if (dirname(dir) === dir) return null;
    }
}

const readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

/**
 * Every package a published package brings in, at the version installed here:
 * its dependencies and peer dependencies, and theirs, all the way down — a
 * dependency's own peer is installed into the application too, by npm 7 and
 * later and by pnpm. A dependency that is not installed is reported as
 * unreadable, except an optional one, which a platform may legitimately leave
 * out.
 */
export function dependencyTree(packageRoots) {
    const found = new Map();
    const unreadable = [];
    const visit = (dir, manifest) => {
        const declared = [
            ...Object.keys(manifest.dependencies ?? {}).map((name) => [name, false]),
            ...Object.keys(manifest.optionalDependencies ?? {}).map((name) => [name, true]),
            ...Object.keys(manifest.peerDependencies ?? {}).map((name) => [
                name,
                manifest.peerDependenciesMeta?.[name]?.optional === true,
            ]),
        ];
        for (const [name, optional] of declared) {
            if (name.startsWith('@saasicat/')) continue;
            const depDir = packageDir(name, dir);
            if (!depDir) {
                if (!optional) unreadable.push(`${name} (needed by ${manifest.name})`);
                continue;
            }
            if (found.has(depDir)) continue;
            const depManifest = readManifest(depDir);
            found.set(depDir, {
                name: depManifest.name,
                version: depManifest.version,
                licence: licenceOf(depManifest),
            });
            visit(depDir, depManifest);
        }
    };
    for (const root of packageRoots) visit(realpathSync(root), readManifest(root));
    return { packages: [...found.values()], unreadable };
}
