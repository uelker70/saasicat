#!/usr/bin/env node
// `saas-platform` — bootstrap CLI for the SaaS platform.
//
// Sub-commands:
//   schema apply [--prisma-schema=PATH] [--fragments=01,02,03]
//                [--all] [--dry-run]
//       Inserts missing platform Prisma models into your schema.prisma.
//       Idempotent; existing models are left untouched.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P5.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

import { applyFragmentBlocks, extractModelBlocks } from '../dist/index.js';

const require_ = createRequire(import.meta.url);

function parseArgs(argv) {
    const flags = {};
    for (const arg of argv) {
        if (arg.startsWith('--')) {
            const [key, value] = arg.slice(2).split('=');
            flags[key] = value === undefined ? true : value;
        }
    }
    return flags;
}

function resolveFragmentsDir() {
    // Resolve the `@saasicat/spec/prisma-fragments/` directory.
    // We try `require.resolve` on the package entry and step back one
    // directory to find the fragments.
    const specEntry = require_.resolve('@saasicat/spec');
    const root = dirname(specEntry);
    const candidate = join(root, 'prisma-fragments');
    if (!existsSync(candidate)) {
        throw new Error(
            `prisma-fragments/-Verzeichnis nicht gefunden unter ${candidate}. ` +
                'Stelle sicher, dass @saasicat/spec installiert ist.',
        );
    }
    return candidate;
}

async function loadFragments(dir, filter) {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.prisma')).sort();
    const selected = filter
        ? files.filter((f) => {
              const prefix = f.split('-')[0];
              return filter.includes(prefix);
          })
        : files;
    const blocks = new Map();
    for (const file of selected) {
        const content = await readFile(join(dir, file), 'utf8');
        const fileBlocks = extractModelBlocks(content);
        for (const [name, body] of fileBlocks) {
            if (!blocks.has(name)) {
                blocks.set(name, body);
            }
        }
    }
    return { files: selected, blocks };
}

async function cmdSchemaApply(args) {
    const schemaPath = resolve(args['prisma-schema'] ?? 'prisma/schema.prisma');
    if (!existsSync(schemaPath)) {
        console.error(`✗ schema.prisma nicht gefunden: ${schemaPath}`);
        process.exit(1);
    }

    const fragmentsDir = resolveFragmentsDir();
    const filter = args.fragments
        ? args.fragments.split(',').map((s) => s.padStart(2, '0'))
        : null;
    if (!filter && !args.all) {
        console.error(
            '✗ Entweder --fragments=01,02,03 oder --all übergeben. ' +
                'Verfügbare Fragmente:',
        );
        const files = (await readdir(fragmentsDir)).filter((f) => f.endsWith('.prisma')).sort();
        for (const f of files) console.error(`    ${f}`);
        process.exit(1);
    }

    const { files, blocks } = await loadFragments(fragmentsDir, filter);
    if (blocks.size === 0) {
        console.error('✗ Keine Models in den gewählten Fragmenten gefunden.');
        process.exit(1);
    }

    const schema = await readFile(schemaPath, 'utf8');
    const result = applyFragmentBlocks(schema, blocks, {
        fragmentLabel: files.join(', '),
    });

    if (result.added.length === 0) {
        console.log(`→ Nichts zu tun. Bereits vorhandene Models: ${result.skipped.join(', ')}`);
        return;
    }

    if (args['dry-run']) {
        console.log(`(--dry-run) Würde anfügen: ${result.added.join(', ')}`);
        if (result.skipped.length) {
            console.log(`(--dry-run) Übersprungen (vorhanden): ${result.skipped.join(', ')}`);
        }
        console.log('');
        console.log(result.schema.slice(schema.length));
        return;
    }

    await writeFile(schemaPath, result.schema, 'utf8');
    console.log(`✓ ${result.added.length} Model(s) angefügt: ${result.added.join(', ')}`);
    if (result.skipped.length) {
        console.log(`→ Übersprungen (vorhanden): ${result.skipped.join(', ')}`);
    }
    console.log('');
    console.log('Nächste Schritte:');
    console.log('  1. schema.prisma reviewen (insbesondere FK-Pointer zu User/Tenant)');
    console.log('  2. pnpm prisma migrate dev --name add_saas_platform');
}

function runChild(cmd, args, opts = {}) {
    return new Promise((resolve_, reject) => {
        const proc = spawn(cmd, args, { stdio: 'inherit', ...opts });
        proc.on('error', reject);
        proc.on('exit', (code) => {
            if (code === 0) resolve_(undefined);
            else reject(new Error(`${cmd} ${args.join(' ')} → exit ${code}`));
        });
    });
}

async function cmdSchemaMigrate(args) {
    if (!args.name) {
        console.error('✗ --name=<migration_name> ist Pflicht.');
        process.exit(1);
    }

    console.log(`→ Schritt 1/2: saas-platform schema apply ${args['fragments'] ? `--fragments=${args['fragments']}` : '--all'}`);
    await cmdSchemaApply({
        ...args,
        all: args['fragments'] ? undefined : true,
    });

    console.log(`→ Schritt 2/2: pnpm prisma migrate dev --name ${args.name}`);
    const pmRunner = args['package-manager'] ?? 'pnpm';
    await runChild(pmRunner, ['prisma', 'migrate', 'dev', '--name', args.name]);
    console.log('✓ schema migrate erfolgreich.');
}

async function main() {
    const [, , cmd, sub, ...rest] = process.argv;
    if (cmd === 'schema' && sub === 'apply') {
        return cmdSchemaApply(parseArgs(rest));
    }
    if (cmd === 'schema' && sub === 'migrate') {
        return cmdSchemaMigrate(parseArgs(rest));
    }
    if (cmd === '--help' || cmd === '-h' || !cmd) {
        console.log('Usage: saas-platform <command> [...args]');
        console.log('');
        console.log('Commands:');
        console.log('  schema apply --all                       alle Plattform-Models einfügen');
        console.log('  schema apply --fragments=01,02           nur diese Fragmente einfügen');
        console.log('  schema apply --dry-run                   nur Diff ausgeben');
        console.log('  schema migrate --name=<name>             apply --all + prisma migrate dev');
        console.log('');
        console.log('Optional --prisma-schema=PATH (default prisma/schema.prisma).');
        console.log('Optional --package-manager=pnpm|npm|yarn (default pnpm).');
        return;
    }
    console.error(`Unbekannter Befehl: ${cmd} ${sub ?? ''}`);
    process.exit(1);
}

main().catch((err) => {
    console.error('✗ ' + (err?.message ?? String(err)));
    process.exit(99);
});
