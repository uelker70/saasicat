#!/usr/bin/env node
// `pnpm create saasicat-admin <dir>` — Scaffold.
//
// Liest alle `*.tpl` aus `../templates/`, ersetzt Tokens `__KEY__`, schreibt
// in `<dir>/`. Tokens kommen aus Argv-Flags + Defaults.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P6.

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';

export const DEFAULT_TOKENS = {
    PROJECT_KEY: 'app',
    BRAND_NAME: 'App',
    LOGO_TEXT: 'AP',
    API_BASE: '/api/v1/admin',
    DEV_PORT: '9100',
    BACKEND_PORT: '3000',
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
    const writes = [];
    for (const { relPath, absPath } of files) {
        const raw = await readFile(absPath, 'utf8');
        const rendered = applyTokens(raw, tokens);
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
        console.log('  --project-key=app           Storage-Key-Prefix');
        console.log('  --brand-name=App            Brand-Name im Header');
        console.log('  --logo-text=AP              2-Letter-Badge');
        console.log('  --api-base=/api/v1/admin    Backend-Prefix');
        console.log('  --dev-port=9100             Vite-Port');
        console.log('  --backend-port=3000         Backend-Port (Vite-Proxy)');
        console.log('  --dry-run                   listet nur, was erzeugt würde');
        console.log('  --no-install                springt nach Erzeugung raus, kein pnpm install');
        process.exit(0);
    }

    const targetDir = resolve(positionals[0]);
    if (existsSync(targetDir) && !flags.dryRun) {
        const contents = await readdir(targetDir).catch(() => []);
        if (contents.length > 0) {
            console.error(`✗ Zielverzeichnis ${targetDir} ist nicht leer. Abbruch.`);
            process.exit(1);
        }
    }

    const templatesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
    if (!existsSync(templatesDir)) {
        console.error(`✗ Templates nicht gefunden: ${templatesDir}`);
        process.exit(99);
    }

    const writes = await scaffold({
        targetDir,
        templatesDir,
        tokens,
        dryRun: flags.dryRun,
    });

    if (flags.dryRun) {
        console.log(`(--dry-run) Würde anlegen in ${targetDir}:`);
        for (const w of writes) console.log(`    ${w.relPath}`);
        return;
    }

    console.log(`✓ ${writes.length} Datei(en) erzeugt unter ${targetDir}`);
    for (const w of writes) console.log(`    ${w.relPath}`);

    console.log('');
    console.log('Nächste Schritte:');
    console.log(`  cd ${relative(process.cwd(), targetDir) || '.'}`);
    console.log('  pnpm install');
    console.log('  pnpm dev');
    console.log('');
    console.log(`Login-Adapter (\`src/services/http.ts#adminLogin\`) an dein Backend anpassen.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error('✗ ' + (err?.message ?? String(err)));
        process.exit(99);
    });
}
