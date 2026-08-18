import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { FullConfig } from '@playwright/test';

// Playwright's `globalSetup`, which runs once the `webServer` entries are up and
// before the first test — the last moment at which the suite can still refuse to
// measure.
//
// Outside CI the config keeps `reuseExistingServer: true`, so Playwright does not
// start anything if the fixture ports already answer: it attaches to whoever is
// there. With agent worktrees under `.claude/`, a second checkout of this
// repository listening on those ports is routine rather than exotic, and then the
// baselines are compared against a branch nobody measured — and the run reports a
// pass. A red run is annoying; that green one is how a regression ships.
//
// So each server is made to say which files it serves, and the answer has to be
// this checkout:
//
//   * A Vite dev server rewrites every import that leaves its root to
//     `/@fs/<absolute path>`. Those paths name the checkout it compiles from.
//   * The static fixture server discloses no paths, so it is asked for the
//     document and the bundle the fixture loads, and the bytes have to be the
//     bytes lying here.
//
// Neither probe asks the server to cooperate, so a server from ANY commit is
// caught — not only one new enough to know this file exists.

/** Every checkout of this repository has one of these at its root. */
const CHECKOUT_MARKER = 'pnpm-workspace.yaml';

/** Ceiling for a single probe request; all three servers are on localhost. */
const PROBE_TIMEOUT_MS = 30_000;

/** The document `serve.mjs` answers `/` with, and the fixture's whole page. */
const FIXTURE_DOCUMENT = 'tests-e2e/fixtures/index.html';

/**
 * The attributes of every `<script>` opening tag, whatever their order.
 *
 * Case-insensitive because HTML is: `<SCRIPT TYPE="module" SRC="…">` is the
 * same tag, and a pattern that misses it drops a resource from the fingerprint
 * silently — the check would then compare fewer files than it believes it does
 * and still report agreement.
 */
const SCRIPT_ATTRIBUTES = /<script\b([^>]*)>/gi;
const MODULE_TYPE = /\btype=["']module["']/i;
const SRC_ATTRIBUTE = /\bsrc=["']([^"']+)["']/i;

/** The dynamic imports of the fixture document — the code it pulls off the server. */
const DYNAMIC_IMPORT = /\bimport\(\s*(?<quote>['"])(?<specifier>[^'"]+)\k<quote>\s*\)/g;

/** Vite's dev rewrite for an import that leaves the dev server's root. */
const FS_IMPORT = /\/@fs(\/[^"'?\s)]+)/g;

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

const ADVICE = [
    'Playwright attached to a server it did not start: `reuseExistingServer` is on',
    'outside CI. Stop that server and run again, or run with CI=1 so Playwright',
    'insists on starting its own.',
].join('\n');

/**
 * The checkout a path belongs to, or `null` if it belongs to none.
 *
 * Both sides of the comparison are derived by this one rule, which is what makes
 * the two answers comparable. It resolves to the NEAREST marker on purpose: an
 * agent worktree lives inside the checkout it was made from, so a containment
 * test would call the inner one a match for the outer and wave through exactly
 * the collision this file exists for.
 */
function checkoutOf(startDir: string): string | null {
    // On Windows `/@fs/` prefixes a drive-qualified path, and the slash in front
    // of `C:/` is part of the URL rather than of the path.
    let dir = /^\/[A-Za-z]:\//.test(startDir) ? startDir.slice(1) : startDir;
    for (;;) {
        // Resolved before it is returned, because the two answers this function
        // produces arrive written differently. A path out of a `/@fs/` URL keeps
        // the URL's forward slashes — `C:/repo` — while `THIS_CHECKOUT` comes
        // from `fileURLToPath(import.meta.url)` and is `C:\repo`. They name one
        // directory and compare unequal, so every Vite-backed run on Windows
        // would report a foreign checkout and fail in global setup. `resolve`
        // puts both in the platform's own form; on POSIX it changes nothing.
        if (existsSync(join(dir, CHECKOUT_MARKER))) return resolve(dir);
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

const THIS_CHECKOUT = checkoutOf(PACKAGE_ROOT);

async function fetchText(url: string): Promise<{ status: number; body: string }> {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return { status: response.status, body: await response.text() };
}

function servesAnotherCheckout(baseURL: string, serving: string, evidence: string): string {
    return [
        `${baseURL} serves a different checkout of this repository.`,
        `    under test: ${THIS_CHECKOUT}`,
        `    serving:    ${serving}`,
        `    evidence:   ${evidence}`,
    ].join('\n');
}

function servesOtherBytes(baseURL: string, url: string, file: string): string {
    return [
        `${baseURL} does not serve the files of this checkout.`,
        `    requested:  ${url}`,
        `    expected:   the bytes of ${file}`,
        `    got:        something else`,
    ].join('\n');
}

/**
 * A Vite dev server, asked where the modules it compiles live.
 *
 * The modules to ask for are taken from the document the server itself hands
 * out, not named here, so the probe follows a fixture that renames its entry.
 * In practice the first of them answers: Vite injects its own client, and that
 * client is served out of the checkout's `node_modules` like everything else.
 * The app entry behind it is the fallback for a layout where it is not.
 */
async function viteDevServerComplaint(baseURL: string): Promise<string | null> {
    const page = await fetchText(new URL('/', baseURL).href);
    if (page.status !== 200) {
        return `${baseURL} answered ${page.status} for its own document.`;
    }

    for (const [, attributes] of page.body.matchAll(SCRIPT_ATTRIBUTES)) {
        const source = MODULE_TYPE.test(attributes) ? SRC_ATTRIBUTE.exec(attributes)?.[1] : null;
        if (!source) continue;

        const url = new URL(source, baseURL).href;
        const entry = await fetchText(url);
        if (entry.status !== 200) continue;

        let anchored = false;
        for (const [, path] of entry.body.matchAll(FS_IMPORT)) {
            const checkout = checkoutOf(dirname(path));
            // A path outside every checkout — a shared package store, say — says
            // nothing about which tree is being served, so it is not evidence
            // either way.
            if (checkout === null) continue;
            if (checkout !== THIS_CHECKOUT) {
                return servesAnotherCheckout(baseURL, checkout, `GET ${url} → /@fs${path}`);
            }
            anchored = true;
        }
        if (anchored) return null;
    }

    return [
        `Cannot tell which checkout ${baseURL} serves.`,
        '    No module it hands out names a file inside a checkout of this',
        '    repository. A Vite dev server rewrites imports that leave its root to',
        '    /@fs/<absolute path>, and these fixtures have such imports by',
        '    construction — so this reads as the probe having broken, not as a',
        '    server having nothing to hide.',
    ].join('\n');
}

/**
 * The static fixture server, asked for the document and what the document loads.
 *
 * It serves files verbatim and discloses no paths, so identity here is the bytes.
 * The dependencies behind the document's import map are third-party rather than
 * the code under test and are left out; the bundle it imports is the whole
 * platform, and its chunk file names carry content hashes, so comparing that one
 * file covers the graph behind it.
 */
async function staticFixtureServerComplaint(baseURL: string): Promise<string | null> {
    const documentPath = join(PACKAGE_ROOT, FIXTURE_DOCUMENT);
    const html = await readFile(documentPath, 'utf8');

    const served = await fetchText(new URL('/', baseURL).href);
    if (served.status !== 200) return `${baseURL} answered ${served.status} for /.`;
    if (served.body !== html) return servesOtherBytes(baseURL, `${baseURL}/`, documentPath);

    for (const { groups } of html.matchAll(DYNAMIC_IMPORT)) {
        const specifier = groups?.specifier ?? '';
        // Resolved twice from the one specifier: against the document's URL the
        // way the browser does it, and against the document's path the way
        // `serve.mjs` maps that URL back onto the package root.
        const url = new URL(specifier, `${baseURL}/`).href;
        const file = fileURLToPath(new URL(specifier, pathToFileURL(documentPath)));

        const module = await fetchText(url);
        if (module.status !== 200) return `${baseURL} answered ${module.status} for ${url}.`;
        if (module.body !== (await readFile(file, 'utf8'))) {
            return servesOtherBytes(baseURL, url, file);
        }
    }

    return null;
}

async function complaintAbout(baseURL: string): Promise<string | null> {
    try {
        // Vite serves its HMR client from a path no static file tree contains.
        const vite = await fetchText(new URL('/@vite/client', baseURL).href);
        return vite.status === 200
            ? await viteDevServerComplaint(baseURL)
            : await staticFixtureServerComplaint(baseURL);
    } catch (error) {
        return `${baseURL} could not be probed: ${error instanceof Error ? error.message : error}`;
    }
}

export default async function assertServersServeThisCheckout(config: FullConfig): Promise<void> {
    if (THIS_CHECKOUT === null) {
        throw new Error(
            `No ${CHECKOUT_MARKER} above ${PACKAGE_ROOT}: one checkout cannot be told ` +
                'from another here, so no server on these ports can be trusted either.',
        );
    }

    // The base URLs the projects talk to. Playwright starts every `webServer`
    // entry whatever `--project` selects, so all of them are equally exposed to
    // a stranger on their port.
    const baseURLs = [
        ...new Set(
            config.projects
                .map((project) => project.use.baseURL)
                .filter((baseURL): baseURL is string => baseURL !== undefined),
        ),
    ];

    const complaints: string[] = [];
    for (const baseURL of baseURLs) {
        const complaint = await complaintAbout(baseURL);
        if (complaint !== null) complaints.push(complaint);
    }

    if (complaints.length > 0) throw new Error([...complaints, ADVICE].join('\n\n'));
}
