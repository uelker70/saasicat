// What this package copies out of other packages into `dist/assets`, and the
// licence each copy carries with it.
//
// One list, read by the copy step and by the test that checks it: a copy made
// anywhere else would ship somebody's files without their terms, which their
// licence does not allow — MIT asks for its notice "in all copies or
// substantial portions", Apache-2.0 for a copy of the licence and any NOTICE.

import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, parse, relative } from 'node:path';

/**
 * - `from` — the file to copy, as a package resolves it.
 * - `to` — where it lands, relative to `dist/assets`.
 * - `directory` — copy the directory `from` sits in, keeping only the files
 *   `WANTED` matches, rather than the one file.
 */
export const VENDOR_COPIES = [
    { what: "Quasar's stylesheet", from: 'quasar/dist/quasar.css', to: 'quasar.css' },
    {
        what: 'the Material Icons font',
        from: '@quasar/extras/material-icons/material-icons.css',
        to: 'material-icons/material-icons.css',
        directory: true,
    },
];

/** The files a directory copy keeps: the stylesheet and the fonts it names. */
export const WANTED = /\.(css|woff2?|ttf|eot)$/;

/**
 * A licence or notice file, by how its name begins — packages name them every
 * way: `LICENSE`, `LICENSE.md`, `LICENSE-MIT`, `COPYING`, `NOTICE`, a font's
 * `OFL.txt`. Read wide on purpose: a licence missed would ship a copy without
 * its terms, while a file taken for one that is not costs an extra file and a
 * look.
 */
const LICENCE_FILE = /^(licen[cs]e|copying|notice|ofl|unlicense)([-._].*)?$/i;

/**
 * The licence and notice files that govern `file`, the nearest first: those in
 * its own directory and in every one above it, up to its package's root.
 *
 * All of them, not only the nearest: a directory inside a package may carry
 * terms of its own — the icon font is Apache-2.0 inside a package that is MIT —
 * while the files the package wrote around it, such as the stylesheet that
 * declares the font, are under the package's.
 *
 * `nearest` marks those in the first directory, from the file up, that has
 * any; `packageRoot` those in the package's root directory.
 */
export function licenceFilesOf(file) {
    const found = [];
    let nearestDir = null;
    for (let dir = dirname(file); ; dir = dirname(dir)) {
        const atRoot = existsSync(join(dir, 'package.json'));
        for (const name of readdirSync(dir).filter((entry) => LICENCE_FILE.test(entry))) {
            nearestDir ??= dir;
            found.push({ path: join(dir, name), nearest: dir === nearestDir, packageRoot: atRoot });
        }
        if (atRoot || dirname(dir) === dir) return found;
    }
}

/**
 * Whether a governing file is a notice — who made it — rather than the terms
 * it is under. Read off the file's own name: a directory on the way may be
 * called anything.
 */
export function isNotice(licence) {
    return /^notice/i.test(basename(licence.path));
}

/**
 * Every licence and notice file that governs what `copy` puts into
 * `dist/assets`, given the file it resolves to: those from the file's directory
 * up to its package's root, and — for a directory copy, which takes the
 * subdirectories along — those inside each subdirectory it copies, which
 * govern the files there. `within` names that subdirectory, relative to the
 * copied directory.
 */
export function licencesOfCopy(copy, source) {
    const governing = licenceFilesOf(source);
    if (!copy.directory) return governing;
    const top = dirname(source);
    const visit = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const sub = join(dir, entry.name);
            for (const name of readdirSync(sub).filter((file) => LICENCE_FILE.test(file))) {
                governing.push({
                    path: join(sub, name),
                    nearest: true,
                    packageRoot: false,
                    within: relative(top, sub),
                });
            }
            visit(sub);
        }
    };
    visit(top);
    return governing;
}

/**
 * Where a copy's licence file lands, relative to `dist/assets`: beside a file
 * as `<file>.<NAME>.txt`, or inside a copied directory as `<NAME>.txt` — inside
 * the copied subdirectory it governs, where it came from one. One from further
 * up is named for where it came from — `PACKAGE-` for the package's root — so
 * the terms of the directory and of the package both ship and neither
 * overwrites the other.
 */
export function licenceTarget(copy, licence) {
    const base = parse(licence.path).name.toUpperCase();
    const prefix = licence.nearest
        ? ''
        : licence.packageRoot
          ? 'PACKAGE-'
          : `${basename(dirname(licence.path)).toUpperCase()}-`;
    const name = `${prefix}${base}`;
    if (!copy.directory) return `${copy.to}.${name}.txt`;
    return join(dirname(copy.to), licence.within ?? '', `${name}.txt`);
}
