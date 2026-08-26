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
//   pnpm run coverage           check against the baseline
//   pnpm run coverage:update    record the current values
//
// Always through the scripts, never `node scripts/coverage-ratchet.mjs`
// directly: they run `build-if-stale.mjs` first, and a current build is a
// precondition of the measurement (see below).
//
// Note on what is measured: the suites import from each package's `dist/`, not
// from `src/` (see CONTRIBUTING.md, "Build before test"). Coverage therefore
// describes the bundled output. That is a real limitation — bundling merges
// modules, so per-file attribution is coarse — but the trend it reports is
// honest, and the trend is what a ratchet needs.
//
// It only reports the package's own files; see COVERAGE_INCLUDE for why that is
// not a detail.
//
// PRECONDITION: a current build. The suites import from `dist/`, so measuring a
// stale one describes a program nobody is running — silently, and in either
// direction. A staleness heuristic used to live here, and three review rounds
// found three build inputs it did not know about: a deleted source file,
// `tsup.config.ts`, and the helpers that config imports. The answer was a
// blind rebuild on every run — ~50 s in CI, minutes locally — until
// `build-stamp.mjs` made the question decidable: a hash over everything a
// build could have read, not a list of what someone thought it reads. The
// `coverage` scripts run `build-if-stale.mjs` first, and this file measures.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(REPO_ROOT, 'coverage-baseline.json');
/** Last measurement, for the CI artefact. Not committed. */
const REPORT = join(REPO_ROOT, 'coverage-report.json');

/**
 * Packages whose `test` script is a plain `node --test` run.
 *
 * Read from the manifests rather than listed. The list was correct on the day
 * it was written and stayed correct by luck: the two packages added since
 * (`ui-vue-tenant`, `saasicat`) happen to have no such script, so nobody
 * noticed that a package which did would have gone unmeasured — silently, and
 * with a green ratchet.
 *
 * The predicate is the thing that decides: this file spawns `node --test`
 * itself, under coverage, so a package whose suite is a vitest runner or a
 * shell script cannot be measured here and says so by its own script.
 */
function measurablePackages() {
    return readdirSync(join(REPO_ROOT, 'packages'))
        .filter((dir) => {
            const manifest = join(REPO_ROOT, 'packages', dir, 'package.json');
            if (!existsSync(manifest)) return false;
            const test = JSON.parse(readFileSync(manifest, 'utf8')).scripts?.test ?? '';
            return test.startsWith('node --test');
        })
        .sort();
}

const PACKAGES = measurablePackages();

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
 * The CommonJS output, which is the same source a second time.
 *
 * `@saasicat/nest` ships twelve ESM entry points and one CommonJS bundle built
 * from the same sources (`dist/_entries.cjs`, see CONTRIBUTING, "One bundle,
 * many entries"). At 19,189 of the package's 39,996 built lines, that copy is
 * nearly half of what a naive measurement counts — and the suites load it only
 * where they check it deliberately, so it sat at 40.82% and pulled the package
 * to 65.22% while every ESM bundle measured between 92.81% and 100%.
 *
 * The number was not describing untested logic. It was describing the same
 * logic twice, once tested and once not, and it had a perverse property: adding
 * a test that touches the CommonJS bundle LOWERED coverage, because the file
 * only enters the report when something loads it. That happened twice in one
 * afternoon.
 *
 * What the CommonJS output can break that ESM cannot — an export resolving to
 * two identities across entry points, a bundle missing something it needs — is
 * not a question about line counts, and it has its own tests:
 * `cjs-entry-identity.test.js` and `dist-is-self-contained.test.js`. Those are
 * the guards for it; this is not.
 *
 * `index.cjs` at a package root stays included. That one is hand-written (see
 * `@saasicat/spec`), not a second rendering of something already measured.
 */
const COVERAGE_EXCLUDE = ['dist/**/*.cjs'];

/**
 * Tolerance in percentage points.
 *
 * Small on purpose. With `COVERAGE_INCLUDE` above the measurement is
 * deterministic and machine-independent, so the tolerance only has to absorb a
 * future Node counting slightly differently — not an environment difference.
 *
 * It took two wrong explanations to get here. A ±0.6pp gap between this machine
 * and CI was first blamed on test-order dependence, then on a stale build.
 * Neither was true: the report contained corepack's `pnpm.mjs`, and how much of
 * it got loaded differed per environment. Both explanations were plausible, and
 * both would have been "fixed" by widening this number until the gate stopped
 * saying anything.
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
function testFiles(cwd, directory = 'tests') {
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            // `tests/integration/` is the contract suite: it throws without a
            // database, and it is measured separately (see below).
            if (dir === join(cwd, 'tests') && entry === 'integration') continue;
            if (statSync(full).isDirectory()) walk(full);
            else if (entry.endsWith('.test.js') || entry.endsWith('.test.mjs')) {
                found.push(relative(cwd, full));
            }
        }
    };
    try {
        walk(join(cwd, directory));
    } catch {
        return [];
    }
    return found.sort();
}

function measure(pkg, { withDatabase = false } = {}) {
    const cwd = join(REPO_ROOT, 'packages', pkg);
    const files = withDatabase
        ? [...testFiles(cwd), ...testFiles(cwd, 'tests/integration')]
        : testFiles(cwd);
    if (files.length === 0) return null;

    const result = spawnSync(
        process.execPath,
        [
            '--test',
            // One file at a time where a database is involved. Each integration
            // file rebuilds the canonical schema in the disposable database it
            // is pointed at, and `node --test` runs files in parallel processes
            // — so two of them drop and recreate `public` at once and the loser
            // watches its tables disappear mid-test. The package's own
            // `test:integration` script says the same thing; this is the second
            // caller, and it has to say it too.
            ...(withDatabase ? ['--test-concurrency=1'] : []),
            '--experimental-test-coverage',
            ...COVERAGE_INCLUDE.map((glob) => `--test-coverage-include=${glob}`),
            ...COVERAGE_EXCLUDE.map((glob) => `--test-coverage-exclude=${glob}`),
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

/**
 * Whether the persistence contract can run — and therefore be measured.
 *
 * `adapter-prisma` and `adapter-drizzle` keep their contract suite under
 * `tests/integration/`, which needs a real PostgreSQL. Without it the ratchet
 * measures the service-free suites alone, and for those two packages that
 * number is not a statement about how well the code is tested: the repository
 * layer they exist to provide is exercised entirely by the contract. Measured
 * on 2026-08-20, `adapter-drizzle` reads 60.33% without it and 75.42% with it.
 *
 * Both numbers are real, they answer different questions, and the baseline
 * carries both. `withDatabase` is checked only in a run that could measure it —
 * CI does that in the `persistence-contract` job, which already has the
 * service.
 */
const DATABASE_URL = process.env.SAASICAT_TEST_DATABASE_URL;

/**
 * `--only=a,b` narrows the run to those packages.
 *
 * For the CI job that has a database but builds only the adapters: measuring a
 * package whose `dist/` was never built would report a program nobody is
 * running, which is the failure the PRECONDITION note above is about.
 */
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
const SELECTED = only ? only.split(',').map((name) => name.trim()) : PACKAGES;

const current = {};

// What went wrong, if anything did. Named and described, because a report that
// only says `complete: false` cannot tell anyone WHICH package failed — and
// naming it is the entire reason CI uploads this artefact.
let failure = null;

// Packages that produced no measurement without the run aborting. A list,
// because several can skip in one run — and a different concept from
// `failure`: this run kept going, it just measured less than it claims to.
const skipped = [];

// `finally`, so a package that fails to measure still leaves the numbers
// gathered before it. CI uploads this report with `if: always()` precisely to
// diagnose a failed coverage step — and a throw here used to abort before the
// write, so the one run that needed the artefact was the one without it.
try {
    for (const pkg of SELECTED) {
        process.stderr.write(`measuring ${pkg} … `);
        const startedAt = Date.now();
        let value;
        try {
            value = measure(pkg);
        } catch (err) {
            failure = { package: pkg, message: err instanceof Error ? err.message : String(err) };
            throw err;
        }
        if (!value) {
            // Skipping is fine for a check — the comparison below reports the
            // missing package. Skipping during `--update` is not: the new baseline
            // would simply be written without it, dropping that package's ratchet
            // for good and quietly lowering the bar.
            if (update) {
                failure = {
                    package: pkg,
                    message:
                        `No coverage report — refusing to write a baseline that leaves it out. ` +
                        `Either test discovery found no files, or Node's summary format changed.`,
                };
                throw new Error(`${pkg}: ${failure.message}`);
            }
            skipped.push({
                package: pkg,
                reason:
                    `No coverage summary — either test discovery found no files, ` +
                    `or Node's summary format changed.`,
            });
            process.stderr.write('no coverage report — skipped\n');
            continue;
        }
        current[pkg] = value;
        process.stderr.write(
            `${value.line.toFixed(2)}% lines (${((Date.now() - startedAt) / 1000).toFixed(0)} s)`,
        );

        // The same package again, with its contract suite, when there is a
        // database to run it against.
        if (
            DATABASE_URL &&
            testFiles(join(REPO_ROOT, 'packages', pkg), 'tests/integration').length
        ) {
            let withDatabase;
            try {
                withDatabase = measure(pkg, { withDatabase: true });
            } catch (err) {
                failure = {
                    package: pkg,
                    message: `Contract run failed: ${err instanceof Error ? err.message : String(err)}`,
                };
                throw err;
            }
            if (withDatabase) {
                current[pkg].withDatabase = withDatabase;
                process.stderr.write(` · ${withDatabase.line.toFixed(2)}% with the contract`);
            }
        }
        process.stderr.write('\n');
    }
} finally {
    writeFileSync(
        REPORT,
        `${JSON.stringify(
            {
                measured: current,
                complete: Object.keys(current).length === SELECTED.length,
                failure,
                skipped,
            },
            null,
            4,
        )}\n`,
    );
}

if (update) {
    // Merged, not overwritten. Two things would otherwise be lost silently:
    // a `--only` run would drop every package it did not measure, and a run
    // without a database would drop the `withDatabase` numbers of the two
    // adapters — in both cases lowering a bar by forgetting it, which is the
    // one thing a ratchet may never do.
    const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const merged = { ...previous };
    // Values this run would lower. Not refused — a drop is legitimate when code
    // was deleted or a package moved — but never silent: a re-record is the one
    // moment a ratchet can be loosened by accident, and 0.02 percentage points
    // of run-to-run noise looks exactly like nothing.
    const lowered = [];
    for (const [pkg, value] of Object.entries(current)) {
        merged[pkg] = { ...value };
        if (!value.withDatabase && previous[pkg]?.withDatabase) {
            merged[pkg].withDatabase = previous[pkg].withDatabase;
        }
        for (const [label, before, now] of [
            ['', previous[pkg], value],
            [' (with the contract)', previous[pkg]?.withDatabase, value.withDatabase],
        ]) {
            if (!before || !now) continue;
            for (const metric of ['line', 'branch', 'funcs']) {
                if (now[metric] < before[metric]) {
                    lowered.push(
                        `${pkg}${label}: ${metric} ${before[metric].toFixed(2)}% → ` +
                            `${now[metric].toFixed(2)}%`,
                    );
                }
            }
        }
    }
    writeFileSync(BASELINE, `${JSON.stringify(merged, null, 4)}\n`);
    console.log(`Baseline written: ${BASELINE}`);
    if (lowered.length > 0) {
        console.log(`\nThis LOWERED ${lowered.length} recorded value(s):`);
        for (const line of lowered) console.log(`  ↓ ${line}`);
        console.log(
            '\nIf that is not what you meant, restore them before committing. Sub-tenth\n' +
                'differences are usually run-to-run noise rather than a real change.',
        );
    }
    if (!DATABASE_URL) {
        console.log(
            'Note: no SAASICAT_TEST_DATABASE_URL, so the contract numbers were carried\n' +
                'over unchanged rather than measured.',
        );
    }
    process.exit(0);
}

if (!existsSync(BASELINE)) {
    console.error('No coverage-baseline.json. Run: pnpm run coverage:update');
    process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const regressions = [];

/** Compares one set of three numbers, and says which run they came from. */
function compare(pkg, before, now, label) {
    for (const metric of ['line', 'branch', 'funcs']) {
        if (now[metric] < before[metric] - SLACK) {
            regressions.push(
                `${pkg}${label}: ${metric} coverage ${now[metric].toFixed(2)}% < ` +
                    `${before[metric].toFixed(2)}% baseline`,
            );
        }
    }
}

/** Packages whose contract numbers exist but could not be checked this run. */
const unmeasured = [];

for (const [pkg, before] of Object.entries(baseline)) {
    if (!SELECTED.includes(pkg)) continue;
    const now = current[pkg];
    if (!now) {
        regressions.push(`${pkg}: produced no coverage report at all (was ${before.line}% lines)`);
        continue;
    }
    compare(pkg, before, now, '');

    if (!before.withDatabase) continue;
    if (now.withDatabase) {
        compare(pkg, before.withDatabase, now.withDatabase, ' (with the contract)');
    } else {
        // Said out loud rather than passed over. Silence here would read as
        // "checked, nothing wrong" for a number nothing looked at.
        unmeasured.push(pkg);
    }
}

if (unmeasured.length > 0) {
    console.error(
        `\nNot checked: the contract numbers for ${unmeasured.join(', ')} — no ` +
            'SAASICAT_TEST_DATABASE_URL.\nCI checks those in the persistence-contract job.',
    );
}

if (regressions.length > 0) {
    console.error('\nCoverage dropped:\n');
    for (const line of regressions) console.error(`  ✗ ${line}`);
    console.error(
        '\nAdd tests for what you changed, or — if the drop is intended (deleted code,\n' +
            'moved package) — re-record with: pnpm run coverage:update\n',
    );
    process.exit(1);
}

console.log('\n✓ No coverage regression.');
