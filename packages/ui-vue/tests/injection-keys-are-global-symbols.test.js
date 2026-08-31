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
// The sources are read with TypeScript's own compiler API — the package already
// depends on `typescript` to build. Four rounds of review had narrowed a regex
// scan down to two shapes a pattern cannot decide (issue #158): an
// `InjectionKey` reached through a local type alias, which needs the type
// resolved, and two functions in one file declaring the same name, which needs
// a lexical scope. A parser has both, so both are decided here, and the
// hand-written readers that used to approximate one — comment and string
// scrubbing, declarator splitting, annotation walking, import resolution,
// re-export following, assertion-tail classification — are gone with it.
//
// Nothing here is a list of key names, and nothing here is a list of Vue's
// names either. `provide`, `inject`, `App.provide` and `InjectionKey` are read
// out of the `vue` package's own module surface and then matched by declaration
// identity, so an alias, a re-export or a rename resolves to the same
// declaration, and a same-named function from somewhere else does not.
//
// One set of keys comes from the declarations, a second from the
// `provide()`/`inject()` call sites, and the two have to agree — so a key that
// drops out of one scan is reported by the other instead of quietly leaving the
// guard. The rule is applied to the union of both, which is what catches a key
// that carries no `InjectionKey` annotation at all and is only recognisable by
// being handed to `provide`.
//
// What this file cannot see:
//   - Runtime identity. This is a source scan. It checks how a key is written,
//     not that the loaded bundles ended up agreeing; `tests/cjs-entry-identity`
//     in `@saasicat/nest` is the test that does the latter for classes.
//   - Whether two keys accidentally share one `Symbol.for` argument, or whether
//     the argument names the right namespace.
//   - Keys declared outside `src`. A `provide()` naming such an identifier is
//     reported as a failure rather than skipped, so it stops the build until
//     someone decides what it means — but the guard cannot check the other
//     package's spelling.
//   - A key reached through a property (`keys.THEME`) or any other computed
//     expression: the call-site reader recognises a bare identifier and a
//     string literal, and anything else fails the "every call site was read"
//     test below rather than passing unnoticed.
//   - `provide` and `inject` reached through a binding no import names. They
//     may be renamed on import — those aliases are collected, and the checker
//     confirms each one really is Vue's — but a binding taken any other way
//     (`const p = provide`) is not a call this file asks about.
//   - A key whose value arrives after its declaration (`let KEY:
//     InjectionKey<T>; KEY = Symbol('x')`). The rule is applied to an
//     initializer, and a declaration without one has nothing to judge.
//   - Anything in a `.vue` file outside its `<script>` blocks, which are the
//     only part handed to the parser.

// @requirement SC-COMP-001 — All packages carry one version number and move together

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { join } from 'node:path';

import {
    PACKAGE,
    SRC,
    compilerOptions,
    filesUnder,
    inMemoryHost,
    tree,
} from './support/vue-typescript-program.mjs';

/**
 * Where the counter-check trees at the bottom of this file pretend to live.
 *
 * Inside the package, so `vue` resolves for them along exactly the same
 * `node_modules` walk as it does for `src`; on no disk, so they cannot be read,
 * built or shipped by accident.
 */
const IN_MEMORY = join(PACKAGE, 'tests', '__counter-checks__');

const REAL = tree(SRC, filesUnder(SRC));

// The counter-check trees are declared next to the tests that read them, at the
// bottom of this file; they join the same program as `src`, so the whole guard
// costs one parse of Vue's types and one of the standard library.
const COUNTER_CHECKS = [];

/**
 * Registers a tree this guard has to fail on, and returns its report.
 *
 * `neighbours` are published into the program but left out of the tree. That is
 * the shape of a key living in another package: reachable for the compiler,
 * outside what this guard may judge.
 */
function counterCheck(name, files, neighbours = {}) {
    const root = join(IN_MEMORY, name);
    const spread = (source) => Object.entries(source).map(([path, text]) => ({ path, text }));
    const built = tree(root, spread(files));
    COUNTER_CHECKS.push(...built, ...tree(root, spread(neighbours)));
    return () => inspect(built);
}

/* -------------------------------------------------------------------------
 * The program
 * ---------------------------------------------------------------------- */

const options = compilerOptions();

let program;
let checker;

/**
 * Vue's own declarations of the four things this guard recognises.
 *
 * Read off the `vue` module's export surface and kept as declaration nodes:
 * symbols get instantiated — `App<Element>['provide']` is not the symbol
 * declared on `App` — while the declaration a symbol came from stays the same
 * node. Matching on nodes therefore survives generics, import aliases and
 * re-exports, and still says no to a `provide` that is somebody else's
 * function.
 */
const VUE = { calls: new Set(), injectionKey: new Set(), found: {} };

function unalias(symbol) {
    return symbol && symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
}

const declarationsOf = (symbol) => symbol?.getDeclarations() ?? [];
const declaredIn = (symbol, nodes) => declarationsOf(symbol).some((node) => nodes.has(node));

function start() {
    const { host, fileNames } = inMemoryHost([...REAL, ...COUNTER_CHECKS], options);

    program = ts.createProgram(fileNames, options, host);
    checker = program.getTypeChecker();

    const resolved = ts.resolveModuleName('vue', join(SRC, 'index.ts'), options, host);
    const entry =
        resolved.resolvedModule && program.getSourceFile(resolved.resolvedModule.resolvedFileName);
    const module = entry && checker.getSymbolAtLocation(entry);
    const surface = new Map(
        module
            ? checker
                  .getExportsOfModule(module)
                  .map((symbol) => [symbol.getName(), unalias(symbol)])
            : [],
    );
    // `app.provide()` is the other half of the pair: a method on Vue's `App`
    // rather than the free function, and the form every provide in this package
    // actually uses.
    const appProvide = surface.get('App')?.members?.get(ts.escapeLeadingUnderscores('provide'));
    for (const declaration of [
        ...declarationsOf(surface.get('provide')),
        ...declarationsOf(surface.get('inject')),
        ...declarationsOf(appProvide),
    ])
        VUE.calls.add(declaration);
    for (const declaration of declarationsOf(surface.get('InjectionKey')))
        VUE.injectionKey.add(declaration);
    VUE.found = {
        provide: declarationsOf(surface.get('provide')).length,
        inject: declarationsOf(surface.get('inject')).length,
        'App.provide': declarationsOf(appProvide).length,
        InjectionKey: VUE.injectionKey.size,
    };
}

/* -------------------------------------------------------------------------
 * Reading one tree
 * ---------------------------------------------------------------------- */

/** The `X` of `X(…)` and of `a.b.X(…)`, or null for anything computed. */
function calleeName(expression) {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return null;
}

const PROVIDE_AND_INJECT = ['provide', 'inject'];

/**
 * The local names in one file that may mean Vue's `provide`/`inject`.
 *
 * `import { provide as vueProvide } from 'vue'` is a rename, not a disguise:
 * `vueProvide(LOCAL_KEY, …)` provides, so it is a call site, and a scan that
 * only knew the two original spellings would let the key it names out of both
 * derivations at once. This decides which calls are worth asking the checker
 * about; the checker decides whether the answer really is Vue's.
 */
function localNamesOf(file) {
    const names = new Set(PROVIDE_AND_INJECT);
    for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (PROVIDE_AND_INJECT.includes(imported)) names.add(element.name.text);
        }
    }
    return names;
}

/** The expression a declarator really assigns, past grouping and assertions. */
function valueOf(declaration) {
    let expression = declaration.initializer;
    while (
        expression &&
        (ts.isParenthesizedExpression(expression) ||
            ts.isNonNullExpression(expression) ||
            ts.isAsExpression(expression) ||
            ts.isSatisfiesExpression(expression))
    )
        expression = expression.expression;
    return expression;
}

/** The types a declarator states outright: its annotation and its assertions. */
function statedTypes(declaration) {
    const nodes = declaration.type ? [declaration.type] : [];
    let expression = declaration.initializer;
    while (expression) {
        if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression)) {
            expression = expression.expression;
            continue;
        }
        if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
            nodes.push(expression.type);
            expression = expression.expression;
            continue;
        }
        break;
    }
    return nodes;
}

/**
 * Whether a written type is Vue's `InjectionKey`, following local type aliases
 * to whatever they stand for.
 *
 * `type AppKey<T> = InjectionKey<T>` is the first of the two shapes issue #158
 * recorded: the name at the declaration is `AppKey`, and a scan comparing names
 * classified such a key as nothing at all. The alias is followed by asking the
 * checker what the name binds to and, where that is another alias, reading its
 * right-hand side — which terminates on `seen`, because `type T = T` is
 * something a source file may contain.
 */
function namesInjectionKey(typeNode, seen = new Set()) {
    let node = typeNode;
    while (node && ts.isParenthesizedTypeNode(node)) node = node.type;
    // A composite names an `InjectionKey` if any constituent does.
    // `Symbol('bad') as InjectionKey<T> & Brand` is still asserted to be one,
    // and a branch that accepted only a reference walked past it — with no
    // local `provide`/`inject` to recover the declaration, the plain symbol
    // then passed the guard entirely.
    if (node && (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node))) {
        return node.types.some((constituent) => namesInjectionKey(constituent, seen));
    }
    const name = !node
        ? null
        : ts.isTypeReferenceNode(node)
          ? node.typeName
          : ts.isImportTypeNode(node)
            ? (node.qualifier ?? null)
            : null;
    if (!name) return false;
    const symbol = unalias(checker.getSymbolAtLocation(name));
    if (!symbol || seen.has(symbol)) return false;
    if (declaredIn(symbol, VUE.injectionKey)) return true;
    seen.add(symbol);
    return declarationsOf(symbol).some(
        (declaration) =>
            ts.isTypeAliasDeclaration(declaration) && namesInjectionKey(declaration.type, seen),
    );
}

/**
 * Whether an initializer is a call to the global `Symbol.for`.
 *
 * Being a call is the whole question: `Symbol.for('decoy') && Symbol('x')`
 * starts with one and evaluates to the local symbol, which is exactly the
 * cross-bundle failure this file exists to prevent. In a tree that question
 * answers itself — a binary expression is not a call — and so does the one
 * about which type assertions may follow, because an assertion is a node
 * wrapped around the value rather than a shape the text has to be matched for.
 *
 * `Symbol` is checked rather than assumed: the callee has to resolve into the
 * standard library, so a local binding that happens to be spelled `Symbol` does
 * not satisfy the rule.
 */
function isGlobalSymbolFor(declaration) {
    const value = valueOf(declaration);
    if (!value || !ts.isCallExpression(value)) return false;
    const callee = value.expression;
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'for') return false;
    return declarationsOf(unalias(checker.getSymbolAtLocation(callee))).some((node) =>
        program.isSourceFileDefaultLibrary(node.getSourceFile()),
    );
}

/**
 * Whether a binding holds a plain string.
 *
 * Vue accepts a string as an injection key, and a string does not acquire a
 * symbol-identity problem by being stored in a constant first — `const KEY =
 * 'local'; provide(KEY, value)` is ordinary, valid code. The call-site
 * derivation reads it as an identifier, so without this it would enter the
 * roster and be told to become a `Symbol.for`: a guard rejecting correct
 * source, which is how a guard gets switched off.
 *
 * A key annotated `: InjectionKey<T>` cannot be one of these — Vue's own type
 * is a branded `symbol` — so only this derivation needs the exemption.
 */
function isStringKey(declaration) {
    const value = valueOf(declaration);
    return Boolean(
        value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)),
    );
}

/**
 * Whether a call is Vue's `provide`/`inject`.
 *
 * A call the checker resolves elsewhere is not one — a `function provide(key,
 * value)` of somebody's own is decided, not waved through. A call it cannot
 * resolve at all still counts, so an unreadable one fails a test below rather
 * than leaving the guard.
 */
function isProvideOrInject(node, localNames) {
    const called = calleeName(node.expression);
    if (!called || !localNames.has(called)) return false;
    const symbol = unalias(checker.getSymbolAtLocation(node.expression));
    return !symbol || declaredIn(symbol, VUE.calls);
}

/** One `provide(…)`/`inject(…)` call, with whatever its first argument is. */
function readSite(unit, file, node) {
    const argument = node.arguments[0];
    const identifier = argument && ts.isIdentifier(argument) ? argument : null;
    return {
        where: `${unit.path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`,
        name: identifier?.text ?? null,
        declarations: identifier
            ? declarationsOf(unalias(checker.getSymbolAtLocation(identifier))).filter(
                  ts.isVariableDeclaration,
              )
            : [],
        // A string key is legal in Vue and simply outside this rule: it has no
        // symbol identity to split in the first place.
        literal: Boolean(
            argument &&
            (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)),
        ),
        excerpt: (argument ? argument.getText(file) : '').slice(0, 40).replace(/\s+/g, ' ').trim(),
    };
}

/**
 * Everything this guard has to say about one set of files.
 *
 * The tree is judged on its own: a declaration reached from a file outside it
 * is reported as unplaceable rather than checked, which is what keeps the
 * counter-check trees below from answering for `src` or for each other.
 */
function inspect(units) {
    const own = new Map(units.map((unit) => [unit.fileName, unit]));
    const anomalies = units
        .filter((unit) => unit.anomalies.length > 0)
        .map((unit) => `${unit.path}: ${unit.anomalies.join('; ')}`);
    const missing = [];
    const located = new Map();
    const keys = new Set();
    const sites = [];
    const mine = (declaration) => own.has(declaration.getSourceFile().fileName);

    const place = (declaration) => {
        if (located.has(declaration)) return located.get(declaration);
        const file = declaration.getSourceFile();
        const unit = own.get(file.fileName);
        const at = unit
            ? {
                  order: [units.indexOf(unit), declaration.pos],
                  where: `${unit.path}:${
                      file.getLineAndCharacterOfPosition(declaration.name.getStart(file)).line + 1
                  } — ${declaration.name.getText(file)}`,
              }
            : null;
        located.set(declaration, at);
        return at;
    };

    for (const unit of units) {
        const file = program.getSourceFile(unit.fileName);
        if (!file) {
            missing.push(unit.path);
            continue;
        }
        const localNames = localNamesOf(file);
        const visit = (node) => {
            if (
                ts.isVariableDeclaration(node) &&
                ts.isIdentifier(node.name) &&
                node.initializer &&
                statedTypes(node).some((typeNode) => namesInjectionKey(typeNode))
            )
                keys.add(node);
            if (ts.isCallExpression(node) && isProvideOrInject(node, localNames))
                sites.push(readSite(unit, file, node));
            ts.forEachChild(node, visit);
        };
        visit(file);
    }

    const byOrder = (left, right) =>
        left.order[0] - right.order[0] || left.order[1] - right.order[1];
    const list = (declarations) =>
        [...new Set(declarations)]
            .map(place)
            .filter(Boolean)
            .sort(byOrder)
            .map(({ where }) => where);

    const used = sites
        .flatMap((site) => site.declarations)
        .filter(mine)
        .filter((declaration) => !isStringKey(declaration));

    return {
        anomalies,
        missing,
        sites,
        keys: list(keys),
        used: list(used),
        loose: list([...keys, ...used].filter((declaration) => !isGlobalSymbolFor(declaration))),
        unannounced: list(used.filter((declaration) => !keys.has(declaration))),
        unplaceable: sites
            .filter((site) => site.name && !site.declarations.some(mine))
            .map((site) => `${site.where} — ${site.name}`),
        unread: sites
            .filter((site) => !site.name && !site.literal)
            .map((site) => `${site.where} — provide/inject(${site.excerpt}…`),
    };
}

/* -------------------------------------------------------------------------
 * The second derivation
 * ---------------------------------------------------------------------- */

const OPENERS = new Set([
    ts.SyntaxKind.OpenParenToken,
    ts.SyntaxKind.OpenBracketToken,
    ts.SyntaxKind.OpenBraceToken,
]);
const CLOSERS = new Set([
    ts.SyntaxKind.CloseParenToken,
    ts.SyntaxKind.CloseBracketToken,
    ts.SyntaxKind.CloseBraceToken,
]);

/**
 * How many declarators spell out `const NAME: InjectionKey<`, counted straight
 * from the token stream so that this and the tree walk above can disagree.
 *
 * The tokeniser is a different tool from the parser — no tree, no scopes, no
 * types — which is the point: a reader that stopped finding declarations would
 * otherwise shrink the guard in silence, and nothing else would notice. The
 * cross-check above catches a key that also has a call site; a key declared
 * here and injected only by a consumer app has none, and then this count is all
 * that is left.
 *
 * Further declarators of one statement are counted too, recognised by a `,`
 * outside every bracket — which is what a declarator separator is, and what a
 * comma in an argument list, an object literal or an object type is not. The
 * keyword is `const` alone although the reader accepts `let` and `var`: `const`
 * is the one that cannot stand without a value, and the reader passes over a
 * declarator that has none.
 *
 * The template handling is not decoration. A scanner reads `` `${a}${b}` `` as
 * a head and then has to be told that the `}` closing a substitution is a
 * template token again; without that it takes the following backtick for the
 * start of a new string and loses the rest of the file. Two of this package's
 * keys sit behind such a template, and this count reported 12 of 14 until the
 * rescan was added.
 */
function writtenAnnotations(text) {
    const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        true,
        ts.LanguageVariant.Standard,
        text,
    );
    const starts = (token) =>
        token.kind === ts.SyntaxKind.ConstKeyword ||
        (token.kind === ts.SyntaxKind.CommaToken && token.depth === 0);
    /** Bracket depth each open template substitution sits at. */
    const templates = [];
    let total = 0;
    let depth = 0;
    let window = [];
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
        if (kind === ts.SyntaxKind.CloseBraceToken && templates.at(-1) === depth) {
            kind = scanner.reScanTemplateToken(false);
            if (kind === ts.SyntaxKind.TemplateTail) templates.pop();
        } else if (OPENERS.has(kind)) depth += 1;
        else if (CLOSERS.has(kind)) depth -= 1;
        if (kind === ts.SyntaxKind.TemplateHead) templates.push(depth);
        if (
            kind === ts.SyntaxKind.LessThanToken &&
            window.length === 4 &&
            starts(window[0]) &&
            window[1].kind === ts.SyntaxKind.Identifier &&
            window[2].kind === ts.SyntaxKind.ColonToken &&
            window[3].kind === ts.SyntaxKind.Identifier &&
            window[3].text === 'InjectionKey'
        )
            total += 1;
        window = [...window, { kind, depth, text: scanner.getTokenText() }].slice(-4);
    }
    return total;
}

/* -------------------------------------------------------------------------
 * The counter-check trees
 *
 * Each one is a state this guard has to fail on, kept as source so the failure
 * is re-proved on every run rather than once by hand. Where a tree holds a
 * sound declaration beside a broken one, the assertion names only the broken
 * one — which is the repaired half of the same counter-check.
 * ---------------------------------------------------------------------- */

// Two lines, so the first line of every tree written against it is line 3.
const HEAD = "import { provide, inject } from 'vue';\nimport type { InjectionKey } from 'vue';";

const annotated = counterCheck('annotated', {
    'keys.ts': `${HEAD}
export const SOUND: InjectionKey<number> = Symbol.for('saasicat/nest/Sound');
export const LOOSE: InjectionKey<number> = Symbol('loose');
provide(SOUND, 1);
provide(LOOSE, 1);
inject(SOUND);
`,
});

const typeAlias = counterCheck('type-alias', {
    'keys.ts': `${HEAD}
type AppKey<T> = InjectionKey<T>;
type DeepKey<T> = AppKey<T>;
type Cyclic<T> = Cyclic<T>;
export const SOUND: AppKey<number> = Symbol.for('saasicat/nest/Sound');
export const ALIASED: AppKey<number> = Symbol('loose');
export const NESTED: DeepKey<number> = Symbol('loose');
export const UNRELATED: Cyclic<number> = 1 as never;
`,
});

const scopes = counterCheck('scopes', {
    'keys.ts': `${HEAD}
export function unrelated() {
    const KEY = 123;
    return KEY;
}
export function real() {
    const KEY: InjectionKey<number> = Symbol('loose');
    provide(KEY, 1);
}
export function sound() {
    const KEY: InjectionKey<number> = Symbol.for('saasicat/nest/Sound');
    provide(KEY, 1);
}
`,
});

const castAndSatisfies = counterCheck('cast-and-satisfies', {
    'keys.ts': `${HEAD}
export const CAST = Symbol('loose') as InjectionKey<number>;
export const SATISFIES = Symbol('loose') satisfies InjectionKey<number>;
export const SOUND_CAST = Symbol.for('saasicat/nest/A') as InjectionKey<number>;
export const SOUND_SATISFIES = Symbol.for('saasicat/nest/B') satisfies InjectionKey<number>;
`,
});

const composite = counterCheck('composite', {
    'keys.ts': `${HEAD}
type Brand = { readonly tag: 'brand' };
export const BRANDED = Symbol('loose') as InjectionKey<number> & Brand;
export const EITHER = Symbol('loose') as InjectionKey<number> | undefined;
export const SOUND_BRANDED = Symbol.for('saasicat/nest/Branded') as InjectionKey<number> & Brand;
`,
});

const declarators = counterCheck('declarators', {
    'keys.ts': `${HEAD}
export const FIRST: InjectionKey<number> = Symbol.for('saasicat/nest/First'),
    CHAINED: InjectionKey<number> = Symbol('loose');
const sizes = new Map<string, { a: 1 }>(),
    AFTER_TYPE_ARGUMENTS: InjectionKey<number> = Symbol('loose');
provide(AFTER_TYPE_ARGUMENTS, sizes.size);
`,
});

const sfc = counterCheck('sfc', {
    'Page.vue': `<template>
    <div>const TEMPLATE_TEXT: InjectionKey<number> = Symbol('not code')</div>
</template>

<script setup lang="ts">
import { inject } from 'vue';
import type { InjectionKey } from 'vue';
const IN_SFC: InjectionKey<number> = Symbol('loose');
inject(IN_SFC);
</script >
`,
});

const sfcExport = counterCheck('sfc-export', {
    'Widget.vue': `<template><div /></template>

<script lang="ts">
import type { InjectionKey } from 'vue';
export const FROM_SFC: InjectionKey<number> = Symbol('loose');
</script>

<script setup lang="ts">
const label = 'widget';
</script>
`,
    'page.ts': `import { provide } from 'vue';
import { FROM_SFC } from './Widget.vue';
provide(FROM_SFC, 1);
`,
});

const sfcUnclosed = counterCheck('sfc-unclosed', {
    'Page.vue': `<template><div /></template>

<script setup lang="ts">
const KEY = 1;
`,
});

const aliasedCall = counterCheck('aliased-call', {
    'keys.ts': `${HEAD}
import { provide as provide$, inject as inject$ } from 'vue';
const PROVIDED = Symbol('loose');
const INJECTED = Symbol('loose');
provide$(PROVIDED, 1);
inject$(INJECTED);
`,
});

const barrel = counterCheck('barrel', {
    'leaf.ts': `import type { InjectionKey } from 'vue';
export const STARRED: InjectionKey<number> = Symbol('loose');
`,
    'other.ts': `import type { InjectionKey } from 'vue';
export const RENAMED: InjectionKey<number> = Symbol('loose');
`,
    'index.ts': `export * from './leaf.js';
export { RENAMED as PUBLIC } from './other.js';
`,
    'page.ts': `import { provide } from 'vue';
import { STARRED, PUBLIC } from './index.js';
provide(STARRED, 1);
provide(PUBLIC, 1);
`,
});

const stringKey = counterCheck('string-key', {
    'keys.ts': `${HEAD}
const TEXT = 'saasicat/nest/text';
const SYMBOLIC = Symbol('loose');
provide(TEXT, 1);
provide(SYMBOLIC, 1);
provide('inline', 1);
`,
});

const grouping = counterCheck('grouping', {
    'keys.ts': `${HEAD}
export const GROUPED: InjectionKey<number> = (Symbol('loose'));
export const DECOY: InjectionKey<number> = Symbol.for('saasicat/nest/Decoy') && Symbol('loose');
export const COALESCED: InjectionKey<number> = Symbol.for('saasicat/nest/A') ?? Symbol('loose');
export const TERNARY: InjectionKey<number> = 1 > 0 ? Symbol.for('saasicat/nest/B') : Symbol('x');
export const SOUND: InjectionKey<number> = (Symbol.for('saasicat/nest/Sound'));
export const SOUND_ASSERTED = ((Symbol.for('saasicat/nest/C'))) as InjectionKey<number>;
`,
});

const assertionTails = counterCheck('assertion-tails', {
    'keys.ts': `${HEAD}
interface Left {
    a?: string;
}
interface Right {
    b?: string;
}
export const FUNCTION_TYPE = Symbol.for('saasicat/nest/A') as InjectionKey<() => void>;
export const OBJECT_TYPE = Symbol.for('saasicat/nest/B') as InjectionKey<{ a: string }>;
export const INTERSECTION = Symbol.for('saasicat/nest/C') as InjectionKey<Left & Right>;
export const NON_NULL = Symbol.for('saasicat/nest/D')! as InjectionKey<number>;
export const BROKEN = Symbol('loose') as InjectionKey<() => void>;
`,
});

const computedKey = counterCheck('computed-key', {
    'keys.ts': `${HEAD}
const keys = { THEME: Symbol.for('saasicat/nest/Theme') };
provide(keys.THEME, 1);
inject(keys['THEME']);
`,
});

const outside = counterCheck(
    'outside',
    {
        'page.ts': `${HEAD}
import { ELSEWHERE } from './neighbour.js';
import { MISSING } from './nowhere.js';
provide(ELSEWHERE, 1);
provide(MISSING, 1);
`,
    },
    {
        'neighbour.ts': `import type { InjectionKey } from 'vue';
export const ELSEWHERE: InjectionKey<number> = Symbol('loose');
`,
    },
);

const unannounced = counterCheck('unannounced', {
    'keys.ts': `${HEAD}
const UNTYPED = Symbol.for('saasicat/nest/Untyped');
provide(UNTYPED, 1);
`,
});

const shadowedSymbol = counterCheck('shadowed-symbol', {
    'keys.ts': `${HEAD}
const Symbol = { for: (key: string) => key as unknown as symbol };
export const SHADOWED: InjectionKey<number> = Symbol.for('saasicat/nest/Shadowed');
`,
});

const notCode = counterCheck('not-code', {
    'keys.ts': `${HEAD}
// Documented elsewhere as app.provide(GHOST, value) — a sentence, not a call.
const sentence = "provide(GHOST, 1)";
export const REAL_KEY: InjectionKey<number> = Symbol.for('saasicat/nest/Real');
provide(REAL_KEY, sentence.length);
`,
});

const notVueProvide = counterCheck('not-vue-provide', {
    'keys.ts': `import type { InjectionKey } from 'vue';
export const KEY: InjectionKey<number> = Symbol.for('saasicat/nest/Key');
function provide(name: string, value: number) {
    return \`\${name}:\${value}\`;
}
const loose = Symbol('loose');
export const used = provide(String(loose), 1);
`,
});

start();

const real = inspect(REAL);

/* -------------------------------------------------------------------------
 * The rule, against `src`
 * ---------------------------------------------------------------------- */

describe('every Vue injection key is created with Symbol.for', () => {
    test('the guard found Vue and read every file', () => {
        // Both halves are how a source scan passes by not looking: a `provide`
        // that matches nothing because Vue was never resolved, and a file the
        // program never received because its name was built wrong.
        assert.deepEqual(
            Object.entries(VUE.found)
                .filter(([, count]) => count === 0)
                .map(([name]) => name),
            [],
            "Vue's own declarations of `provide`, `inject`, `App.provide` and `InjectionKey` " +
                'are what this guard matches against. Finding none of one of them means it ' +
                'silently stops recognising that form',
        );
        assert.deepEqual(real.missing, [], 'these files never reached the program');
        assert.deepEqual(
            real.anomalies,
            [],
            'the `.vue` script-block reader lost its place in these files, so everything after ' +
                'that point was blanked and never parsed',
        );
    });

    test('there are keys and call sites to look at', () => {
        assert.ok(
            real.keys.length > 0,
            'no `InjectionKey` declaration found under src — the declaration scan stopped matching',
        );
        assert.ok(
            real.sites.length > 0,
            'no provide()/inject() call was recognised — the call-site scan stopped matching',
        );
        assert.ok(
            real.used.length > 0,
            'no provide()/inject() call resolves to a declaration — name resolution stopped ' +
                'reaching the files the keys are declared in',
        );
    });

    test('every injection key is created with Symbol.for', () => {
        assert.deepEqual(
            real.loose,
            [],
            'A Vue injection key has to be created with `Symbol.for(...)`. This package is ' +
                'loaded twice — pages from `src/`, the bootstrap from `dist/` — and a plain ' +
                '`Symbol()` is a different symbol in each copy, so `inject()` never finds what ' +
                '`provide()` wrote. See `CONTRIBUTING.md`:\n  ' +
                real.loose.join('\n  '),
        );
    });

    test('every key a provide/inject call names is one the declaration scan found', () => {
        // This is what keeps the set above from shrinking in silence. A key
        // that loses its declaration, or whose declaration changes into a shape
        // the reader no longer recognises, is still named at its call sites —
        // and turns up here instead of simply leaving the guard.
        assert.deepEqual(
            real.unplaceable,
            [],
            'These identifiers are handed to provide()/inject() but resolve to no declaration ' +
                'inside this package. Either the declaration was removed, the import resolves to ' +
                'no file, or the key really comes from another package — in which case this ' +
                'guard has to be taught how to reach it, because it cannot check a spelling it ' +
                'never sees:\n  ' +
                real.unplaceable.join('\n  '),
        );
        assert.deepEqual(
            real.unannounced,
            [],
            'These are used as injection keys but are not declared as `InjectionKey<T>`. Vue ' +
                'accepts a bare `symbol` there, so nothing else says what they are — annotate ' +
                'them, so the declaration alone carries the fact:\n  ' +
                real.unannounced.join('\n  '),
        );
    });

    test('every provide/inject call site was read', () => {
        // The set of used keys is only complete while every call site yields
        // one. A key passed as `keys.THEME` or through any other expression
        // would leave no name behind, and the cross-check above would lose a
        // member without noticing.
        assert.deepEqual(
            real.unread,
            [],
            'The first argument of these provide()/inject() calls is neither a bare identifier ' +
                'nor a string literal, so this guard cannot tell which key they use. Pass the ' +
                'key by name:\n  ' +
                real.unread.join('\n  '),
        );
    });

    test('the annotated declarations survive the tree walk', () => {
        const written = REAL.reduce((total, { code }) => total + writtenAnnotations(code), 0);
        assert.ok(written > 0, 'the token scan found no `const NAME: InjectionKey<` under src');
        assert.ok(
            real.keys.length >= written,
            `${written} declarators spell out \`const NAME: InjectionKey<\` under src, but the ` +
                `tree walk found only ${real.keys.length} keys — it lost ` +
                `${written - real.keys.length} of them`,
        );
    });
});

/* -------------------------------------------------------------------------
 * The counter-checks
 *
 * One per shape issue #158 lists as covered, plus the two it recorded as
 * undecidable. Each names exactly what the guard reports for a broken tree, so
 * a reader that no longer fails is a test that no longer passes.
 * ---------------------------------------------------------------------- */

describe('the guard fails on what it says it covers', () => {
    test('an annotated declaration', () => {
        assert.deepEqual(annotated().loose, ['keys.ts:4 — LOOSE']);
    });

    test('an InjectionKey reached through a local type alias (#158, shape 1)', () => {
        // The shape a name comparison could not decide, and there is no
        // `provide`/`inject` here, so the call-site derivation cannot recover
        // it either — the annotation is the only thing that says what it is.
        const report = typeAlias();
        assert.deepEqual(report.loose, ['keys.ts:7 — ALIASED', 'keys.ts:8 — NESTED']);
        // A cyclic alias resolves to nothing rather than to a hang.
        assert.deepEqual(report.keys, [
            'keys.ts:6 — SOUND',
            'keys.ts:7 — ALIASED',
            'keys.ts:8 — NESTED',
        ]);
    });

    test('same-file homonyms stay in their own scope (#158, shape 2)', () => {
        // The unrelated `const KEY = 123` in the neighbouring function must not
        // answer for either call site, and the sound key must not be dragged in
        // by the broken one sharing its name.
        const report = scopes();
        assert.deepEqual(report.loose, ['keys.ts:8 — KEY']);
        assert.deepEqual(report.unplaceable, []);
    });

    test('a cast and a satisfies', () => {
        assert.deepEqual(castAndSatisfies().loose, ['keys.ts:3 — CAST', 'keys.ts:4 — SATISFIES']);
        // A composite still asserts the key is an `InjectionKey`. A branch that
        // accepted only a reference walked past it, and with no local
        // provide/inject to recover the declaration the plain symbol passed the
        // guard entirely — the cross-bundle failure, through an annotation the
        // compiler is perfectly happy with.
        assert.deepEqual(composite().loose, ['keys.ts:4 — BRANDED', 'keys.ts:5 — EITHER']);
    });

    test('a second declarator, and one behind type arguments', () => {
        assert.deepEqual(declarators().loose, [
            'keys.ts:4 — CHAINED',
            'keys.ts:6 — AFTER_TYPE_ARGUMENTS',
        ]);
    });

    test('a .vue script block that closes with `</script >`', () => {
        const report = sfc();
        assert.deepEqual(report.anomalies, []);
        // The line is the line in the `.vue`, and the template text that reads
        // like a declaration is not one.
        assert.deepEqual(report.loose, ['Page.vue:8 — IN_SFC']);
    });

    test('a key exported from a .vue and provided from a .ts', () => {
        // `./Widget.vue` reaches the file the guard renamed to `Widget.vue.ts`,
        // so a key crossing that boundary is judged rather than reported as
        // unreachable.
        const report = sfcExport();
        assert.deepEqual(report.unplaceable, []);
        assert.deepEqual(report.loose, ['Widget.vue:5 — FROM_SFC']);
    });

    test('a .vue script block that never closes', () => {
        assert.deepEqual(sfcUnclosed().anomalies, [
            'Page.vue: <script> opened at line 3 is never closed',
        ]);
    });

    test('provide and inject imported under another name', () => {
        const report = aliasedCall();
        assert.deepEqual(report.unannounced, ['keys.ts:4 — PROVIDED', 'keys.ts:5 — INJECTED']);
        assert.deepEqual(report.loose, ['keys.ts:4 — PROVIDED', 'keys.ts:5 — INJECTED']);
    });

    test('a key imported through `export *` and through `export { … } from`', () => {
        const report = barrel();
        assert.deepEqual(report.loose, ['leaf.ts:2 — STARRED', 'other.ts:2 — RENAMED']);
        assert.deepEqual(report.unplaceable, []);
    });

    test('a string key is a key, and not a missing Symbol.for', () => {
        // `const KEY = 'local'; provide(KEY, value)` is valid Vue, and the
        // symbol beside it in the same file still has to obey the rule.
        const report = stringKey();
        assert.deepEqual(report.loose, ['keys.ts:4 — SYMBOLIC']);
        assert.deepEqual(report.unread, []);
    });

    test('grouping is grouping, and a decoy is not a Symbol.for', () => {
        assert.deepEqual(grouping().loose, [
            'keys.ts:3 — GROUPED',
            'keys.ts:4 — DECOY',
            'keys.ts:5 — COALESCED',
            'keys.ts:6 — TERNARY',
        ]);
    });

    test('an assertion may contain what a type contains', () => {
        assert.deepEqual(assertionTails().loose, ['keys.ts:13 — BROKEN']);
    });

    test('a key reached through a property is reported, not skipped', () => {
        assert.deepEqual(computedKey().unread, [
            'keys.ts:4 — provide/inject(keys.THEME…',
            "keys.ts:5 — provide/inject(keys['THEME']…",
        ]);
    });

    test('a key declared outside the tree is reported, not skipped', () => {
        assert.deepEqual(outside().unplaceable, ['page.ts:5 — ELSEWHERE', 'page.ts:6 — MISSING']);
    });

    test('a used key that is not declared as an InjectionKey', () => {
        const report = unannounced();
        assert.deepEqual(report.unannounced, ['keys.ts:3 — UNTYPED']);
        assert.deepEqual(report.loose, []);
    });

    test('a local binding spelled Symbol is not the global Symbol', () => {
        assert.deepEqual(shadowedSymbol().loose, ['keys.ts:4 — SHADOWED']);
    });

    test('a comment and a string are not call sites', () => {
        const report = notCode();
        assert.deepEqual(report.loose, []);
        assert.deepEqual(report.unplaceable, []);
        assert.deepEqual(report.unread, []);
    });

    test("somebody else's provide is not Vue's", () => {
        // The other direction: a guard that fires on unrelated code is a guard
        // somebody switches off. `provide(String(loose), 1)` would be an
        // unreadable call site if this local function were mistaken for Vue's.
        const report = notVueProvide();
        assert.deepEqual(report.unread, []);
        assert.deepEqual(report.unplaceable, []);
        assert.deepEqual(report.loose, []);
    });

    test('the token count is a second reader, not the same one', () => {
        // Counter-check for the floor itself: it has to see a chained
        // declarator and survive a substituting template, and it has to stay
        // blind to the shapes that are not declarations at all.
        assert.equal(writtenAnnotations('const A: InjectionKey<number> = Symbol.for("a");'), 1);
        assert.equal(
            writtenAnnotations('const A: InjectionKey<1> = x, B: InjectionKey<2> = y;'),
            2,
        );
        assert.equal(
            writtenAnnotations('const k = `${a}${b}`;\nconst A: InjectionKey<number> = x;'),
            1,
        );
        assert.equal(writtenAnnotations('const m = f(a, b: InjectionKey<1>);'), 0);
        assert.equal(writtenAnnotations('interface X { key: InjectionKey<number> }'), 0);
        assert.equal(writtenAnnotations('function f(key: InjectionKey<number>) {}'), 0);
        assert.equal(writtenAnnotations('// const A: InjectionKey<number> = 1;'), 0);
        assert.equal(writtenAnnotations('const s = "const A: InjectionKey<number> = 1";'), 0);
    });
});
