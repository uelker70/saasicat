#!/usr/bin/env node
// The two stylesheets a consumer used to install a framework to get.
//
// Quasar's CSS is a separate, explicit import — the JavaScript build does not
// pull it in, which is what makes bundling the components possible without
// taking over the consumer's document (measured: 76 computed properties across
// 19 of 19 elements in a host page that styles itself). So it stays something
// the consumer writes one line for; the only change is that the line names THIS
// package rather than one they had to install.
//
// Quasar's stylesheet is handed out by reference: `dist/assets/quasar.css`
// imports `quasar/dist/quasar.css`, which the application's bundler resolves
// from this package's own Quasar — the installation its JavaScript comes from.
// A copy was fixed at the release this package was built with, while the
// JavaScript followed the `^` range to the newest minor. `exports` cannot point
// into `node_modules`, which is why it is an import in a file of our own.
//
// The icon font is copied. The admin renders `q-icon` with Material names since
// the hand-drawn glyphs were removed, so without the font every icon is a
// ligature name rendered as words; a font file is fetched by URL, which an
// import in a stylesheet would leave to the application's server to answer.

import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    VENDOR_COPIES,
    VENDOR_IMPORTS,
    WANTED,
    importOf,
    licenceTarget,
    licencesOfCopy,
} from './vendor-copies.mjs';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(PACKAGE, 'dist', 'assets');
const require = createRequire(join(PACKAGE, 'package.json'));

// The stylesheet and the font files beside it, which it names by relative path
// — and nothing else. The directory also holds a JavaScript index of icon
// names, which this package does not use and which would ship as output no
// entry point reaches. `dist-is-self-contained` reported exactly those three
// files, which is the check earning its keep on a copy step.
// Recursive, because the fonts are not beside the stylesheet: it names them as
// `web-font/…`, a subdirectory. A flat copy took the CSS and left the font
// requests to be answered by the dev server's SPA fallback — the browser got
// HTML where a font should be and reported `invalid sfntVersion`. The consumer
// end-to-end suite is what read that back.
function copyWanted(from, to) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
        const source = join(from, entry.name);
        if (entry.isDirectory()) copyWanted(source, join(to, entry.name));
        else if (WANTED.test(entry.name)) cpSync(source, join(to, entry.name));
    }
}

for (const copy of VENDOR_COPIES) {
    const source = require.resolve(copy.from);
    const target = join(ASSETS, copy.to);
    if (copy.directory) {
        copyWanted(dirname(source), dirname(target));
    } else {
        mkdirSync(dirname(target), { recursive: true });
        cpSync(source, target);
    }
    // A copy without its terms is one the licence does not allow, so a source
    // that names none stops the build rather than shipping without them.
    const licences = licencesOfCopy(copy, source);
    if (licences.length === 0) {
        throw new Error(`copy-vendor-styles: no licence found for ${copy.what} (${copy.from}).`);
    }
    for (const licence of licences) {
        cpSync(licence.path, join(ASSETS, licenceTarget(copy, licence)));
    }
}

for (const reference of VENDOR_IMPORTS) {
    // Resolved here only to stop the build where the application could not
    // resolve it either: a stylesheet importing nothing would load as empty.
    require.resolve(reference.from);
    const target = join(ASSETS, reference.to);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, importOf(reference));
}

console.log(
    `copy-vendor-styles: ${VENDOR_COPIES.map((copy) => copy.to).join(' + ')}, with their licences; ` +
        `${VENDOR_IMPORTS.map((reference) => reference.to).join(' + ')} by reference`,
);
