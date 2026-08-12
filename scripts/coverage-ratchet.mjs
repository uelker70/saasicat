#!/usr/bin/env node
// Coverage ratchet.
//
// The repo has ~28k lines of test code and, until now, no coverage signal at
// all — so nobody could tell whether a change made the suite thinner. Picking a
// target percentage out of the air would have been worse than nothing: a number
// people either ignore or route around.
//
// So this measures the *current* value, writes it to `coverage-baseline.json`,
// and afterwards only ever fails when coverage DROPS. Every PR that improves it
// lowers the bar it has to clear next time.
//
//   node scripts/coverage-ratchet.mjs            check against the baseline
//   node scripts/coverage-ratchet.mjs --update   record the current values
//
// Note on what is measured: the suites import from each package's `dist/`, not
// from `src/` (see CONTRIBUTING.md, "Build before test"). Coverage therefore
// describes the bundled output. That is a real limitation — bundling merges
// modules, so per-file attribution is coarse — but the trend it reports is
// honest, and the trend is what a ratchet needs.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(REPO_ROOT, 'coverage-baseline.json');

/** Packages whose `test` script is a plain `node --test` run. */
const PACKAGES = [
    'saas-platform-spec',
    'saas-platform-types',
    'saas-platform-nest',
    'saas-platform-adapter-prisma',
    'saas-platform-adapter-drizzle',
    'saas-platform-persistence-testing',
    'saas-platform-cli',
    'saas-platform-ui-vue',
    'create-saasicat-admin',
];

/**
 * What counts as this package's own code.
 *
 * Without this the report is dominated by files that are not ours. Coverage
 * instrumentation is inherited by child processes, and a suite that shells out
 * to `pnpm` pulls corepack's ~4,500-line `pnpm.mjs` into the numbers — which is
 * exactly what happened: `@saasicat/spec` was recorded at 32.16% lines, and
 * that figure was pnpm's, not the package's. Filtered, the same suites measure
 * 94.90%.
 *
 * The lesson is not "add a filter": an unfiltered coverage number says nothing
 * about the code you think it describes, and it lands differently on every
 * machine depending on what happened to get loaded.
 */
const COVERAGE_INCLUDE = [
    'dist/**', // what the suites import (see CONTRIBUTING, "Build before test")
    'bin/**', // CLI entry points
    'scripts/**', // codegen and generator helpers
    'index.js', // @saasicat/spec ships hand-written entries at its root
    'index.cjs',
];

/**
 * Tolerance in percentage points.
 *
 * The measurement is deterministic — verified bit-identical across repeated
 * full sweeps — PROVIDED every package's `dist/` is current. That proviso is
 * the whole story: coverage is measured on the built output, so recording a
 * baseline against one build and checking against another moves the numbers
 * without a single test changing. An earlier ±0.6pp "flake" was exactly that,
 * and was misread as test-order dependence.
 *
 * So the tolerance is small on purpose. It absorbs a future Node counting
 * differently, not a build mismatch — that one is caught below instead.
 */
const SLACK = 0.5;

const SUMMARY = /^ℹ all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/m;

/**
 * Collects test files without a shell.
 *
 * `spawn(..., { shell: true })` with arguments concatenates them into a command
 * line — Node flags it as an injection vector (DEP0190), and it is one. Walking
 * the directory ourselves needs no shell and no glob expansion.
 */
function testFiles(cwd) {
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (entry.endsWith('.test.js') || entry.endsWith('.test.mjs')) {
                found.push(relative(cwd, full));
            }
        }
    };
    try {
        walk(join(cwd, 'tests'));
    } catch {
        return [];
    }
    return found.sort();
}

function measure(pkg) {
    const cwd = join(REPO_ROOT, 'packages', pkg);
    const files = testFiles(cwd);
    if (files.length === 0) return null;

    // The suites import from `dist/`, and so does the coverage report. Against a
    // stale or missing build the numbers describe a different program than the
    // one in the working tree — silently, and in either direction.
    //
    // Only packages that HAVE a build step are checked: @saasicat/spec ships
    // hand-written entry files at its package root and never produces a dist/.
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    if (manifest.scripts?.build && !existsSync(join(cwd, 'dist'))) {
        throw new Error(
            `${pkg} has no dist/ — run \`pnpm -r build\` first. Coverage is measured on the ` +
                `built output, so a missing or stale build produces numbers for a different program.`,
        );
    }

    const result = spawnSync(
        process.execPath,
        [
            '--test',
            '--experimental-test-coverage',
            ...COVERAGE_INCLUDE.map((glob) => `--test-coverage-include=${glob}`),
            ...files,
        ],
        { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    // A failing run still prints a coverage summary, and the numbers it prints
    // describe whatever happened to execute before things went wrong. Parsing
    // that would let a broken suite report "no coverage regression" whenever
    // the damage stays inside SLACK — and `--update` would write the broken
    // measurement down as the new baseline, quietly lowering the bar.
    if (result.error) {
        throw new Error(`Coverage run for ${pkg} could not start: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const reason = result.signal ? `killed by ${result.signal}` : `exit code ${result.status}`;
        throw new Error(
            `Coverage run for ${pkg} failed (${reason}) — its numbers describe a partial run, so ` +
                `they are not a measurement.\n${output.slice(-4000)}`,
        );
    }

    const match = SUMMARY.exec(output);
    if (!match) return null;
    return {
        line: Number(match[1]),
        branch: Number(match[2]),
        funcs: Number(match[3]),
    };
}

const update = process.argv.includes('--update');
const current = {};

for (const pkg of PACKAGES) {
    process.stderr.write(`measuring ${pkg} … `);
    const value = measure(pkg);
    if (!value) {
        // Skipping is fine for a check — the comparison below reports the
        // missing package. Skipping during `--update` is not: the new baseline
        // would simply be written without it, dropping that package's ratchet
        // for good and quietly lowering the bar.
        if (update) {
            throw new Error(
                `No coverage report for ${pkg} — refusing to write a baseline that leaves it out. ` +
                    `Either test discovery found no files, or Node's summary format changed.`,
            );
        }
        process.stderr.write('no coverage report — skipped\n');
        continue;
    }
    current[pkg] = value;
    process.stderr.write(`${value.line.toFixed(2)}% lines\n`);
}

if (update) {
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 4)}\n`);
    console.log(`Baseline written: ${BASELINE}`);
    process.exit(0);
}

if (!existsSync(BASELINE)) {
    console.error('No coverage-baseline.json. Run: node scripts/coverage-ratchet.mjs --update');
    process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const regressions = [];

for (const [pkg, before] of Object.entries(baseline)) {
    const now = current[pkg];
    if (!now) {
        regressions.push(`${pkg}: produced no coverage report at all (was ${before.line}% lines)`);
        continue;
    }
    for (const metric of ['line', 'branch', 'funcs']) {
        if (now[metric] < before[metric] - SLACK) {
            regressions.push(
                `${pkg}: ${metric} coverage ${now[metric].toFixed(2)}% < ${before[metric].toFixed(2)}% baseline`,
            );
        }
    }
}

if (regressions.length > 0) {
    console.error('\nCoverage dropped:\n');
    for (const line of regressions) console.error(`  ✗ ${line}`);
    console.error(
        '\nAdd tests for what you changed, or — if the drop is intended (deleted code,\n' +
            'moved package) — re-record with: node scripts/coverage-ratchet.mjs --update\n',
    );
    process.exit(1);
}

console.log('\n✓ No coverage regression.');
