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
 * The licences a copied file is accepted under, by their whole text: one file
 * per licence in `licence-texts/`, named by its SPDX id.
 *
 * A licence file is recognised only when it is one of these word for word,
 * apart from what differs from copy to copy — its title, its copyright notices,
 * case and line breaks. Anything added — a sentence putting the fonts under the
 * Open Font Licence, a Commons Clause rider, "portions are GPL-3.0" — makes it a
 * different text, and a different text is refused. The reading errs that way on
 * purpose: a licence file reworded upstream fails until somebody has read it,
 * which is the decision `SC-SEC-012` asks for. Searching a text for the wording
 * of the licences off the list instead could never name them all.
 *
 * One thing is not read: a copyright notice, whose holders and years differ in
 * every copy, so terms named inside one are not seen.
 *
 * Only the licences a copy ships under today have a text here; a copy under
 * another one is refused until its text is added beside these.
 */
const LICENCE_TEXTS = [
    // Titled "MIT License", "The MIT License (MIT)" and so on: a line of these
    // words alone is a title.
    { id: 'MIT', title: new Set(['the', 'mit', 'license']) },
    // Its heading is part of the text, the same in every copy.
    { id: 'Apache-2.0', title: new Set() },
];

/**
 * What follows the word in a copyright notice — a mark, a year, a placeholder —
 * and not in a sentence that happens to open a line with it, such as the MIT
 * licence's "copyright holders be liable" wrapped onto a line of its own.
 */
const NOTICE_STARTS = ['(c)', '©', '[', '<', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function isCopyrightNotice(line) {
    if (!line.startsWith('copyright ')) return false;
    const rest = line.slice('copyright '.length).trimStart();
    return NOTICE_STARTS.some((start) => rest.startsWith(start));
}

const isTitle = (line, title) =>
    title.size > 0 && line.split(/\s+/).every((word) => title.has(word.replace(/[()]/g, '')));

/** A licence file's words, without its title and copyright notices, case or line breaks. */
function wordsOf(text, title) {
    const lines = String(text)
        .toLowerCase()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !isCopyrightNotice(line));
    const start = lines.findIndex((line) => !isTitle(line, title));
    if (start === -1) return [];
    return lines.slice(start).join(' ').split(/\s+/);
}

const ACCEPTED_TEXTS = LICENCE_TEXTS.map(({ id, title }) => ({
    id,
    title,
    words: wordsOf(
        readFileSync(new URL(`./licence-texts/${id}.txt`, import.meta.url), 'utf8'),
        title,
    ),
}));

/** The SPDX id of the licence a licence file's text is, or null where it is none of them. */
export function licenceOfText(text) {
    const match = ACCEPTED_TEXTS.find(({ title, words }) => {
        const found = wordsOf(text, title);
        return found.length === words.length && found.every((word, i) => word === words[i]);
    });
    return match?.id ?? null;
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
