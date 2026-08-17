// Guard: every Vue injection key this package declares is created with
// `Symbol.for`, never with a plain `Symbol()`.
//
// `@saasicat/ui-vue` is loaded twice on purpose. A consumer app imports
// `createSuperAdminApp` — and with it every `app.provide(KEY, …)` — from the
// built `dist/` bundle, while the shared pages under `pages-standard/` ship as
// source and are imported from `src/`. Those are two module instances. A key
// declared as `Symbol('…')` is a different symbol in each of them: `provide`
// writes one, `inject` reads the other, and the page fails at runtime with
// "injection not found" while every line involved still reads correctly.
// `Symbol.for` goes through the process-wide registry, so both copies land on
// the same symbol. The long form is in `CONTRIBUTING.md` ("The `Symbol.for`
// rule for DI tokens") and above the keys in `src/vue/super-admin-context.ts`;
// this file is what makes that explanation fail a build.
//
// Nothing here is a list of key names. One set comes from the declarations,
// a second from the `provide()`/`inject()` call sites, and the two have to
// agree — so a key that drops out of one scan is reported by the other instead
// of quietly leaving the guard. The rule is applied to the union of both,
// which is what catches a key that carries no `InjectionKey` annotation at all
// and is only recognisable by being handed to `provide`.
//
// A call site is matched with the binding its own file can see: a declaration
// in the same file, or a named import resolved along the relative specifier it
// was written with. Two files may therefore spell one name differently without
// either being dragged into the other's rule — `SUPER_ADMIN_BRAND_KEY` is an
// injection key where it is imported from `vue/super-admin-context.ts`, and
// whatever an unrelated module means by that name stays that module's business.
//
// What this file cannot see:
//   - Keys declared outside this package's `src`, or reached through a
//     specifier this file cannot resolve to a scanned file. A `provide()`
//     naming such an identifier is reported as a failure rather than skipped,
//     so it stops the build until someone decides what it means — but the
//     guard cannot check the other package's spelling.
//   - Runtime identity. This is a source scan. It checks how a key is written,
//     not that the loaded bundles ended up agreeing; `tests/cjs-entry-identity`
//     in `@saasicat/nest` is the test that does the latter for classes.
//   - Whether two keys accidentally share one `Symbol.for` argument, or
//     whether the argument names the right namespace.
//   - A key reached through a property (`keys.THEME`) or any other computed
//     expression: the call-site reader recognises a bare identifier and a
//     string literal, and anything else fails the "every call site was read"
//     test below rather than passing unnoticed. `provide` and `inject`
//     themselves may be renamed on import from `vue` — those aliases are
//     collected — but a binding taken any other way (`const p = provide`) is
//     not a call site this file knows about.
//   - The difference between calling `provide` and declaring something else by
//     that name. `function provide(key: symbol, …)` reads as a call site whose
//     first argument cannot be placed, so it fails the same test. There is no
//     such declaration under `src`; a file that wants one has to teach this
//     reader the difference rather than be waved through.
//   - Anything in a `.vue` file outside its `<script>` blocks, and anything
//     inside a template literal — both are blanked before the scan.
//   - A key that never gets a name of its own. `const { THEME } = keys;` binds
//     through a destructuring pattern, and the reader takes no name from one.
//     Such a key does not leave quietly either: the cross-check below reports
//     it as an identifier that nothing visible to its file declares.
//   - The far side of an unusual comma. Which `,` separates two declarators is
//     decided by what follows it rather than by a parser, because the angle
//     brackets around an initializer's type arguments are not counted — see
//     `endOfDeclarator`. `new Map<string, number>()` is therefore read whole,
//     but type arguments that themselves begin like a declarator
//     (`new Map<string, { a: 1 }>(), KEY = …`) end the walk early. What comes
//     after is unread rather than approved: the floor at the bottom of this
//     file counts that declarator straight from the source text, so a key
//     annotated as an `InjectionKey` fails the build on the difference.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(__dirname, '..', 'src');

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (entry.endsWith('.ts') || entry.endsWith('.vue')) yield full;
    }
}

/** 1-based line the offset falls on. */
function lineAt(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

// A tag name ends where HTML says it ends: at whitespace, at `/`, or at `>`.
// So `<scriptish>` is not a script tag, and — the half that matters — an end
// tag written `</script >` is one. HTML allows whitespace between the tag name
// and the `>` of an end tag, Vue's SFC parser follows HTML there, and a pattern
// that insists on `</script>` reads the rest of such a file as template: every
// key declared in it becomes invisible to this guard while the file compiles
// and runs normally.
const SCRIPT_OPEN = /<script(?=[\s/>])/gi;
const SCRIPT_CLOSE = /<\/script\s*>/gi;

/**
 * The offset just past the `>` that ends an opening tag, or -1 if it has none.
 *
 * Quoted attribute values are stepped over, because a `>` inside one does not
 * end the tag: `<script generic="T extends { a: 1 }">` is a single tag.
 */
function endOfOpenTag(source, from) {
    let quote = '';
    for (let index = from; index < source.length; index += 1) {
        const char = source[index];
        if (quote) {
            if (char === quote) quote = '';
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '>') {
            return index + 1;
        }
    }
    return -1;
}

/**
 * A `.vue` file with everything outside its `<script>` blocks replaced by
 * spaces.
 *
 * Blanking rather than slicing is the point: every offset — and therefore
 * every line number this file reports — keeps pointing at the original file,
 * so a failure can be opened at the line it names.
 *
 * The scan resumes behind each closing tag, which is what makes the `<script`
 * an SFC mentions inside its own script body harmless: it is part of a block
 * already read, not the start of a new one. A block that never closes is
 * reported instead of dropped — everything from there on would otherwise be
 * blanked, and blanked code is code this guard silently stops looking at.
 */
function scriptBlocksOnly(source) {
    const out = source.split('').map((char) => (char === '\n' ? '\n' : ' '));
    const anomalies = [];
    SCRIPT_OPEN.lastIndex = 0;
    let open = SCRIPT_OPEN.exec(source);
    while (open) {
        const bodyStart = endOfOpenTag(source, open.index + open[0].length);
        if (bodyStart < 0) {
            anomalies.push(`<script tag opened at line ${lineAt(source, open.index)} never ends`);
            break;
        }
        SCRIPT_CLOSE.lastIndex = bodyStart;
        const close = SCRIPT_CLOSE.exec(source);
        if (!close) {
            anomalies.push(`<script> opened at line ${lineAt(source, open.index)} is never closed`);
            break;
        }
        for (let offset = bodyStart; offset < close.index; offset += 1)
            out[offset] = source[offset];
        SCRIPT_OPEN.lastIndex = close.index + close[0].length;
        open = SCRIPT_OPEN.exec(source);
    }
    return { code: out.join(''), anomalies };
}

/**
 * Characters after which a `/` opens a regular expression rather than dividing.
 * Applied to the significant code seen so far, so `foo / 2` and `.replace(/…/)`
 * are told apart without parsing the file.
 *
 * The keywords carry an identifier boundary because they are matched at the end
 * of the text seen so far, where a bare alternation also matches a suffix:
 * `margin / 2` ends in `in`, so the division opened a regular expression that
 * never terminated and the whole file failed to scan. `.` is excluded with the
 * word characters — a keyword after a dot is a property name, not a keyword.
 */
const REGEX_MAY_FOLLOW =
    /[(,=:[!&|?{};+\-*%~^<>]$|(?:^|[^\w$.])(?:return|typeof|case|in|of|do|else|yield|await|new)$/;

/**
 * Replaces comments, string bodies and regular-expression literals with
 * spaces, character for character, and hands back what the quoted strings said.
 *
 * Both scans below need the blanking. `src/vue/super-admin-context.ts`
 * documents the rule with the words `app.provide(KEY, ...)` inside a comment,
 * and a scan that cannot tell a comment from a statement would read that
 * sentence as a call site — and then report a key named `KEY` that nothing
 * declares. The recorded strings are what the import reader resolves module
 * specifiers from: the specifier is code, but it is the one piece of code that
 * only exists inside a string.
 *
 * The walk also reports where it lost its footing: a single- or double-quoted
 * string or a regular expression that reaches a newline means the opening
 * delimiter was misread, which the test below turns into a failure rather than
 * leaving the rest of that file scanned as something it is not.
 */
function scrubNonCode(source) {
    const out = source.split('');
    const anomalies = [];
    const strings = [];
    const blank = (index) => {
        if (out[index] !== '\n') out[index] = ' ';
    };

    let state = 'code';
    let quote = '';
    let inCharacterClass = false;
    let tail = '';
    let opened = 0;
    let index = 0;

    while (index < source.length) {
        const char = source[index];
        const nextChar = source[index + 1];

        if (state === 'code') {
            if (char === '/' && nextChar === '/') {
                blank(index);
                blank(index + 1);
                state = 'line-comment';
                index += 2;
            } else if (char === '/' && nextChar === '*') {
                blank(index);
                blank(index + 1);
                state = 'block-comment';
                index += 2;
            } else if (char === '/' && REGEX_MAY_FOLLOW.test(tail)) {
                blank(index);
                state = 'regex';
                inCharacterClass = false;
                opened = index;
                index += 1;
            } else if (char === "'" || char === '"' || char === '`') {
                blank(index);
                state = 'quoted';
                quote = char;
                opened = index;
                index += 1;
            } else {
                if (!/\s/.test(char)) tail = (tail + char).slice(-8);
                index += 1;
            }
            continue;
        }

        if (state === 'line-comment') {
            if (char === '\n') state = 'code';
            else blank(index);
            index += 1;
            continue;
        }

        if (state === 'block-comment') {
            if (char === '*' && nextChar === '/') {
                blank(index);
                blank(index + 1);
                state = 'code';
                index += 2;
            } else {
                blank(index);
                index += 1;
            }
            continue;
        }

        if (state === 'quoted') {
            if (char === '\\') {
                blank(index);
                blank(index + 1);
                index += 2;
            } else if (char === quote) {
                blank(index);
                // Every quoted string is recorded, escapes and all — a
                // specifier written with one simply resolves to no file. What
                // must not happen is a string going unrecorded: the blanks it
                // leaves behind read as whitespace, and the reader below would
                // walk over them to the next string and take that for the
                // specifier. Template literals are the one gap, and a static
                // import specifier cannot be one.
                if (quote !== '`') {
                    strings.push({ start: opened, value: source.slice(opened + 1, index) });
                }
                // A closed string is a value, so a `/` after it divides.
                tail = (tail + 'x').slice(-8);
                state = 'code';
                index += 1;
            } else if (char === '\n' && quote !== '`') {
                anomalies.push(
                    `unterminated ${quote} string opened at line ${lineAt(source, opened)}`,
                );
                state = 'code';
                index += 1;
            } else {
                blank(index);
                index += 1;
            }
            continue;
        }

        // state === 'regex'
        if (char === '\\') {
            blank(index);
            blank(index + 1);
            index += 2;
        } else if (char === '[') {
            blank(index);
            inCharacterClass = true;
            index += 1;
        } else if (char === ']') {
            blank(index);
            inCharacterClass = false;
            index += 1;
        } else if (char === '/' && !inCharacterClass) {
            blank(index);
            tail = (tail + 'x').slice(-8);
            state = 'code';
            index += 1;
        } else if (char === '\n') {
            anomalies.push(
                `unterminated regular expression opened at line ${lineAt(source, opened)}`,
            );
            state = 'code';
            index += 1;
        } else {
            blank(index);
            index += 1;
        }
    }

    if (state !== 'code') anomalies.push(`file ends inside ${state}`);
    return { code: out.join(''), anomalies, strings };
}

const sources = [...walk(SRC)].map((file) => {
    const text = readFileSync(file, 'utf8');
    const isVue = file.endsWith('.vue');
    const block = isVue ? scriptBlocksOnly(text) : { code: text, anomalies: [] };
    const { code, anomalies, strings } = scrubNonCode(block.code);
    return {
        path: relative(SRC, file).split(sep).join('/'),
        code,
        strings,
        anomalies: [...block.anomalies, ...anomalies],
    };
});

const byPath = new Map(sources.map((source) => [source.path, source]));

// Type syntax nests in angle brackets as well as in round, square and curly
// ones; expressions do not — `a < b` is a comparison far more often than
// `Map<a, b>` is a type. So an annotation is walked with all four pairs and an
// initializer with three.
const OPENERS = '([{<';
const CLOSERS = ')]}>';
const NESTING_OPENERS = '([{';
const NESTING_CLOSERS = ')]}';

/**
 * The type annotation of a `const NAME: T = …`, read up to the `=` that starts
 * the initializer — or, for a declarator that carries no value, to the `,` or
 * `;` that ends it.
 *
 * Walked by bracket depth rather than matched by a regex, because the
 * annotations in this package contain their own `=` and their own `,`:
 * `InjectionKey<() => AdminManifest | null>` would end a lazier reader inside
 * the arrow, and `Map<string, number>` at the comma.
 */
function readAnnotation(code, at) {
    if (code[at] !== ':') return { annotation: '', valueAt: at + 1 };
    let depth = 0;
    let index = at;
    while (index < code.length) {
        const char = code[index];
        // `=>` is one token: neither half may end the annotation or move the
        // depth, or `: () => void = …` would be read as ending at the arrow.
        if (char === '=' && code[index + 1] === '>') {
            index += 2;
            continue;
        }
        if (OPENERS.includes(char)) depth += 1;
        else if (CLOSERS.includes(char)) depth -= 1;
        else if ((char === ';' || char === ',') && depth <= 0)
            return { annotation: code.slice(at + 1, index), valueAt: -1 };
        else if (char === '=' && depth <= 0)
            return { annotation: code.slice(at + 1, index), valueAt: index + 1 };
        index += 1;
    }
    return { annotation: '', valueAt: -1 };
}

/**
 * What a declarator may start with, used to tell a `,` that separates two of
 * them from a `,` the bracket counter cannot see into.
 *
 * Sticky rather than anchored so it can be pointed at an offset without
 * slicing the file at every comma. Set `lastIndex` before every use.
 */
const NEXT_DECLARATOR = /\s*(?:[A-Za-z_$][\w$]*\s*(?:[:;,]|=(?![=>]))|[{[])/y;

/**
 * Where a declarator ends: the `,` that starts the next one, or the `;` that
 * ends the statement.
 *
 * The type arguments of an initializer are the reason the `,` has to prove
 * itself. `new Map<string, number>()` holds a comma outside every bracket this
 * counts, and stays one initializer only because `number>` cannot begin a
 * declarator.
 */
function endOfDeclarator(code, from) {
    let depth = 0;
    for (let index = from; index < code.length; index += 1) {
        const char = code[index];
        if (NESTING_OPENERS.includes(char)) depth += 1;
        else if (NESTING_CLOSERS.includes(char)) depth -= 1;
        else if (char === ';' && depth <= 0) return { at: index, separated: false };
        else if (char === ',' && depth <= 0) {
            NEXT_DECLARATOR.lastIndex = index + 1;
            if (NEXT_DECLARATOR.test(code)) return { at: index, separated: true };
        }
    }
    return { at: code.length, separated: false };
}

const DECLARATION = /\b(export\s+)?(?:const|let|var)\s+/g;
const DECLARATOR_NAME = /([A-Za-z_$][\w$]*)\s*/y;

/**
 * The offset just past a destructuring target, or -1 where there is none.
 *
 * A pattern binds names this reader does not take — see the header — but it
 * still has to be stepped over, or the declarators after it would be lost too.
 */
function skipPattern(code, at) {
    if (code[at] !== '{' && code[at] !== '[') return -1;
    let depth = 0;
    for (let index = at; index < code.length; index += 1) {
        const char = code[index];
        if (NESTING_OPENERS.includes(char)) depth += 1;
        else if (NESTING_CLOSERS.includes(char)) depth -= 1;
        else continue;
        if (depth > 0) continue;
        let end = index + 1;
        while (end < code.length && /\s/.test(code[end])) end += 1;
        return end;
    }
    return -1;
}

/**
 * Every declarator of one `const`/`let`/`var` statement, in source order.
 *
 * One statement may bind more than one name — `const A = …, B = …;` — and the
 * second declarator is as much a declaration as the first. Reading only the
 * name that touches the keyword is how an injection key built from a plain
 * `Symbol()` walked past this guard: chained behind a well-behaved
 * `Symbol.for`, it was named by neither derivation, and the first declarator's
 * initializer simply swallowed it and still began with `Symbol.for(`.
 */
function readDeclarators(code, start) {
    const found = [];
    let at = start;
    while (at < code.length) {
        // Onto the declarator itself: `at` is what the failure message points
        // at, and a separator leaves the cursor on the whitespace behind it.
        while (at < code.length && /\s/.test(code[at])) at += 1;
        DECLARATOR_NAME.lastIndex = at;
        const named = DECLARATOR_NAME.exec(code);
        const afterTarget = named ? DECLARATOR_NAME.lastIndex : skipPattern(code, at);
        if (afterTarget < 0) return found;
        const punctuation = code[afterTarget];
        // `let a, b = …`: a declarator may carry neither annotation nor value.
        if (punctuation === ',') {
            at = afterTarget + 1;
            continue;
        }
        // Anything else ends the statement — the `;`, or the `of` of a `for`.
        if (punctuation !== ':' && punctuation !== '=') return found;
        const { annotation, valueAt } = readAnnotation(code, afterTarget);
        const end = endOfDeclarator(code, valueAt < 0 ? afterTarget : valueAt);
        if (named && valueAt >= 0) {
            found.push({
                name: named[1],
                at,
                annotation,
                initializer: code.slice(valueAt, end.at).trim(),
            });
        }
        if (!end.separated) return found;
        at = end.at + 1;
    }
    return found;
}

/** Every named binding with an initializer, with its annotation and its value. */
function declarations() {
    const found = [];
    for (const { path, code } of sources) {
        for (const match of code.matchAll(DECLARATION)) {
            for (const { name, at, annotation, initializer } of readDeclarators(
                code,
                match.index + match[0].length,
            )) {
                found.push({
                    name,
                    path,
                    line: lineAt(code, at),
                    exported: Boolean(match[1]),
                    annotation,
                    initializer,
                });
            }
        }
    }
    return found;
}

const allBindings = declarations();

const bindingsByPath = new Map();
for (const binding of allBindings) {
    if (!bindingsByPath.has(binding.path)) bindingsByPath.set(binding.path, []);
    bindingsByPath.get(binding.path).push(binding);
}

const identity = ({ path, line, name }) => `${path}:${line}:${name}`;

/**
 * The bindings that say they are injection keys — through the annotation
 * (`: InjectionKey<T>`) or through a cast (`… as InjectionKey<T>`). Vue accepts
 * a bare `symbol` where an `InjectionKey` is expected, so neither form is
 * required by the compiler; that is exactly why the second derivation below
 * exists.
 */
const annotatedKeys = allBindings.filter(
    ({ annotation, initializer }) =>
        /\bInjectionKey\b/.test(annotation) ||
        /\bas\s+(?:unknown\s+as\s+)?InjectionKey\b/.test(initializer) ||
        // `satisfies InjectionKey<T>` classifies a key exactly as an annotation
        // or a cast does. An exported, consumer-only key written that way — with
        // no `provide`/`inject` inside `src` for the other derivation to recover
        // it from — was in neither, so a plain local symbol could be published
        // while this stayed green.
        /\bsatisfies\s+InjectionKey\b/.test(initializer),
);
const ANNOTATED_FIRST_DECLARATOR = /\bconst\s+[A-Za-z_$][\w$]*\s*:\s*InjectionKey\s*</g;
const ANNOTATED_NEXT_DECLARATOR = /\s*[A-Za-z_$][\w$]*\s*:\s*InjectionKey\s*</y;

/**
 * How many declarators spell out `: InjectionKey<`, counted without the reader
 * above so that the two derivations can disagree.
 *
 * The first form is the declarator that touches the keyword. The second is
 * every further declarator of the same statement, recognised by a `,` that
 * stands outside every bracket — which is what a declarator separator is, and
 * what a comma in a parameter list, an object literal or an object type is not.
 *
 * The keyword form is `const` alone, and the reader accepts `let` and `var`
 * too, on purpose: `const` is the one that cannot stand without a value. The
 * reader passes over a declarator that has none, so a floor counting
 * `let KEY: InjectionKey<T>;` would climb above the reader it is checking and
 * report a loss that never happened.
 */
function writtenAnnotations(code) {
    let total = (code.match(ANNOTATED_FIRST_DECLARATOR) ?? []).length;
    let depth = 0;
    for (let index = 0; index < code.length; index += 1) {
        const char = code[index];
        if (NESTING_OPENERS.includes(char)) depth += 1;
        else if (NESTING_CLOSERS.includes(char)) depth -= 1;
        else if (char === ',' && depth <= 0) {
            ANNOTATED_NEXT_DECLARATOR.lastIndex = index + 1;
            if (ANNOTATED_NEXT_DECLARATOR.test(code)) total += 1;
        }
    }
    return total;
}

const NAMED_IMPORT = /\bimport\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\b/g;
/**
 * Whether an initializer *is* a `Symbol.for(…)` call rather than merely opening
 * with one.
 *
 * A prefix test answers the wrong question: `Symbol.for('decoy') && Symbol('x')`
 * starts with the call and evaluates to the local symbol, which is exactly the
 * cross-bundle failure this file exists to prevent. So the call's own closing
 * parenthesis has to end the expression, with nothing after it but the type
 * syntax TypeScript allows there.
 */
function isSymbolForCall(initializer) {
    const text = initializer.trim();
    if (!/^Symbol\.for\s*\(/.test(text)) return false;
    let depth = 0;
    for (let i = text.indexOf('('); i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') {
            depth -= 1;
            if (depth === 0) {
                // `as InjectionKey<T>`, `satisfies InjectionKey<T>` and a
                // trailing `!` are assertions, not another operand. The tail is
                // judged structurally rather than by a character class: a type
                // may contain `(`, `=>`, `{`, `&` — `as InjectionKey<() =>
                // void>` is a supported form this file rejected — while what
                // must not appear is a value operator OUTSIDE any bracket,
                // which is what `Symbol.for('a') as T && Symbol('b')` has.
                return isTypeAssertionTail(text.slice(i + 1));
            }
        }
    }
    return false;
}

/**
 * Whether what follows a call is only a type assertion.
 *
 * Enumerating the type grammar was the mistake: TypeScript puts `(`, `=>`, `{`,
 * `&` and quotes inside a type, and a character class listing what it had seen
 * so far rejected `as InjectionKey<() => void>`. What actually distinguishes an
 * assertion from a second operand is depth — a type's brackets nest, and the
 * operator that would change the value sits at depth zero.
 */
function isTypeAssertionTail(tail) {
    const text = tail.trim().replace(/^!\s*/, '');
    if (text === '') return true;
    const keyword = /^(?:as|satisfies)\s/.exec(text);
    if (!keyword) return false;

    // After the keyword everything is a type, so `|` and `&` are its own
    // operators and say nothing. What a type cannot contain at depth zero is a
    // value operator: the doubled forms, a ternary, a comma, or a call.
    const body = keyword ? text.slice(keyword[0].length) : text;
    let depth = 0;
    for (let i = 0; i < body.length; i += 1) {
        const char = body[i];
        // `=>` is an arrow inside a function type; its `>` closes nothing.
        if (char === '>' && body[i - 1] === '=') continue;
        if ('<([{'.includes(char)) {
            if (char === '(' && depth === 0) return false;
            depth += 1;
            continue;
        }
        if ('>)]}'.includes(char)) {
            depth -= 1;
            if (depth < 0) return false;
            continue;
        }
        if (depth > 0) continue;
        const pair = body.slice(i, i + 2);
        if (pair === '&&' || pair === '||' || pair === '??') return false;
        if ('?:,;+'.includes(char)) return false;
    }
    return depth === 0;
}

const NAMED_REEXPORT = /\bexport\s+(?:type\s+)?\{([^}]*)\}\s*from\b/g;
const STAR_REEXPORT = /\bexport\s*\*\s*from\b/g;
/**
 * `export { A, B as C }` without a `from`, which exports bindings declared in
 * this file. The lookahead is zero-width so it cannot backtrack into the
 * whitespace and swallow a re-export, which `\s*(?!from\b)` would.
 */
const LOCAL_EXPORT = /\bexport\s*\{([^}]*)\}(?!\s*from\b)/g;
const NAMED_BINDING = /(?:^|,)\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/g;

/** The `{ A, B as C }` of an import or re-export clause, as imported/local pairs. */
function namedBindings(clause) {
    return [...clause.matchAll(NAMED_BINDING)].map((match) => ({
        imported: match[1],
        local: match[2] ?? match[1],
    }));
}

/**
 * The module specifier that follows a `from` keyword, or null.
 *
 * The scrub blanks string bodies, so the specifier is read from what it
 * recorded instead of from the blanked code — and only when nothing but
 * whitespace stands between the keyword and that string, so that a `from`
 * followed by something else cannot borrow a later statement's string. A
 * comment between the two is blanked, which is whitespace, so it is allowed.
 */
function specifierAfter(source, at) {
    const literal = source.strings.find(({ start }) => start >= at);
    if (!literal || source.code.slice(at, literal.start).trim() !== '') return null;
    return literal.value;
}

/**
 * The scanned file a relative specifier names, or null for anything outside
 * `src` — a bare package name, or a path this scan does not hold.
 *
 * The extensions are the ones this package writes: TypeScript source is
 * imported under its emitted `.js` name, single-file components under their
 * own, and a folder stands for its `index.ts`.
 */
function resolveSpecifier(fromPath, specifier) {
    if (!specifier.startsWith('.')) return null;
    const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
    const candidates = [base.replace(/\.js$/, '.ts'), base, `${base}.ts`, `${base}/index.ts`];
    return candidates.find((candidate) => byPath.has(candidate)) ?? null;
}

function addBinding(map, name, binding) {
    if (!map.has(name)) map.set(name, []);
    if (!map.get(name).some((known) => identity(known) === identity(binding)))
        map.get(name).push(binding);
}

/** Every `X from './y'` clause of one file, already resolved to a scanned file. */
function clausesOf(source, pattern) {
    const found = [];
    for (const match of source.code.matchAll(pattern)) {
        const specifier = specifierAfter(source, match.index + match[0].length);
        const target = specifier === null ? null : resolveSpecifier(source.path, specifier);
        found.push({ clause: match[1] ?? '', specifier, target });
    }
    return found;
}

const exportsCache = new Map();

/**
 * What one file offers under each exported name.
 *
 * Re-exports are followed, because a barrel is a legitimate way for a page to
 * reach a key and a guard that could not see through one would report the
 * import as undeclared. A cycle stops rather than recurses, and whatever a file
 * re-exports around that cycle is then missing from its surface — which shows
 * up as a call site this guard says it cannot place, not as one it waves
 * through.
 */
function exportsOf(path, seen = new Set()) {
    const cached = exportsCache.get(path);
    if (cached) return cached;
    if (seen.has(path)) return new Map();
    const source = byPath.get(path);
    const surface = new Map();
    if (!source) return surface;

    const withSelf = new Set([...seen, path]);
    for (const binding of bindingsByPath.get(path) ?? []) {
        if (binding.exported) addBinding(surface, binding.name, binding);
    }
    // `export { KEY }` names a binding declared above it. Without this a key
    // written that way is exported in fact and unexported here, so a file
    // importing it would be reported as naming a key nobody declared — a guard
    // that rejects ordinary syntax gets switched off.
    //
    // No file under `src` writes that form today (measured: zero), so this loop
    // has no input in this tree and no run exercises it. The test below proves
    // the pattern and the local-to-exported mapping, which is what can be
    // proven here; the integration is unproven until such a file exists.
    for (const match of source.code.matchAll(LOCAL_EXPORT)) {
        for (const { imported, local } of namedBindings(match[1] ?? '')) {
            for (const binding of bindingsByPath.get(path) ?? []) {
                if (binding.name === imported) addBinding(surface, local, binding);
            }
        }
    }
    for (const { target } of clausesOf(source, STAR_REEXPORT)) {
        if (!target) continue;
        for (const [name, bindings] of exportsOf(target, withSelf)) {
            for (const binding of bindings) addBinding(surface, name, binding);
        }
    }
    for (const { clause, target } of clausesOf(source, NAMED_REEXPORT)) {
        if (!target) continue;
        const reached = exportsOf(target, withSelf);
        for (const { imported, local } of namedBindings(clause)) {
            for (const binding of reached.get(imported) ?? []) addBinding(surface, local, binding);
        }
    }

    exportsCache.set(path, surface);
    return surface;
}

/**
 * Every binding one file can name: what it declares itself, plus what its named
 * imports bring in under the local name they were given.
 *
 * Resolving per file is what keeps two unrelated modules that happen to agree
 * on a name out of each other's rule. A repo-wide lookup by name cannot: it
 * makes any `const SUPER_ADMIN_BRAND_KEY = 'storage-name'` anywhere under `src`
 * answer for a `provide()` that never reaches it, and a guard that fails on
 * code it has no business judging is a guard someone switches off.
 */
function visibleBindings(source) {
    const visible = new Map();
    for (const binding of bindingsByPath.get(source.path) ?? []) {
        addBinding(visible, binding.name, binding);
    }
    for (const { clause, target } of clausesOf(source, NAMED_IMPORT)) {
        if (!target) continue;
        const reached = exportsOf(target);
        for (const { imported, local } of namedBindings(clause)) {
            for (const binding of reached.get(imported) ?? []) addBinding(visible, local, binding);
        }
    }
    return visible;
}

const VUE_MODULE = 'vue';
const PROVIDE_AND_INJECT = ['provide', 'inject'];

/**
 * The names that mean Vue's `provide`/`inject` in one file.
 *
 * `import { provide as vueProvide } from 'vue'` is a rename, not a disguise:
 * `vueProvide(LOCAL_KEY, …)` provides, so it is a call site, and a scan that
 * only knew the two original spellings would let the key it names out of both
 * derivations at once — declared without an annotation, used at a call site
 * nothing recognises, checked by nothing. Only `vue` is followed, so a
 * `provide` imported from somewhere else keeps whatever meaning it has there;
 * the bare spellings stay call sites regardless of where they come from.
 */
function callNames(source) {
    const names = new Set(PROVIDE_AND_INJECT);
    for (const { clause, specifier } of clausesOf(source, NAMED_IMPORT)) {
        if (specifier !== VUE_MODULE) continue;
        for (const { imported, local } of namedBindings(clause)) {
            if (PROVIDE_AND_INJECT.includes(imported)) names.add(local);
        }
    }
    return names;
}

const FIRST_ARGUMENT_IDENTIFIER = /^\s*([A-Za-z_$][\w$]*)\s*[,)]/;
const FIRST_ARGUMENT_LITERAL = /^\s*['"`]/;

/**
 * Every `provide(…)` / `inject(…)` call, with whatever its first argument is
 * and with the declarations its own file can see under that name.
 */
function callSites() {
    const found = [];
    for (const source of sources) {
        const names = [...callNames(source)].join('|');
        const pattern = new RegExp(String.raw`\b(?:${names})\s*\(`, 'g');
        const visible = visibleBindings(source);
        for (const match of source.code.matchAll(pattern)) {
            const argument = source.code.slice(match.index + match[0].length);
            const identifier = FIRST_ARGUMENT_IDENTIFIER.exec(argument);
            found.push({
                path: source.path,
                line: lineAt(source.code, match.index),
                name: identifier ? identifier[1] : null,
                bindings: identifier ? (visible.get(identifier[1]) ?? []) : [],
                // A string key is legal in Vue and simply outside this rule:
                // it has no symbol identity to split in the first place.
                literal: !identifier && FIRST_ARGUMENT_LITERAL.test(argument),
                excerpt: argument.slice(0, 40).replace(/\s+/g, ' ').trim(),
            });
        }
    }
    return found;
}

/**
 * Whether a binding holds a plain string.
 *
 * Vue accepts a string as an injection key, and a string does not acquire a
 * symbol-identity problem by being stored in a constant first — `const KEY =
 * 'local'; provide(KEY, value)` is ordinary, valid code. The call-site
 * derivation reads it as an identifier, so without this it entered the roster
 * and failed both assertions: a guard rejecting correct source, which is how a
 * guard gets switched off.
 *
 * A key annotated `: InjectionKey<T>` cannot be one of these — Vue's own type
 * extends `Symbol` — so only this derivation needs the exemption.
 *
 * No file under `src` provides or injects a string-bound identifier today
 * (measured: none), so removing the filter changes nothing here and no run
 * exercises it. The test below proves the predicate, which is what can be
 * proven; the wiring stays unproven until such a call exists.
 */
function isStringKey(initializer) {
    const text = (initializer ?? '').trim();
    const quote = text[0];
    if (!["'", '"', '`'].includes(quote) || text.at(-1) !== quote || text.length < 2) return false;
    const body = text.slice(1, -1);
    return !body.includes(quote) && !(quote === '`' && body.includes('${'));
}

const sites = callSites();
const namedSites = sites.filter(({ name }) => name);
const usedBindings = namedSites
    .flatMap(({ bindings }) => bindings)
    .filter(({ initializer }) => !isStringKey(initializer));

/** The rule applies to both derivations together. */
const injectionKeys = [
    ...new Map(
        [...annotatedKeys, ...usedBindings].map((binding) => [identity(binding), binding]),
    ).values(),
];

const where = ({ path, line, name }) => `${path}:${line} — ${name}`;

describe('every Vue injection key is created with Symbol.for', () => {
    test('the sources were read to the end', () => {
        // The scans below are only worth as much as the scrub that feeds them.
        // A misread delimiter would blank real code, and blanked code is code
        // this guard silently stops looking at.
        const confused = sources
            .filter(({ anomalies }) => anomalies.length > 0)
            .map(({ path, anomalies }) => `${path}: ${anomalies.join('; ')}`);
        assert.deepEqual(
            confused,
            [],
            'The script-block, comment, string and regex scrub lost its place in these files, ' +
                'so everything after that point was scanned as the wrong kind of text:\n  ' +
                confused.join('\n  '),
        );
    });

    test('there are keys and call sites to look at', () => {
        assert.ok(
            annotatedKeys.length > 0,
            'no `InjectionKey` declaration found under src — the declaration scan stopped matching',
        );
        assert.ok(
            namedSites.length > 0,
            'no provide()/inject() call names an identifier — the call-site scan stopped matching',
        );
        assert.ok(
            usedBindings.length > 0,
            'no provide()/inject() call resolves to a declaration — the import reader stopped ' +
                'reaching the files the keys are declared in',
        );
    });

    test('every injection key is created with Symbol.for', () => {
        const local = injectionKeys
            .filter(({ initializer }) => !isSymbolForCall(initializer))
            .map(where);
        assert.deepEqual(
            local,
            [],
            'A Vue injection key has to be created with `Symbol.for(...)`. This package is ' +
                'loaded twice — pages from `src/`, the bootstrap from `dist/` — and a plain ' +
                '`Symbol()` is a different symbol in each copy, so `inject()` never finds what ' +
                '`provide()` wrote. See `CONTRIBUTING.md`:\n  ' +
                local.join('\n  '),
        );
    });

    test('every key a provide/inject call names is one the declaration scan found', () => {
        // This is what keeps the set above from shrinking in silence. A key
        // that loses its declaration, or whose declaration changes into a
        // shape the reader no longer parses, is still named at its call sites
        // — and turns up here instead of simply leaving the guard. Deleting a
        // key together with all of its uses is the one way it may leave, and
        // then there is nothing left to guard.
        const undeclared = namedSites
            .filter(({ bindings }) => bindings.length === 0)
            .map(({ path, line, name }) => `${path}:${line} — ${name}`);
        assert.deepEqual(
            undeclared,
            [],
            'These identifiers are handed to provide()/inject() but nothing their own file can ' +
                'see declares them. Either the declaration was removed or reshaped past the ' +
                'reader in this file, the import that brings it in resolves to no scanned file, ' +
                'or the key really comes from another package — in which case this guard has to ' +
                'be taught how to reach it, because it cannot check a spelling it never ' +
                'sees:\n  ' +
                undeclared.join('\n  '),
        );

        const annotatedIds = new Set(annotatedKeys.map(identity));
        const unannounced = [
            ...new Set(
                usedBindings.filter((binding) => !annotatedIds.has(identity(binding))).map(where),
            ),
        ];
        assert.deepEqual(
            unannounced,
            [],
            'These are used as injection keys but are not declared as `InjectionKey<T>`. Vue ' +
                'accepts a bare `symbol` there, so nothing else says what they are — annotate ' +
                'them, so the declaration alone carries the fact:\n  ' +
                unannounced.join('\n  '),
        );
    });

    test('every provide/inject call site was read', () => {
        // The set of used keys is only complete while every call site yields
        // one. A key passed as `keys.THEME` or through any other expression
        // would leave no name behind, and the cross-check above would lose a
        // member without noticing — so an unreadable call site is a failure
        // here.
        const unread = sites
            .filter(({ name, literal }) => !name && !literal)
            .map(({ path, line, excerpt }) => `${path}:${line} — provide/inject(${excerpt}…`);
        assert.deepEqual(
            unread,
            [],
            'The first argument of these provide()/inject() calls is neither a bare identifier ' +
                'nor a string literal, so this guard cannot tell which key they use. Pass the ' +
                'key by name:\n  ' +
                unread.join('\n  '),
        );
    });

    test('a string key is a key, and not a missing Symbol.for', () => {
        // `const KEY = 'local'; provide(KEY, value)` is valid Vue. Reading the
        // identifier and then demanding a `Symbol.for` of it rejects correct
        // source — the failure mode that gets a guard disabled. Predicate only:
        // no such call exists under `src`, so nothing here drives the filter.
        assert.equal(isStringKey("'local'"), true);
        assert.equal(isStringKey('"local"'), true);
        assert.equal(isStringKey('`local`'), true);
        assert.equal(isStringKey("Symbol('local')"), false);
        assert.equal(isStringKey("Symbol.for('local')"), false);
        // A template literal that interpolates is not a plain string.
        assert.equal(isStringKey('`local-${id}`'), false);
    });

    test('a type assertion may contain what a type contains', () => {
        assert.equal(isSymbolForCall("Symbol.for('k') as InjectionKey<() => void>"), true);
        assert.equal(isSymbolForCall("Symbol.for('k') as InjectionKey<{ a: string }>"), true);
        assert.equal(isSymbolForCall("Symbol.for('k') as InjectionKey<A & B>"), true);
        assert.equal(isSymbolForCall("Symbol.for('k') satisfies InjectionKey<() => void>"), true);
        // And still not a second operand.
        assert.equal(isSymbolForCall("Symbol.for('a') as T && Symbol('b')"), false);
        assert.equal(isSymbolForCall("Symbol.for('a') as T ? x : y"), false);
    });

    test('a division after a keyword-suffixed name is not a regular expression', () => {
        // `margin` ends in `in`. Matched without an identifier boundary, the
        // `/` opened a regular expression that never closed, and the scan of
        // that file — and with it the whole guard — collapsed on valid source.
        const divided = scrubNonCode('const half = (margin) => margin / 2;\nconst x = 1;');
        assert.deepEqual(divided.anomalies, []);
        assert.match(divided.code, /margin \/ 2/);

        // And a keyword that really is one still opens a regular expression:
        // its body is blanked, so the identifier inside it disappears.
        const kept = scrubNonCode('return /needle/.test(m);');
        assert.deepEqual(kept.anomalies, []);
        assert.doesNotMatch(kept.code, /needle/);
    });

    test('an initializer that merely starts with Symbol.for is not one', () => {
        assert.equal(isSymbolForCall("Symbol.for('a')"), true);
        assert.equal(isSymbolForCall("  Symbol.for('a') as InjectionKey<string>"), true);
        assert.equal(isSymbolForCall("Symbol.for('a')!"), true);
        // Evaluates to the local symbol — the exact failure the guard prevents.
        assert.equal(isSymbolForCall("Symbol.for('decoy') && Symbol('actual')"), false);
        assert.equal(isSymbolForCall("Symbol.for('a') ?? Symbol('b')"), false);
        assert.equal(isSymbolForCall("cond ? Symbol.for('a') : Symbol('b')"), false);
    });

    test('a local export list is an export, and a re-export is not one of them', () => {
        // Pattern and mapping only — see the note at the loop that consumes it.
        const local = [...'export { KEY, OTHER as PUBLIC };'.matchAll(LOCAL_EXPORT)];
        assert.equal(local.length, 1);
        assert.deepEqual(namedBindings(local[0][1]), [
            { imported: 'KEY', local: 'KEY' },
            { imported: 'OTHER', local: 'PUBLIC' },
        ]);
        // The lookahead must not backtrack into the whitespace and take this.
        assert.deepEqual([..."export { KEY } from './x';".matchAll(LOCAL_EXPORT)], []);
    });

    test('the annotated declarations survive the bracket walk', () => {
        // A second count, taken without the reader above, against a floor the
        // sources set themselves: it says how many declarators plainly spell
        // out `: InjectionKey<`, and the depth-walking reader has to have found
        // at least that many. A key gained through a cast may exceed the floor
        // — that direction adds a true statement rather than losing one.
        //
        // It counts the declarators after the first one as well, and has to:
        // while it only looked behind a `const`, a comma-chained key was
        // invisible to this count and to the reader at the same time, so the
        // two could agree while both were wrong. A second derivation is only
        // worth having where it reaches everything the first one claims.
        //
        // Today this overlaps the cross-check, because every key the package
        // declares is also handed to a `provide()` or `inject()` inside `src`,
        // so losing one is reported there too. The overlap ends the moment a
        // key is declared here and used only by consumer apps: no call site in
        // `src` then misses it, and this count is the only thing left that can.
        const written = sources.reduce((total, { code }) => total + writtenAnnotations(code), 0);
        assert.ok(
            annotatedKeys.length >= written,
            `${written} declarators spell out \`: InjectionKey<\` under src, but the ` +
                `declaration reader found only ${annotatedKeys.length} — it lost ` +
                `${written - annotatedKeys.length} of them`,
        );
    });
});
