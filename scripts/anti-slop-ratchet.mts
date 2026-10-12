// Ratchet for the anti-slop rules: counts the findings of every rule and
// compares them with the number in `anti-slop-ratchet.json`. The numbers are
// recorded exactly and may only go down.
//
// Why a ratchet and not a hard rule: the existing code carries many findings,
// most of them type assertions without a `SAFETY:` justification. Annotating
// all of them at once would produce exactly the text the rule exists to
// prevent — comments written to quiet the linter. The existing ones stay until
// somebody touches that code anyway, and nothing new is added.
//
// Exact rather than a ceiling with slack: a limit above the current value
// would admit new findings until it is reached. Whoever removes findings
// lowers the number with `--update` and freezes the gain; raising it is a
// hand edit, visible in the diff.
//
// The total alone would let a swap through: one finding fixed, a new one
// added, the number unchanged. So, in addition, every finding on a line that
// is new or changed since the branch left the default branch fails — whoever
// touches a line fixes it. Disable directives are exempt: for them the number
// holds, which a justified exception raises visibly. In CI the merge base must
// be reachable (full history), otherwise the run aborts.
//
// Which rules are counted is stated in `oxlint.config.mts`, and which files
// are excluded is stated there too (`ignorePatterns`) — this script keeps no
// second list.
//
// It also counts the comments that switch an anti-slop rule off —
// `oxlint-disable…` and `eslint-disable…`, because oxlint honours both, also as
// a block comment across several lines — when they are blanket or name an
// `anti-slop/` rule. Each of them would lower a rule's number without the code
// getting any better. A justified exception raises that one number by hand —
// visible in the diff, with the reason on the comment.
//
// It counts the working tree, not just the index: a new file shows up before
// `git add`.
//
// Usage: node scripts/anti-slop-ratchet.mts            check
//        node scripts/anti-slop-ratchet.mts --update   record numbers that went down

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OXLINT_CONFIG = 'oxlint.config.mts';
const OXLINT = join('node_modules', '.bin', 'oxlint');
const RATCHET = 'anti-slop-ratchet.json';
const RULE_PREFIX = 'anti-slop/';
// JavaScript too: the type-assertion rules have nothing to find there, but
// module mocks, `Reflect.*` and the conditional empty spread do.
const SOURCE_FILES = [
    '*.ts',
    '*.mts',
    '*.cts',
    '*.tsx',
    '*.vue',
    '*.js',
    '*.mjs',
    '*.cjs',
    '*.jsx',
] as const;
const DECLARATIONS = ['.d.ts', '.d.mts', '.d.cts'] as const;
// Several thousand paths would exceed the length of a command line.
const FILES_PER_RUN = 300;
const MOST_SHOWN = 50;
// How this repository's `.prettierrc` indents JSON.
const JSON_INDENT = 4;
const DISABLE_DIRECTIVE = 'disable-directive';
const WHOLE_FILE = 'whole-file';
const LINE_COMMENT = '//';
const BLOCK_COMMENT = ['/*', '*/'] as const;
const DISABLE_KEYWORDS = ['oxlint-disable', 'eslint-disable'] as const;
const PLUGIN_RULE = 'anti-slop/';

interface Finding {
    readonly rule: string;
    readonly file: string;
    readonly line: number;
    // The last line of the reported expression; a finding across several lines
    // counts as changed as soon as one of them is changed.
    readonly toLine: number;
    readonly message: string;
}

interface Measurement {
    readonly findings: readonly Finding[];
    readonly files: number;
}

interface Config {
    readonly rules: readonly string[];
    readonly excluded: readonly string[];
}

interface OxlintDiagnostic {
    readonly code: string;
    readonly filename: string;
    readonly message: string;
    readonly labels: readonly {
        readonly span: { readonly line: number; readonly offset: number; readonly length: number };
    }[];
}

interface OxlintOutput {
    readonly diagnostics: readonly OxlintDiagnostic[];
    readonly number_of_files: number;
}

/** New or changed lines per file; `WHOLE_FILE` for a new, untracked one. */
type Changes = Map<string, ReadonlySet<number> | typeof WHOLE_FILE>;

function isObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null;
}

function isOxlintOutput(value: unknown): value is OxlintOutput {
    return (
        isObject(value) &&
        'diagnostics' in value &&
        Array.isArray(value.diagnostics) &&
        'number_of_files' in value &&
        typeof value.number_of_files === 'number'
    );
}

function isCountTable(value: unknown): value is Record<string, number> {
    return isObject(value) && Object.values(value).every((count) => Number.isInteger(count));
}

function git(...args: string[]): string {
    return execFileSync('git', args, { encoding: 'utf8' });
}

async function readConfig(): Promise<Config> {
    const module: unknown = await import(pathToFileURL(resolve(OXLINT_CONFIG)).href);
    const config = isObject(module) && 'default' in module ? module.default : undefined;
    if (!isObject(config) || !('rules' in config) || !isObject(config.rules)) {
        throw new Error(`${OXLINT_CONFIG} exports no configuration with \`rules\`.`);
    }
    const rules = Object.keys(config.rules)
        .filter((rule) => rule.startsWith(RULE_PREFIX))
        .map((rule) => rule.slice(RULE_PREFIX.length));
    if (rules.length === 0) {
        throw new Error(`${OXLINT_CONFIG} names no rule with ${RULE_PREFIX}.`);
    }
    const patterns =
        'ignorePatterns' in config && Array.isArray(config.ignorePatterns)
            ? config.ignorePatterns.filter((entry) => typeof entry === 'string')
            : [];
    return { rules, excluded: globSync(patterns) };
}

function sourceFiles(): string[] {
    // `--others` takes new files before `git add`; `existsSync` leaves out
    // deleted ones that are still in the index.
    return git('ls-files', '-z', '--cached', '--others', '--exclude-standard', ...SOURCE_FILES)
        .split('\0')
        .filter(
            (path) =>
                path !== '' &&
                !DECLARATIONS.some((ending) => path.endsWith(ending)) &&
                existsSync(path),
        );
}

function oxlint(files: readonly string[]): OxlintOutput {
    const run = spawnSync(
        // Directly, not through `pnpm exec`: depending on the situation, pnpm
        // writes a line of its own before the JSON.
        OXLINT,
        // A batch whose files are all excluded is not an error — without the
        // flag, oxlint answers with plain text instead of JSON.
        ['-c', OXLINT_CONFIG, '-f', 'json', '--no-error-on-unmatched-pattern', ...files],
        { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    // oxlint exits with 1 as soon as there are findings; that is the normal case here.
    if (run.error !== undefined || (run.status !== 0 && run.status !== 1)) {
        throw new Error(`oxlint failed (status ${run.status}): ${run.stderr}`, {
            cause: run.error,
        });
    }
    const output: unknown = JSON.parse(run.stdout);
    if (!isOxlintOutput(output)) {
        throw new Error('oxlint did not return JSON in the expected shape.');
    }
    return output;
}

function ruleOf(code: string): string {
    const start = 'anti-slop(';
    if (!code.startsWith(start) || !code.endsWith(')')) {
        // A parse error or a foreign rule: only what the configuration asks for
        // is counted, anything else is a finding of its own.
        throw new Error(`Unexpected diagnostic from oxlint: ${code}`);
    }
    return code.slice(start.length, -1);
}

function measure(excluded: ReadonlySet<string>): Measurement {
    const files = sourceFiles();
    const findings: Finding[] = [];
    const texts = new Map<string, string>();
    const textOf = (file: string): string => {
        const text = texts.get(file) ?? readFileSync(file, 'utf8');
        texts.set(file, text);
        return text;
    };
    let linted = 0;
    for (let i = 0; i < files.length; i += FILES_PER_RUN) {
        const output = oxlint(files.slice(i, i + FILES_PER_RUN));
        linted += output.number_of_files;
        for (const diagnostic of output.diagnostics) {
            const span = diagnostic.labels[0]?.span;
            const line = span?.line ?? 0;
            const end = span === undefined ? undefined : span.offset + span.length;
            findings.push({
                rule: ruleOf(diagnostic.code),
                file: diagnostic.filename,
                line,
                toLine: end === undefined ? line : lineOf(textOf(diagnostic.filename), end),
                message: diagnostic.message,
            });
        }
    }
    // A run over zero files would report zero findings — and pass.
    if (linted === 0) {
        throw new Error('oxlint checked no file.');
    }
    // Disable directives only where oxlint looks too: in an excluded file a
    // comment switches nothing off that would be counted.
    const directives = files.filter((file) => !excluded.has(file)).flatMap(disableDirectivesIn);
    return { findings: [...findings, ...directives], files: linted };
}

/**
 * Whether the comment starting at `text` switches an anti-slop rule off: a
 * keyword, then up to `--` or `*\/` the rule list — empty means blanket.
 */
function disablesAntiSlop(text: string): boolean {
    const keyword = DISABLE_KEYWORDS.find((candidate) => text.startsWith(candidate));
    if (keyword === undefined) return false;
    const afterKeyword = text.slice(keyword.length);
    // `-next-line`, `-line` or nothing; the rule list starts after the whitespace.
    const separator = afterKeyword.search(/\s/);
    if (separator < 0) return true;
    const ruleList = [' --', '*/'].reduce(
        (sofar, end) => (sofar.includes(end) ? sofar.slice(0, sofar.indexOf(end)) : sofar),
        afterKeyword.slice(separator),
    );
    return ruleList.trim() === '' || ruleList.includes(PLUGIN_RULE);
}

function lineOf(text: string, index: number): number {
    return text.slice(0, index).split('\n').length;
}

function disableDirectivesIn(file: string): Finding[] {
    const text = readFileSync(file, 'utf8');
    const findings: Finding[] = [];
    text.split('\n').forEach((line, index) => {
        for (let i = line.indexOf(LINE_COMMENT); i >= 0; i = line.indexOf(LINE_COMMENT, i + 1)) {
            if (disablesAntiSlop(line.slice(i + LINE_COMMENT.length).trimStart())) {
                findings.push({
                    rule: DISABLE_DIRECTIVE,
                    file,
                    line: index + 1,
                    toLine: index + 1,
                    message: line.trim(),
                });
                break;
            }
        }
    });
    // A block comment may span several lines; its content is collapsed before
    // it is checked.
    const [open, close] = BLOCK_COMMENT;
    for (let i = text.indexOf(open); i >= 0; i = text.indexOf(open, i + open.length)) {
        const end = text.indexOf(close, i + open.length);
        const content = text
            .slice(i + open.length, end < 0 ? undefined : end)
            .split(/\s+/)
            .join(' ')
            .trim();
        if (disablesAntiSlop(content)) {
            const line = lineOf(text, i);
            findings.push({
                rule: DISABLE_DIRECTIVE,
                file,
                line,
                toLine: line,
                message: `/* ${content} */`,
            });
        }
    }
    return findings;
}

function counted(findings: readonly Finding[], rules: readonly string[]): Map<string, number> {
    const counts = new Map(rules.map((rule) => [rule, 0]));
    for (const { rule } of findings) {
        counts.set(rule, (counts.get(rule) ?? 0) + 1);
    }
    return counts;
}

function recorded(updating: boolean): Map<string, number> {
    // On the first `--update` there is nothing recorded yet.
    if (updating && !existsSync(RATCHET)) return new Map();
    const read: unknown = JSON.parse(readFileSync(RATCHET, 'utf8'));
    if (!isCountTable(read)) {
        throw new Error(`${RATCHET} is not a table of rule and integer.`);
    }
    return new Map(Object.entries(read));
}

function mergeBase(): string | undefined {
    for (const base of ['origin/HEAD', 'origin/main', 'origin/master']) {
        const run = spawnSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' });
        if (run.status === 0) return run.stdout.trim();
    }
    return undefined;
}

/**
 * Reads `git diff -U0` against the merge base: `+++ <path>` names the file,
 * `@@ -a,b +c,d @@` the lines c to c+d-1 (without `,d` exactly one). `d = 0`
 * means deleted only; then the line after it, c+1, counts as changed —
 * whoever deletes the `// SAFETY:` line above an assertion creates the finding
 * exactly there.
 */
function changesSince(base: string): Changes {
    const changes: Changes = new Map();
    const diff = git(
        '-c',
        'core.quotePath=false',
        'diff',
        '-U0',
        '--no-color',
        '--no-ext-diff',
        '--no-prefix',
        base,
    );
    let file: string | undefined;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+++ ')) {
            const path = line.slice('+++ '.length);
            file = path === '/dev/null' ? undefined : path;
            continue;
        }
        if (file === undefined || !line.startsWith('@@ ')) continue;
        const newRange = line.split(' ')[2] ?? '';
        const [start = '0', count = '1'] = newRange.slice(1).split(',');
        const before = changes.get(file);
        const lines = new Set<number>(before === WHOLE_FILE || before === undefined ? [] : before);
        if (Number(count) === 0) lines.add(Number(start) + 1);
        for (let n = Number(start); n < Number(start) + Number(count); n += 1) lines.add(n);
        changes.set(file, lines);
    }
    for (const untracked of git('ls-files', '-z', '--others', '--exclude-standard').split('\0')) {
        if (untracked !== '') changes.set(untracked, WHOLE_FILE);
    }
    return changes;
}

function onChangedLine(finding: Finding, changes: Changes): boolean {
    const lines = changes.get(finding.file);
    if (lines === WHOLE_FILE) return true;
    if (lines === undefined) return false;
    for (let n = finding.line; n <= finding.toLine; n += 1) {
        if (lines.has(n)) return true;
    }
    return false;
}

function showLocations(
    findings: readonly Finding[],
    rule: string,
    changes: Changes | undefined,
): void {
    const all = findings.filter((finding) => finding.rule === rule);
    const inChanged = all.filter((finding) => changes?.has(finding.file) === true);
    // Without a merge base, or when the new finding sits in an unchanged file
    // (after an upstream update of the plugin, say), all of them are left.
    const candidates = inChanged.length > 0 ? inChanged : all;
    const origin = inChanged.length > 0 ? 'in changed files' : 'all findings';
    console.error(`    ${origin}:`);
    for (const { file, line, message } of candidates.slice(0, MOST_SHOWN)) {
        console.error(`      ${file}:${line} ${message}`);
    }
    if (candidates.length > MOST_SHOWN) {
        console.error(`      … and ${candidates.length - MOST_SHOWN} more`);
    }
}

async function main(): Promise<void> {
    // Paths from `git ls-files` and the configuration are relative to the root.
    process.chdir(git('rev-parse', '--show-toplevel').trim());
    const updating = process.argv.includes('--update');
    const base = mergeBase();
    if (base === undefined && process.env.CI !== undefined) {
        throw new Error(
            'No merge base with the default branch is reachable — in CI the ratchet needs the ' +
                'full history (`fetch-depth: 0`), otherwise it does not check changed lines.',
        );
    }
    if (base === undefined) {
        console.warn('No merge base with the default branch — changed lines are not checked.');
    }
    const { rules: configuredRules, excluded } = await readConfig();
    const rules = [...configuredRules, DISABLE_DIRECTIVE];
    const measurement = measure(new Set(excluded));
    const changes = base === undefined ? undefined : changesSince(base);
    const onNewLines = measurement.findings.filter(
        (finding) =>
            finding.rule !== DISABLE_DIRECTIVE &&
            changes !== undefined &&
            onChangedLine(finding, changes),
    );
    const actual = counted(measurement.findings, rules);
    const expected = recorded(updating);
    const actualCount = (rule: string): number => actual.get(rule) ?? 0;
    const expectedCount = (rule: string): number => expected.get(rule) ?? 0;

    const rose = rules.filter(
        (rule) => expected.has(rule) && actualCount(rule) > expectedCount(rule),
    );
    const fell = rules.filter((rule) => actualCount(rule) < expectedCount(rule));
    const unrecorded = rules.filter((rule) => !expected.has(rule));
    const orphaned = [...expected.keys()].filter((rule) => !rules.includes(rule));

    if (onNewLines.length > 0) {
        console.error('Anti-slop findings on new or changed lines:');
        for (const { rule, file, line, message } of onNewLines.slice(0, MOST_SHOWN)) {
            console.error(`  ${file}:${line} ${rule} — ${message}`);
        }
        if (onNewLines.length > MOST_SHOWN) {
            console.error(`  … and ${onNewLines.length - MOST_SHOWN} more`);
        }
        console.error('Whoever touches a line fixes its finding — an old one too.');
    }
    if (rose.length > 0) {
        console.error('More anti-slop findings than recorded:');
        for (const rule of rose) {
            console.error(`  ${rule}: ${actualCount(rule)} instead of ${expectedCount(rule)}`);
            showLocations(measurement.findings, rule, changes);
        }
        console.error('Fix the new findings — the number is not raised.');
    }
    if (onNewLines.length > 0 || rose.length > 0) {
        process.exit(1);
    }

    if (updating) {
        // A new rule gets its first number here; that is a decision in
        // `oxlint.config.mts`, which sits in the same diff.
        const next = Object.fromEntries(rules.map((rule) => [rule, actualCount(rule)]));
        writeFileSync(RATCHET, `${JSON.stringify(next, null, JSON_INDENT)}\n`);
        for (const rule of [...fell, ...unrecorded]) {
            console.log(`  ${rule}: ${expected.get(rule) ?? '—'} → ${actualCount(rule)}`);
        }
        console.log(`${RATCHET} written.`);
        return;
    }

    if (fell.length > 0 || unrecorded.length > 0 || orphaned.length > 0) {
        for (const rule of fell) {
            console.error(
                `  ${rule}: ${actualCount(rule)} instead of ${expectedCount(rule)} — removed`,
            );
        }
        for (const rule of unrecorded) {
            console.error(`  ${rule}: counted, but without a number in ${RATCHET}`);
        }
        for (const rule of orphaned) {
            console.error(`  ${rule}: in ${RATCHET}, but no longer in ${OXLINT_CONFIG}`);
        }
        console.error('Record it with: node scripts/anti-slop-ratchet.mts --update');
        process.exit(1);
    }

    const total = rules.reduce((sum, rule) => sum + actualCount(rule), 0);
    console.log(
        `OK — ${configuredRules.length} anti-slop rules and their disable directives, ` +
            `${total} existing findings as recorded, ${measurement.files} files checked.`,
    );
}

await main();
