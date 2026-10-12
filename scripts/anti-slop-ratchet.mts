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
// hand edit, visible in the diff. The price of exactness: if two branches each
// lower the same number by one, git merges their identical edits and `main`
// ends up one below. The next run then asks for `--update`, even in a branch
// that has nothing to do with it — whoever runs it records the removal. A
// warning instead of a failure would let through, unseen, whatever lowers the
// number outside changed files: a rule switched off, a file deleted, a disable
// directive removed.
//
// The total alone would let a swap through: one finding fixed, a new one
// added, the number unchanged. So there are two checks against the point where
// the branch left the default branch: no changed file may have more findings
// per rule than it had there, and every finding on a new or changed line fails
// — whoever touches a line fixes it. A new disable directive on a changed line
// is only allowed as far as its number was raised by hand in the same diff or
// one goes away in the same branch that switched off at least as much: the same
// rules or more, over one line or to the end of the file. So moving and
// narrowing need no raise; widening and changing the rule do. A rule change
// takes two pull requests, because the number at the merge base counts: the
// first removes the old directive together with the code it switched off and
// records that with `--update`; the second follows after the first is merged,
// with the new code, the new directive and the number raised by hand. In CI the merge base must be
// reachable (full history), otherwise the run aborts.
//
// A limit: how far a directive reaches is read from its form, not from the
// file. A blanket directive that moves into another file switches off
// everything there to the end of the file, and a removed `eslint-enable`
// extends a range without touching a directive line. The diff shows both; the
// ratchet does not. And the offset matches greedily: if `a,b` and `a,c` go
// away and `a` and `b` are added, it may fail although a matching exists —
// writing the new directives identical to the old ones avoids that.
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
import {
    existsSync,
    globSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, matchesGlob, relative, resolve } from 'node:path';
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
// Its justification may sit above the assertion, separated by further comments;
// a finding of this rule therefore reaches up over them.
const SAFETY_RULE = 'require-safety-comment-for-type-assertion';
const COMMENT_LINES = ['//', '/*', '*'] as const;
const NEWLINE = 0x0a;

interface Finding {
    readonly rule: string;
    readonly file: string;
    readonly line: number;
    // The line range that counts as "touched": from the reported expression
    // (for the SAFETY rule including the comments above it) to its end.
    readonly fromLine: number;
    readonly toLine: number;
    readonly message: string;
    // Only for disable directives: form and rules, normalised.
    readonly key?: string;
}

interface Measurement {
    readonly findings: readonly Finding[];
    readonly files: number;
}

interface Config {
    readonly rules: readonly string[];
    readonly excluded: readonly string[];
    // The patterns themselves: `globSync` only knows files that still exist.
    readonly patterns: readonly string[];
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
    const entries = Object.entries(config.rules).filter(([rule]) => rule.startsWith(RULE_PREFIX));
    // Only what reports is counted. A rule at `off` or `warn` would look
    // counted and count nothing, or count differently.
    const notError = entries.filter(([, value]) => {
        const level = Array.isArray(value) ? value[0] : value;
        return level !== 'error';
    });
    if (notError.length > 0) {
        throw new Error(
            `${OXLINT_CONFIG}: ${notError.map(([rule]) => rule).join(', ')} is not at 'error'. ` +
                'A rule that should no longer apply is removed.',
        );
    }
    const rules = entries.map(([rule]) => rule.slice(RULE_PREFIX.length));
    if (rules.length === 0) {
        throw new Error(`${OXLINT_CONFIG} names no rule with ${RULE_PREFIX}.`);
    }
    const patterns =
        'ignorePatterns' in config && Array.isArray(config.ignorePatterns)
            ? config.ignorePatterns.filter((entry) => typeof entry === 'string')
            : [];
    return { rules, excluded: globSync(patterns), patterns };
}

function isSourceFile(path: string): boolean {
    return (
        SOURCE_FILES.some((pattern) => path.endsWith(pattern.slice(1))) &&
        !DECLARATIONS.some((ending) => path.endsWith(ending))
    );
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

/**
 * oxlint counts `offset` and `length` in UTF-8 bytes, not characters — an
 * umlaut before it would otherwise shift the end. So the line breaks within the
 * finding's bytes are counted.
 */
function rangeOf(
    rule: string,
    text: string,
    bytes: Buffer,
    span: OxlintDiagnostic['labels'][number]['span'],
): { fromLine: number; toLine: number } {
    const breaks = bytes
        .subarray(span.offset, span.offset + span.length)
        .filter((byte) => byte === NEWLINE).length;
    let fromLine = span.line;
    if (rule === SAFETY_RULE) {
        const lines = text.split('\n');
        while (fromLine > 1) {
            const before = (lines[fromLine - 2] ?? '').trim();
            if (before !== '' && !COMMENT_LINES.some((start) => before.startsWith(start))) break;
            fromLine -= 1;
        }
    }
    return { fromLine, toLine: span.line + breaks };
}

/** Lints the paths in batches; `file` is the path as oxlint reports it. */
function lint(paths: readonly string[]): { findings: Finding[]; linted: number } {
    const findings: Finding[] = [];
    const contents = new Map<string, { text: string; bytes: Buffer }>();
    const contentOf = (file: string): { text: string; bytes: Buffer } => {
        const known = contents.get(file);
        if (known !== undefined) return known;
        const bytes = readFileSync(file);
        const content = { text: bytes.toString('utf8'), bytes };
        contents.set(file, content);
        return content;
    };
    let linted = 0;
    for (let i = 0; i < paths.length; i += FILES_PER_RUN) {
        const output = oxlint(paths.slice(i, i + FILES_PER_RUN));
        linted += output.number_of_files;
        for (const diagnostic of output.diagnostics) {
            const rule = ruleOf(diagnostic.code);
            const span = diagnostic.labels[0]?.span;
            const line = span?.line ?? 0;
            const { text, bytes } = contentOf(diagnostic.filename);
            findings.push({
                rule,
                file: diagnostic.filename,
                line,
                ...(span === undefined
                    ? { fromLine: line, toLine: line }
                    : rangeOf(rule, text, bytes, span)),
                message: diagnostic.message,
            });
        }
    }
    return { findings, linted };
}

function measure(excluded: ReadonlySet<string>): Measurement {
    const files = sourceFiles();
    const { findings, linted } = lint(files);
    // A run over zero files would report zero findings — and pass.
    if (linted === 0) {
        throw new Error('oxlint checked no file.');
    }
    // Disable directives only where oxlint looks too: in an excluded file a
    // comment switches nothing off that would be counted.
    const directives = files.filter((file) => !excluded.has(file)).flatMap(disableDirectivesIn);
    return { findings: [...findings, ...directives], files: linted };
}

type CountsPerFile = Map<string, Map<string, number>>;

function perFile(
    findings: readonly Finding[],
    fileOf: (reported: string) => string,
): CountsPerFile {
    const counts: CountsPerFile = new Map();
    for (const finding of findings) {
        if (finding.rule === DISABLE_DIRECTIVE) continue;
        const key = fileOf(finding.file);
        const perRule = counts.get(key) ?? new Map<string, number>();
        perRule.set(finding.rule, (perRule.get(finding.rule) ?? 0) + 1);
        counts.set(key, perRule);
    }
    return counts;
}

interface StateAtMergeBase {
    readonly findings: CountsPerFile;
    // Per file the keys of its disable directives, deleted files included.
    readonly directives: ReadonlyMap<string, readonly string[]>;
}

/**
 * Findings per file and rule as they were at the merge base: the old version
 * of each file is written to a throwaway directory and linted there. A file
 * that did not exist there had zero findings. Deleted files are not linted —
 * their removal shows in the total — but their disable directives count as
 * gone.
 */
function countsAtMergeBase(
    base: string,
    files: readonly string[],
    origins: ReadonlyMap<string, string>,
    deleted: readonly string[],
): StateAtMergeBase {
    // The real path, because oxlint reports it that way (on macOS `/var` is a symlink).
    const store = realpathSync(mkdtempSync(join(tmpdir(), 'anti-slop-')));
    try {
        const copies: string[] = [];
        const directives = new Map<string, readonly string[]>();
        const keysIn = (path: string): string[] =>
            disableDirectivesIn(path).flatMap((finding) =>
                finding.key === undefined ? [] : [finding.key],
            );
        for (const file of files) {
            const old = spawnSync('git', ['show', `${base}:${origins.get(file) ?? file}`], {
                maxBuffer: 256 * 1024 * 1024,
            });
            if (old.status !== 0) continue;
            const target = join(store, file);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, old.stdout);
            copies.push(target);
            directives.set(file, keysIn(target));
        }
        for (const file of deleted) {
            const old = spawnSync('git', ['show', `${base}:${file}`], {
                maxBuffer: 256 * 1024 * 1024,
            });
            if (old.status !== 0) continue;
            const target = join(store, 'deleted', file);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, old.stdout);
            directives.set(file, keysIn(target));
        }
        if (copies.length === 0) return { findings: new Map(), directives };
        const findings = perFile(lint(copies).findings, (reported) =>
            relative(store, resolve(reported)),
        );
        return { findings, directives };
    } finally {
        rmSync(store, { recursive: true, force: true });
    }
}

/** The recorded number of disable directives at the merge base, if there was one. */
function directivesAtMergeBase(base: string): number | undefined {
    const old = spawnSync('git', ['show', `${base}:${RATCHET}`], { encoding: 'utf8' });
    if (old.status !== 0) return undefined;
    const read: unknown = JSON.parse(old.stdout);
    return isCountTable(read) ? read[DISABLE_DIRECTIVE] : undefined;
}

/**
 * Whether the comment starting at `text` switches an anti-slop rule off: a
 * keyword, then up to `--` or `*\/` the rule list — empty means blanket.
 */
function directiveKey(text: string, form: string): string | undefined {
    const keyword = DISABLE_KEYWORDS.find((candidate) => text.startsWith(candidate));
    if (keyword === undefined) return undefined;
    const afterKeyword = text.slice(keyword.length);
    // `-next-line`, `-line` or nothing; the rule list starts after the whitespace.
    const separator = afterKeyword.search(/\s/);
    const variant = separator < 0 ? afterKeyword : afterKeyword.slice(0, separator);
    const ruleList = [' --', '*/'].reduce(
        (sofar, end) => (sofar.includes(end) ? sofar.slice(0, sofar.indexOf(end)) : sofar),
        separator < 0 ? '' : afterKeyword.slice(separator),
    );
    const allRules = ruleList
        .split(',')
        .map((rule) => rule.trim())
        .filter((rule) => rule !== '');
    // Only this plugin's rules: appending a foreign one changes nothing here.
    const rules = allRules.filter((rule) => rule.startsWith(PLUGIN_RULE)).sort();
    if (allRules.length > 0 && rules.length === 0) return undefined;
    // `oxlint-` and `eslint-` act the same; blanket is `*`.
    return `${form}:${variant}|${rules.length === 0 ? '*' : rules.join(',')}`;
}

/** How far a directive reaches, as a number to compare: larger means wider. */
/**
 * Whether a directive affects one line only; without `-line`/`-next-line` it
 * reaches to the end of the file.
 */
function oneLineOnly(form: string): boolean {
    const variant = form.slice(form.indexOf(':') + 1);
    return variant === '-line' || variant === '-next-line';
}

function width(key: string): number {
    const [form = '', rules = ''] = key.split('|');
    // Reach weighs before the number of rules; no directive names a thousand rules.
    const toEndOfFile = oneLineOnly(form) ? 0 : 1;
    const ruleCount = rules === '*' ? 1000 : rules.split(',').length;
    return toEndOfFile * 10_000 + ruleCount;
}

/** Whether a directive with key `wide` switches off at least what `narrow` does. */
function covers(wide: string, narrow: string): boolean {
    const [wideForm = '', wideRules = ''] = wide.split('|');
    const [narrowForm = '', narrowRules = ''] = narrow.split('|');
    if (!oneLineOnly(narrowForm) && oneLineOnly(wideForm)) return false;
    if (wideRules === '*') return true;
    if (narrowRules === '*') return false;
    const allowed = wideRules.split(',');
    return narrowRules.split(',').every((rule) => allowed.includes(rule));
}

function lineOf(text: string, index: number): number {
    return text.slice(0, index).split('\n').length;
}

function disableDirectivesIn(file: string): Finding[] {
    const text = readFileSync(file, 'utf8');
    const findings: Finding[] = [];
    text.split('\n').forEach((line, index) => {
        for (let i = line.indexOf(LINE_COMMENT); i >= 0; i = line.indexOf(LINE_COMMENT, i + 1)) {
            const key = directiveKey(line.slice(i + LINE_COMMENT.length).trimStart(), 'line');
            if (key !== undefined) {
                findings.push({
                    rule: DISABLE_DIRECTIVE,
                    file,
                    line: index + 1,
                    fromLine: index + 1,
                    toLine: index + 1,
                    message: line.trim(),
                    key,
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
        // A block comment counts as touched over all its lines: whoever turns
        // only a middle one into `eslint-disable …` adds a new directive.
        const key = directiveKey(content, 'block');
        if (key !== undefined) {
            const line = lineOf(text, i);
            findings.push({
                rule: DISABLE_DIRECTIVE,
                file,
                line,
                fromLine: line,
                toLine: lineOf(text, end < 0 ? text.length : end),
                message: `/* ${content} */`,
                key,
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

function pathFrom(line: string, marker: string): string | undefined {
    // With a space in the name, git appends a tab.
    let path = line.slice(marker.length);
    while (path.endsWith('\t')) path = path.slice(0, -1);
    return path === '/dev/null' ? undefined : path;
}

/**
 * Reads `git diff -U0` against the merge base: `+++ <path>` names the file,
 * `@@ -a,b +c,d @@` the lines c to c+d-1 (without `,d` exactly one). `d = 0`
 * means deleted only; then the line after it, c+1, counts as changed —
 * whoever deletes the `// SAFETY:` line above an assertion creates the finding
 * exactly there.
 */
function changesSince(base: string): {
    changes: Changes;
    // New path → path at the merge base, for renamed files.
    origins: Map<string, string>;
    deleted: string[];
} {
    const changes: Changes = new Map();
    const origins = new Map<string, string>();
    const deleted: string[] = [];
    // `--find-renames` explicitly: otherwise whether `git diff` detects renames
    // depends on `diff.renames` in the machine's configuration.
    const diff = git(
        '-c',
        'core.quotePath=false',
        'diff',
        '-U0',
        '--find-renames',
        '--no-color',
        '--no-ext-diff',
        '--no-prefix',
        base,
    );
    let file: string | undefined;
    let old: string | undefined;
    // `---`/`+++` are paths only in the header of a file section; in the body
    // they would be a removed or added line starting with `-- `/`++ `.
    let inHeader = false;
    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git ')) {
            inHeader = true;
            file = undefined;
            old = undefined;
            continue;
        }
        if (inHeader && line.startsWith('--- ')) {
            old = pathFrom(line, '--- ');
            continue;
        }
        if (inHeader && line.startsWith('+++ ')) {
            file = pathFrom(line, '+++ ');
            if (file !== undefined && old !== undefined && old !== file) origins.set(file, old);
            if (file === undefined && old !== undefined) deleted.push(old);
            continue;
        }
        if (!line.startsWith('@@ ')) continue;
        inHeader = false;
        if (file === undefined) continue;
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
    return { changes, origins, deleted };
}

function onChangedLine(finding: Finding, changes: Changes): boolean {
    const lines = changes.get(finding.file);
    if (lines === WHOLE_FILE) return true;
    if (lines === undefined) return false;
    for (let n = finding.fromLine; n <= finding.toLine; n += 1) {
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
    const { rules: configuredRules, excluded, patterns } = await readConfig();
    const rules = [...configuredRules, DISABLE_DIRECTIVE];
    const measurement = measure(new Set(excluded));
    const diff = base === undefined ? undefined : changesSince(base);
    const changes = diff?.changes;
    const onNewLines = measurement.findings.filter(
        (finding) =>
            finding.rule !== DISABLE_DIRECTIVE &&
            changes !== undefined &&
            onChangedLine(finding, changes),
    );
    const excludedFiles = new Set(excluded);
    const changedFiles = [...(changes?.keys() ?? [])].filter(
        (file) => isSourceFile(file) && existsSync(file) && !excludedFiles.has(file),
    );
    const state: StateAtMergeBase =
        base === undefined || diff === undefined
            ? { findings: new Map(), directives: new Map() }
            : countsAtMergeBase(
                  base,
                  changedFiles,
                  diff.origins,
                  diff.deleted.filter(
                      (file) =>
                          isSourceFile(file) &&
                          !patterns.some((pattern) => matchesGlob(file, pattern)),
                  ),
              );
    const before = state.findings;
    const after = perFile(measurement.findings, (reported) => reported);
    const moreThanBefore = changedFiles.flatMap((file) =>
        [...(after.get(file) ?? new Map<string, number>())].flatMap(([rule, now]) => {
            const then = before.get(file)?.get(rule) ?? 0;
            return now > then ? [{ file, rule, then, now }] : [];
        }),
    );
    const newDirectives = measurement.findings.filter(
        (finding) =>
            finding.rule === DISABLE_DIRECTIVE &&
            changes !== undefined &&
            onChangedLine(finding, changes),
    );
    const actual = counted(measurement.findings, rules);
    const expected = recorded(updating);
    const actualCount = (rule: string): number => actual.get(rule) ?? 0;
    const expectedCount = (rule: string): number => expected.get(rule) ?? 0;
    const directivesThen = base === undefined ? undefined : directivesAtMergeBase(base);
    // Directives that went away, as keys: per file those at the merge base,
    // minus those still standing there on unchanged lines.
    const goneAway = new Map<string, number>();
    for (const [file, then] of state.directives) {
        const rest = [...then];
        for (const finding of measurement.findings) {
            if (finding.rule !== DISABLE_DIRECTIVE || finding.file !== file) continue;
            if (newDirectives.includes(finding)) continue;
            const at = rest.indexOf(finding.key ?? '');
            if (at >= 0) rest.splice(at, 1);
        }
        for (const key of rest) goneAway.set(key, (goneAway.get(key) ?? 0) + 1);
    }
    // A new directive is offset by a gone one that covers it — an identical
    // one first, otherwise a wider one; whatever is left needs the number
    // raised by hand.
    const unmatched = newDirectives.filter((finding) => {
        const added = finding.key ?? '';
        const candidates = [...goneAway].filter(([gone, free]) => free > 0 && covers(gone, added));
        // A narrow one first, so a wide one is more likely to remain for a later
        // directive only it covers. The matching is greedy, not optimal (see the header).
        const chosen =
            candidates.find(([gone]) => gone === added) ??
            [...candidates].sort(([a], [b]) => width(a) - width(b))[0];
        if (chosen === undefined) return true;
        goneAway.set(chosen[0], chosen[1] - 1);
        return false;
    });
    // Without the number at the merge base, this branch introduces the ratchet;
    // then the recorded number alone counts.
    const allowedDirectives = Math.max(
        0,
        expectedCount(DISABLE_DIRECTIVE) - (directivesThen ?? expectedCount(DISABLE_DIRECTIVE)),
    );
    const tooManyDirectives = unmatched.length > allowedDirectives;

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
    if (moreThanBefore.length > 0) {
        console.error('More findings than at the merge base:');
        for (const { file, rule, then, now } of moreThanBefore) {
            console.error(`  ${file}: ${rule} ${then} → ${now}`);
        }
        console.error('A changed file may not have more findings per rule than before.');
    }
    if (tooManyDirectives) {
        console.error(
            `New disable directives without a gone one that covers them: ${unmatched.length}, ` +
                `raised by hand: ${allowedDirectives}.`,
        );
        for (const { file, line, message } of unmatched) {
            console.error(`  ${file}:${line} ${message}`);
        }
        console.error(
            `A justified exception raises \`${DISABLE_DIRECTIVE}\` in ${RATCHET} in the same diff. ` +
                'A rule change takes two pull requests: first remove the old directive with its ' +
                'code and record that with `--update`, then add the new one after the merge.',
        );
    }
    if (
        onNewLines.length > 0 ||
        rose.length > 0 ||
        moreThanBefore.length > 0 ||
        tooManyDirectives
    ) {
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
