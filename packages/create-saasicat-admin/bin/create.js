#!/usr/bin/env node
// `pnpm create saasicat-admin <dir>` — scaffold.
//
// Reads all `*.tpl` files from `../templates/`, replaces `__KEY__` tokens, writes
// into `<dir>/`. Tokens come from argv flags + defaults.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P6.

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';

// The scaffolded project must depend on the platform packages that match this
// scaffolder. All packages are released in lockstep, so our own version is the
// correct range — deriving it here keeps the template from drifting out of
// date on every release (a hardcoded `^0.1.0` would not match `0.2.0`, because
// caret pins the minor for 0.x versions).
const OWN_VERSION = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

export const DEFAULT_TOKENS = {
    PROJECT_KEY: 'app',
    BRAND_NAME: 'App',
    LOGO_TEXT: 'AP',
    API_BASE: '/api/v1/admin',
    DEV_PORT: '9100',
    BACKEND_PORT: '3000',
    PLATFORM_VERSION: `^${OWN_VERSION}`,
};

const TOKEN_FLAGS = {
    'project-key': 'PROJECT_KEY',
    'brand-name': 'BRAND_NAME',
    'logo-text': 'LOGO_TEXT',
    'api-base': 'API_BASE',
    'dev-port': 'DEV_PORT',
    'backend-port': 'BACKEND_PORT',
};

export function parseArgs(argv) {
    const positionals = [];
    const flags = { dryRun: false, noInstall: false };
    const tokens = { ...DEFAULT_TOKENS };
    for (const arg of argv) {
        if (arg === '--dry-run') {
            flags.dryRun = true;
            continue;
        }
        if (arg === '--no-install') {
            flags.noInstall = true;
            continue;
        }
        if (arg.startsWith('--')) {
            const [key, value] = arg.slice(2).split('=');
            if (TOKEN_FLAGS[key]) {
                tokens[TOKEN_FLAGS[key]] = value ?? '';
            }
            continue;
        }
        positionals.push(arg);
    }
    return { positionals, flags, tokens };
}

export function applyTokens(content, tokens) {
    return content.replace(/__([A-Z_]+)__/g, (full, key) => {
        const value = tokens[key];
        return value === undefined ? full : value;
    });
}

export async function walkTemplates(root) {
    const out = [];
    async function recurse(dir) {
        const entries = await readdir(dir);
        for (const entry of entries) {
            const full = join(dir, entry);
            const st = await stat(full);
            if (st.isDirectory()) {
                await recurse(full);
            } else if (entry.endsWith('.tpl')) {
                const rel = relative(root, full).replace(/\.tpl$/, '');
                out.push({ relPath: rel, absPath: full });
            }
        }
    }
    await recurse(root);
    return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

export async function scaffold({ targetDir, templatesDir, tokens, dryRun = false }) {
    const files = await walkTemplates(templatesDir);
    // Merge over the defaults so intrinsic tokens (PLATFORM_VERSION) are always
    // present — a caller passing only the user-facing tokens must not end up
    // with an unsubstituted dependency range in the generated package.json.
    const effectiveTokens = { ...DEFAULT_TOKENS, ...tokens };
    const writes = [];
    for (const { relPath, absPath } of files) {
        const raw = await readFile(absPath, 'utf8');
        const rendered = applyTokens(raw, effectiveTokens);
        const dest = join(targetDir, relPath);
        writes.push({ relPath, dest, rendered });
    }
    if (dryRun) return writes;
    await mkdir(targetDir, { recursive: true });
    for (const w of writes) {
        await mkdir(dirname(w.dest), { recursive: true });
        await writeFile(w.dest, w.rendered, 'utf8');
    }
    return writes;
}

async function main() {
    const argv = process.argv.slice(2);
    const { positionals, flags, tokens } = parseArgs(argv);

    if (positionals.length === 0 || positionals[0] === '--help' || positionals[0] === '-h') {
        console.log('Usage: pnpm create saasicat-admin <dir> [flags]');
        console.log('');
        console.log('Flags:');
        console.log('  --project-key=app           storage key prefix');
        console.log('  --brand-name=App            brand name in the header');
        console.log('  --logo-text=AP              two-letter badge');
        console.log('  --api-base=/api/v1/admin    backend prefix');
        console.log('  --dev-port=9100             Vite port');
        console.log('  --backend-port=3000         backend port (Vite proxy)');
        console.log('  --dry-run                   only list what would be created');
        console.log('  --no-install                stop after generating, skip pnpm install');
        process.exit(0);
    }

    const targetDir = resolve(positionals[0]);
    if (existsSync(targetDir) && !flags.dryRun) {
        const contents = await readdir(targetDir).catch(() => []);
        if (contents.length > 0) {
            console.error(`✗ Target directory ${targetDir} is not empty. Aborting.`);
            process.exit(1);
        }
    }

    const templatesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
    if (!existsSync(templatesDir)) {
        console.error(`✗ Templates not found: ${templatesDir}`);
        process.exit(99);
    }

    const writes = await scaffold({
        targetDir,
        templatesDir,
        tokens,
        dryRun: flags.dryRun,
    });

    if (flags.dryRun) {
        console.log(`(--dry-run) Would create in ${targetDir}:`);
        for (const w of writes) console.log(`    ${w.relPath}`);
        return;
    }

    console.log(`✓ Created ${writes.length} file(s) in ${targetDir}`);
    for (const w of writes) console.log(`    ${w.relPath}`);

    console.log('');
    console.log('Next steps:');
    console.log(`  cd ${relative(process.cwd(), targetDir) || '.'}`);
    console.log('  pnpm install');
    console.log('  pnpm dev');
    console.log('');
    console.log(`Adapt the login adapter (\`src/services/http.ts#adminLogin\`) to your backend.`);
}

/**
 * True when this file is the entry point rather than an import.
 *
 * Compares real paths: package managers expose the bin through a symlink in
 * `node_modules/.bin/`, so under `npm create` / `npx` the invoked path and the
 * module path differ and a plain string comparison silently skips `main()`.
 */
function isDirectInvocation() {
    if (!process.argv[1]) return false;
    try {
        return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
    } catch {
        return false;
    }
}

if (isDirectInvocation()) {
    main().catch((err) => {
        console.error('✗ ' + (err?.message ?? String(err)));
        process.exit(99);
    });
}
