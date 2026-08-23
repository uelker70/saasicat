// Writes the released version of `@saasicat/spec` into the OpenAPI document.
//
// `info.version` is required by OpenAPI and was `0.1.0-draft` while the package
// shipped 53 paths in a lockstep group at 0.27.0 — a version claim that had
// stopped describing anything. Making it true by hand is not an option either:
// Changesets bumps `package.json`, nothing bumps YAML, and the next release
// would make the claim false again the moment it landed.
//
// So the release does it. `pnpm run release:version` runs `changeset version`
// and then this script, which means the version PR carries the stamped document
// and the drift test in `packages/spec/tests` holds on every commit.
//
// The document is edited as text, not parsed and re-emitted: a YAML round-trip
// would reflow 1,700 lines of hand-formatted contract, and the reviewer of a
// release PR should see one line change.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'packages/spec/package.json');
const DOCUMENT = join(ROOT, 'packages/spec/admin-api.openapi.yaml');

/** The `info.version:` line, which sits at one fixed indentation under `info:`. */
const VERSION_LINE = '    version: ';

export function stampedDocument(text, version) {
    const lines = text.split('\n');
    const index = lines.findIndex((line) => line.startsWith(VERSION_LINE));
    if (index === -1) throw new Error(`no "${VERSION_LINE.trim()}" line in the OpenAPI document`);
    lines[index] = `${VERSION_LINE}${version}`;
    return lines.join('\n');
}

const version = JSON.parse(readFileSync(MANIFEST, 'utf8')).version;
const before = readFileSync(DOCUMENT, 'utf8');
const after = stampedDocument(before, version);

if (after !== before) {
    writeFileSync(DOCUMENT, after);
    process.stdout.write(`admin-api.openapi.yaml: info.version -> ${version}\n`);
}
