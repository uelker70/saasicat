// Documentation drifts one sentence at a time, and prose has no compiler.
//
// The repository already breaks the build on three kinds of drift — generated
// types against their schemas (`codegen-drift`), the reference SQL against the
// Prisma fragments (`reference-sql-drift`), and version pins in docs
// (`docs-version-pins`). This file extends that to the claims documentation
// makes about the code: package enumerations, option names, import paths and
// the spec version.
//
// Each check derives its expectation from the sources. A hand-written list of
// "the packages we have" in a test would be the same defect one level up.

// @requirement SC-READ-007 — Reference documentation is generated from the implementation

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Documentation a stranger reads: the entry points plus everything under docs/. */
export function docFiles() {
    const files = ['README.md', 'CONTRIBUTING.md'];

    const walk = (dir) => {
        for (const entry of readdirSync(join(ROOT, dir))) {
            const path = join(dir, entry);
            if (statSync(join(ROOT, path)).isDirectory()) walk(path);
            else if (entry.endsWith('.md')) files.push(path);
        }
    };
    walk('docs');

    for (const dir of readdirSync(join(ROOT, 'packages'))) {
        const readme = join('packages', dir, 'README.md');
        try {
            statSync(join(ROOT, readme));
            files.push(readme);
        } catch {
            // A package without a README is 6.6's problem, not this file's.
        }
    }
    return files;
}

/** The names npm carries. `private: true` never leaves the repository. */
export function publishedPackages() {
    const names = [];
    for (const dir of readdirSync(join(ROOT, 'packages'))) {
        const manifest = JSON.parse(
            readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'),
        );
        if (!manifest.private) names.push(manifest.name);
    }
    return names.sort();
}

const PACKAGE_NAME = /^(?:@saasicat\/[a-z-]+|create-saasicat-admin|saasicat)$/;

/**
 * The package names a Markdown table lists in its first column.
 *
 * A table that names three or more of them is read as the package set — a
 * reader counts its rows and believes the number. Two or fewer is an excerpt
 * or a comparison, and says so by its size.
 */
export function packageEnumerations(text) {
    const enumerations = [];
    let current = null;

    const close = () => {
        if (current && current.length >= 3) enumerations.push(current);
        current = null;
    };

    for (const line of text.split('\n')) {
        if (!line.trim().startsWith('|')) {
            close();
            continue;
        }
        if (current === null) current = [];
        const first = line.split('|')[1]?.trim() ?? '';
        const name = first.startsWith('`') && first.endsWith('`') ? first.slice(1, -1) : null;
        if (name && PACKAGE_NAME.test(name)) current.push(name);
    }
    close();

    return enumerations;
}

const NUMBER_WORDS = {
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
};
/**
 * Every "<n> packages" a text claims, as numbers.
 *
 * A word scan rather than a pattern: the counts come from a table, and a
 * pattern assembled from its keys is exactly the "text becomes a regex" the
 * repository forbids. Splitting on non-word characters has one quantifier and
 * cannot backtrack.
 *
 * Counts below three are prose ("into one package", "either of two packages"),
 * not a claim about the set. The defect this catches said "The Five Packages"
 * while the repository had ten.
 */
export function packageCountClaims(text) {
    const words = text.toLowerCase().split(/\s+/);
    const claims = [];
    for (let i = 1; i < words.length; i += 1) {
        // `packages,` counts, `packages/` is a path and `64.` ended a sentence
        // before the next one started with the word.
        if (!PLURAL.test(words[i])) continue;
        const previous = words[i - 1].replace(LEADING_MARKUP, '');
        if (!BARE_WORD.test(previous)) continue;
        const value = previous in NUMBER_WORDS ? NUMBER_WORDS[previous] : Number(previous);
        if (Number.isInteger(value) && value >= 3) claims.push(value);
    }
    return claims;
}

const PLURAL = /^packages[.,:;!?)*`'"]*$/;
const LEADING_MARKUP = /^[(*`'"]+/;
const BARE_WORD = /^[a-z0-9]+$/;

describe('documentation matches the packages that exist', () => {
    const files = docFiles();
    const published = publishedPackages();

    test('the sweep reaches the documentation it claims to check', () => {
        // Every assertion below is vacuously true on an empty list.
        assert.ok(files.includes('README.md'), 'README.md missing from the sweep');
        assert.ok(
            files.some((file) => file.startsWith(`docs${sep}`)),
            'no file under docs/ reached the sweep',
        );
        assert.ok(published.length >= 10, `only ${published.length} published packages found`);
        const enumerations = files.flatMap((file) =>
            packageEnumerations(readFileSync(join(ROOT, file), 'utf8')),
        );
        assert.ok(
            enumerations.length > 0,
            'no package enumeration found — the check reads nothing',
        );
    });

    test('every table that enumerates the packages lists all of them', () => {
        const offenders = [];
        for (const file of files) {
            for (const listed of packageEnumerations(readFileSync(join(ROOT, file), 'utf8'))) {
                const missing = published.filter((name) => !listed.includes(name));
                const unknown = listed.filter((name) => !published.includes(name));
                if (missing.length || unknown.length) {
                    offenders.push(
                        `${file}: lists ${listed.length} of ${published.length}` +
                            (missing.length ? `, missing ${missing.join(', ')}` : '') +
                            (unknown.length ? `, unknown ${unknown.join(', ')}` : ''),
                    );
                }
            }
        }
        assert.deepEqual(
            offenders,
            [],
            `A table of packages is read as the complete set.\n${offenders.join('\n')}`,
        );
    });

    test('no text claims a package count the repository does not have', () => {
        const offenders = [];
        for (const file of files) {
            for (const claimed of packageCountClaims(readFileSync(join(ROOT, file), 'utf8'))) {
                if (claimed !== published.length) {
                    offenders.push(`${file}: claims ${claimed}, there are ${published.length}`);
                }
            }
        }
        assert.deepEqual(offenders, [], offenders.join('\n'));
    });
});

/* --------------------------------------------------------------------------
 * Code blocks: import paths and option objects
 *
 * A snippet is the part of documentation a reader copies, so it is the part
 * that has to be true. Both checks below read the PUBLISHED surface — the
 * `types` target of each entry in the package's export map — rather than the
 * sources: an option that exists in `src` but never leaves the build is not an
 * option a reader has.
 * ----------------------------------------------------------------------- */

/** Fenced TypeScript blocks, with the line the fence opened on. */
export function typeScriptBlocks(text) {
    const blocks = [];
    const lines = text.split('\n');
    let open = null;
    let buffer = [];
    for (const [index, line] of lines.entries()) {
        const fence = line.trimEnd();
        if (open === null) {
            if (fence === '```ts' || fence === '```typescript') {
                open = index + 1;
                buffer = [];
            }
        } else if (fence === '```') {
            blocks.push({ line: open, code: buffer.join('\n') });
            open = null;
        } else {
            buffer.push(line);
        }
    }
    return blocks;
}

const SCOPE = '@saasicat/';

/** The package a specifier names, and the subpath under it. */
export function splitSpecifier(specifier) {
    if (!specifier.startsWith(SCOPE)) return null;
    const [name, ...rest] = specifier.slice(SCOPE.length).split('/');
    return { pkg: `${SCOPE}${name}`, subpath: rest.length ? `./${rest.join('/')}` : '.' };
}

/** Whether an export map answers a subpath, wildcards included. */
export function exportsSubpath(exportsField, subpath) {
    for (const key of Object.keys(exportsField)) {
        if (key === subpath) return true;
        const star = key.indexOf('*');
        if (star === -1) continue;
        const prefix = key.slice(0, star);
        const suffix = key.slice(star + 1);
        if (
            subpath.length >= prefix.length + suffix.length &&
            subpath.startsWith(prefix) &&
            subpath.endsWith(suffix)
        ) {
            return true;
        }
    }
    return false;
}

function packageManifests() {
    const manifests = new Map();
    for (const dir of readdirSync(join(ROOT, 'packages'))) {
        const manifest = JSON.parse(
            readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'),
        );
        manifests.set(manifest.name, { dir: join(ROOT, 'packages', dir), manifest });
    }
    return manifests;
}

/**
 * The `.d.ts` a consumer reaches through a specifier, or null when the export
 * map has no `types` for it.
 */
export function declarationFor(manifests, specifier) {
    const split = splitSpecifier(specifier);
    if (!split) return null;
    const entry = manifests.get(split.pkg);
    if (!entry?.manifest.exports) return null;

    const condition = entry.manifest.exports[split.subpath];
    const types = typesTarget(condition);
    if (!types) return null;
    return join(entry.dir, types.startsWith('./') ? types.slice(2) : types);
}

function typesTarget(node) {
    if (!node || typeof node === 'string') return null;
    if (typeof node.types === 'string') return node.types;
    for (const value of Object.values(node)) {
        const nested = typesTarget(value);
        if (nested) return nested;
    }
    return null;
}

/**
 * Follows a name through the built declarations to where it is declared.
 *
 * tsup splits shared code into chunks and renames on the way out, so the entry
 * a reader imports says `export { g as defineSaaSiCat } from '../chunk.js'`,
 * the chunk says `export { defineSaaSiCat as g }`, and the option type it
 * mentions arrives from a third file as `import { e as SaaSiCatModuleOptions }`.
 * Following those hops is what makes this check read the surface a consumer
 * actually gets, rather than the sources it was built from.
 */
export function findDeclaration(file, name, seen = new Set()) {
    const visited = `${file}#${name}`;
    if (seen.has(visited)) return null;
    seen.add(visited);

    const source = parseDeclarationFile(file);

    for (const statement of source.statements) {
        if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
        if (!ts.isNamedExports(statement.exportClause)) continue;
        for (const element of statement.exportClause.elements) {
            if (element.name.text !== name) continue;
            const local = element.propertyName?.text ?? element.name.text;
            if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
                const next = neighbouringDeclaration(file, statement.moduleSpecifier.text);
                const found = next && findDeclaration(next, local, seen);
                if (found) return found;
            } else {
                const found = localDeclaration(source, local);
                if (found) return { node: found, source, file };
            }
        }
    }

    const direct = localDeclaration(source, name);
    if (direct) return { node: direct, source, file };

    const imported = importedFrom(source, file, name);
    if (imported) {
        const found = findDeclaration(imported.file, imported.name, seen);
        if (found) return found;
    }

    for (const statement of source.statements) {
        if (
            ts.isExportDeclaration(statement) &&
            !statement.exportClause &&
            statement.moduleSpecifier &&
            ts.isStringLiteral(statement.moduleSpecifier)
        ) {
            const next = neighbouringDeclaration(file, statement.moduleSpecifier.text);
            const found = next && findDeclaration(next, name, seen);
            if (found) return found;
        }
    }

    return null;
}

const PARSED = new Map();

function parseDeclarationFile(file) {
    let source = PARSED.get(file);
    if (!source) {
        source = ts.createSourceFile(
            file,
            readFileSync(file, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
        );
        PARSED.set(file, source);
    }
    return source;
}

/** `../chunk.js` next to a `.d.ts` is `../chunk.d.ts` on disk. */
function neighbouringDeclaration(from, specifier) {
    if (!specifier.startsWith('.')) return null;
    const withoutExtension = specifier.endsWith('.js') ? specifier.slice(0, -3) : specifier;
    for (const candidate of [`${withoutExtension}.d.ts`, join(withoutExtension, 'index.d.ts')]) {
        const path = join(dirname(from), candidate);
        if (existsSync(path)) return path;
    }
    return null;
}

/** Where a name a file uses but does not declare comes from. */
function importedFrom(source, file, name) {
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
        }
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
            if (element.name.text !== name) continue;
            const next = neighbouringDeclaration(file, statement.moduleSpecifier.text);
            if (next) return { file: next, name: element.propertyName?.text ?? name };
        }
    }
    return null;
}

function localDeclaration(source, name) {
    let found = null;
    const visit = (node) => {
        if (found) return;
        if (
            (ts.isFunctionDeclaration(node) ||
                ts.isClassDeclaration(node) ||
                ts.isInterfaceDeclaration(node) ||
                ts.isTypeAliasDeclaration(node)) &&
            node.name?.text === name
        ) {
            found = node;
        } else if (ts.isVariableStatement(node)) {
            for (const declaration of node.declarationList.declarations) {
                if (declaration.name.getText() === name) found = declaration;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

/**
 * The members of the option type a factory takes, read from its declaration.
 *
 * Returns `{ all, required }` or throws — a factory whose options cannot be
 * resolved is reported, never skipped. Silence here would mean the one call a
 * reader copies is the one nobody checked.
 */
export function optionMembers(entryDeclaration, callee) {
    const [head, method] = callee.split('.');
    const declaration = findDeclaration(entryDeclaration, head);
    if (!declaration) throw new Error(`no declaration of ${head} in ${entryDeclaration}`);

    const { node, source, file } = declaration;
    let parameterType = null;
    let typeParameters = [];

    if (method) {
        if (!ts.isClassDeclaration(node)) throw new Error(`${head} is not a class in ${file}`);
        for (const element of node.members) {
            if (
                (ts.isMethodDeclaration(element) || ts.isMethodSignature(element)) &&
                element.name.getText() === method
            ) {
                parameterType = element.parameters[0]?.type ?? null;
                typeParameters = element.typeParameters ?? [];
            }
        }
    } else if (ts.isFunctionDeclaration(node)) {
        parameterType = node.parameters[0]?.type ?? null;
        typeParameters = node.typeParameters ?? [];
    } else if (ts.isVariableDeclaration(node) && node.type && ts.isFunctionTypeNode(node.type)) {
        parameterType = node.type.parameters[0]?.type ?? null;
        typeParameters = node.type.typeParameters ?? [];
    }

    if (!parameterType) throw new Error(`${callee} takes no typed options in ${file}`);
    return membersOf({ source, file }, parameterType, typeParameters);
}

/**
 * Collects property names from a type node, following references, generic
 * constraints, intersections and the chunk boundaries between them.
 */
function membersOf(context, typeNode, typeParameters = [], seen = new Set()) {
    const all = new Set();
    const required = new Set();

    const merge = (nested) => {
        for (const name of nested.all) all.add(name);
        for (const name of nested.required) required.add(name);
    };

    const collect = (members) => {
        for (const property of members) {
            if (!ts.isPropertySignature(property)) continue;
            const name = property.name.getText();
            all.add(name);
            if (!property.questionToken) required.add(name);
        }
    };

    if (ts.isTypeLiteralNode(typeNode)) {
        collect(typeNode.members);
        return { all, required };
    }

    if (ts.isIntersectionTypeNode(typeNode)) {
        for (const part of typeNode.types) merge(membersOf(context, part, typeParameters, seen));
        return { all, required };
    }

    const referenced = referencedTypeName(typeNode);
    if (referenced === null) {
        throw new Error(
            `unsupported option type ${ts.SyntaxKind[typeNode.kind]} in ${context.file}`,
        );
    }

    if (seen.has(`${context.file}#${referenced}`)) return { all, required };
    seen.add(`${context.file}#${referenced}`);

    const parameter = typeParameters.find((candidate) => candidate.name.text === referenced);
    if (parameter?.constraint) {
        return membersOf(context, parameter.constraint, typeParameters, seen);
    }

    const declaration = findDeclaration(context.file, referenced);
    if (!declaration) throw new Error(`cannot resolve type ${referenced} in ${context.file}`);

    const next = { source: declaration.source, file: declaration.file };
    if (ts.isInterfaceDeclaration(declaration.node)) {
        collect(declaration.node.members);
        for (const clause of declaration.node.heritageClauses ?? []) {
            for (const type of clause.types) merge(membersOf(next, type, [], seen));
        }
        return { all, required };
    }
    if (ts.isTypeAliasDeclaration(declaration.node)) {
        return membersOf(next, declaration.node.type, [], seen);
    }
    throw new Error(`${referenced} is not a type in ${declaration.file}`);
}

/** The name a type reference points at, or null when the node is not one. */
function referencedTypeName(typeNode) {
    if (ts.isTypeReferenceNode(typeNode)) return typeNode.typeName.getText();
    if (ts.isExpressionWithTypeArguments(typeNode) && ts.isIdentifier(typeNode.expression)) {
        return typeNode.expression.text;
    }
    return null;
}

/** Specifiers a block imports from, without a pattern: `from '` to the next quote. */
export function importedSpecifiers(code) {
    const found = [];
    for (const line of code.split('\n')) {
        for (const marker of ["from '", "import('", "require('"]) {
            let at = line.indexOf(marker);
            while (at !== -1) {
                const start = at + marker.length;
                const end = line.indexOf("'", start);
                if (end !== -1) found.push(line.slice(start, end));
                at = line.indexOf(marker, start);
            }
        }
    }
    return found;
}

/**
 * Calls of an imported SaaSiCat symbol with a single object literal, with the
 * keys they pass and whether the literal admits to being partial.
 *
 * A snippet showing one option among many is not wrong for omitting the rest —
 * but it has to say so, with an ellipsis comment inside the braces, exactly
 * where a reader is deciding whether the example is complete.
 */
export function optionCalls(code) {
    const source = ts.createSourceFile('block.ts', code, ts.ScriptTarget.Latest, true);
    const origin = new Map();
    const calls = [];

    const visit = (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = node.importClause;
            if (clause?.name) origin.set(clause.name.text, node.moduleSpecifier.text);
            if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
                for (const element of clause.namedBindings.elements) {
                    origin.set(element.name.text, node.moduleSpecifier.text);
                }
            }
        }

        if (ts.isCallExpression(node) && node.arguments.length === 1) {
            const [argument] = node.arguments;
            const callee = ts.isIdentifier(node.expression)
                ? node.expression.text
                : ts.isPropertyAccessExpression(node.expression) &&
                    ts.isIdentifier(node.expression.expression)
                  ? `${node.expression.expression.text}.${node.expression.name.text}`
                  : null;
            const specifier = callee ? origin.get(callee.split('.')[0]) : undefined;
            if (callee && specifier?.startsWith(SCOPE) && ts.isObjectLiteralExpression(argument)) {
                const literal = argument.getText();
                calls.push({
                    callee,
                    specifier,
                    keys: argument.properties
                        .filter((property) => property.name)
                        .map((property) => property.name.getText()),
                    partial: literal.includes('…') || literal.includes('...'),
                });
            }
        }

        ts.forEachChild(node, visit);
    };
    visit(source);
    return calls;
}

describe('code blocks in the documentation use the API that exists', () => {
    const manifests = packageManifests();
    const blocks = docFiles().flatMap((file) =>
        typeScriptBlocks(readFileSync(join(ROOT, file), 'utf8')).map((block) => ({
            ...block,
            file,
        })),
    );

    test('the sweep finds the blocks it claims to read', () => {
        // Vacuously true on an empty list, and a fence style changes silently.
        assert.ok(blocks.length > 30, `only ${blocks.length} TypeScript blocks found`);
        const specifiers = blocks.flatMap((block) => importedSpecifiers(block.code));
        assert.ok(
            specifiers.filter((specifier) => specifier.startsWith(SCOPE)).length > 20,
            'almost no SaaSiCat imports found — the extraction reads nothing',
        );
        assert.ok(
            blocks.flatMap((block) => optionCalls(block.code)).length > 5,
            'no option call found — the extraction reads nothing',
        );
    });

    test('every documented import resolves through the export map', () => {
        const offenders = [];
        for (const block of blocks) {
            for (const specifier of importedSpecifiers(block.code)) {
                const split = splitSpecifier(specifier);
                if (!split) continue;
                const entry = manifests.get(split.pkg);
                if (!entry) {
                    offenders.push(`${block.file}:${block.line}: no package ${split.pkg}`);
                } else if (!exportsSubpath(entry.manifest.exports ?? {}, split.subpath)) {
                    offenders.push(`${block.file}:${block.line}: ${specifier} is not exported`);
                }
            }
        }
        assert.deepEqual(offenders, [], offenders.join('\n'));
    });

    test('every documented option exists, and a complete example passes the required ones', () => {
        const offenders = [];
        for (const block of blocks) {
            for (const call of optionCalls(block.code)) {
                const declaration = declarationFor(manifests, call.specifier);
                if (!declaration) {
                    offenders.push(
                        `${block.file}:${block.line}: ${call.specifier} has no types target`,
                    );
                    continue;
                }
                const { all, required } = optionMembers(declaration, call.callee);
                const unknown = call.keys.filter((key) => !all.has(key));
                if (unknown.length) {
                    offenders.push(
                        `${block.file}:${block.line}: ${call.callee}({ ${unknown.join(', ')} }) — no such option`,
                    );
                }
                if (!call.partial) {
                    const missing = [...required].filter((key) => !call.keys.includes(key));
                    if (missing.length) {
                        offenders.push(
                            `${block.file}:${block.line}: ${call.callee} is missing required ` +
                                `${missing.join(', ')} — add them, or mark the example partial with an ellipsis comment`,
                        );
                    }
                }
            }
        }
        assert.deepEqual(offenders, [], offenders.join('\n'));
    });
});
