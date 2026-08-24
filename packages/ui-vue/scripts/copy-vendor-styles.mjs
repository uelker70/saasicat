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
// The icon font goes with it. The admin renders `q-icon` with Material names
// since the hand-drawn glyphs were removed, so without the font every icon is a
// ligature name rendered as words.
//
// Copied rather than re-exported: `exports` cannot point into `node_modules`,
// and a consumer resolving `quasar/dist/quasar.css` themselves is exactly the
// dependency this removes.

import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(PACKAGE, 'dist', 'assets');
const require = createRequire(join(PACKAGE, 'package.json'));

mkdirSync(ASSETS, { recursive: true });

cpSync(require.resolve('quasar/dist/quasar.css'), join(ASSETS, 'quasar.css'));

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
const WANTED = /\.(css|woff2?|ttf|eot)$/;
const icons = dirname(require.resolve('@quasar/extras/material-icons/material-icons.css'));
const target = join(ASSETS, 'material-icons');

function copyWanted(from, to) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
        const source = join(from, entry.name);
        if (entry.isDirectory()) copyWanted(source, join(to, entry.name));
        // Not everything: the directory also holds a JavaScript index of icon
        // names this package does not use, which would ship as output no entry
        // point reaches. `dist-is-self-contained` reported exactly those three.
        else if (WANTED.test(entry.name)) cpSync(source, join(to, entry.name));
    }
}

copyWanted(icons, target);

console.log('copy-vendor-styles: quasar.css + material-icons');
