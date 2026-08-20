// Adding `SaaSiCatModule.forRoot(...)` to an existing `app.module.ts`.
//
// The generated files are the easy half. The one an integrator gets wrong is
// this one: the module has to be imported, the filter has to be registered,
// and both go into a decorator that already has content. Copying a block out
// of a markdown file into the right array is exactly the step that produces a
// half-wired application which boots and enforces nothing.
//
// Deliberately textual rather than a TypeScript codemod. This runs on a file
// the generator did not write, in a project whose formatting is not ours, and
// a parse-and-print pass would reformat the whole file to make one insertion.
// The cost is that it declines more often — and declining loudly, with the
// exact block to paste, is a better failure than a rewritten file.

export interface PatchAppModuleOptions {
    /** Import specifier for the persistence bundle, or null when not generated. */
    persistenceImport: string | null;
    /** The app's admin module class and the file it lives in. */
    adminModule: { className: string; importPath: string };
    /** Quota provider classes and where they came from. */
    quotaProviders: ReadonlyArray<{ className: string; importPath: string }>;
    /** The feature-UI registry constant and its file. */
    registry: { constName: string; importPath: string };
}

export interface PatchResult {
    /** The patched source, or the input unchanged when nothing was done. */
    readonly source: string;
    /** What happened, for the command to print. */
    readonly status: 'patched' | 'already-wired' | 'declined';
    /** Why it declined, and what to do instead. Empty otherwise. */
    readonly reason: string;
    /** The block to paste by hand when it declined. */
    readonly manualBlock: string;
}

const MARKER = 'SaaSiCatModule.forRoot';

/**
 * Adds the platform to an `@Module({ imports: [...] })` decorator.
 *
 * Returns `declined` rather than guessing when the shape is not the one this
 * can edit safely: no `@Module`, no `imports` array, or a file that already
 * mentions the marker.
 */
export function patchAppModule(source: string, options: PatchAppModuleOptions): PatchResult {
    const block = renderForRootBlock(options);
    const manualBlock = `${renderImports(options)}\n\n${block}`;

    if (source.includes(MARKER)) {
        return {
            source,
            status: 'already-wired',
            reason: '',
            manualBlock: '',
        };
    }

    const importsArray = findImportsArray(source);
    if (!importsArray) {
        return {
            source,
            status: 'declined',
            reason:
                'no `@Module({ imports: [ ... ] })` was found in this file, so there is nowhere ' +
                'to add the platform without guessing at the structure',
            manualBlock,
        };
    }

    const withImports = addImportStatements(source, options);
    // The offsets were measured on `source`; re-measure after the import
    // statements shifted everything below them.
    const target = findImportsArray(withImports)!;
    const indent = ' '.repeat(target.indent + 4);
    // The admin module goes in beside the platform, not merely imported: it is
    // what registers the manifest contribution in `onModuleInit`, and a module
    // Nest never instantiates leaves the SuperAdmin sidebar empty — the exact
    // failure the generated file warns about in its own header.
    //
    // Trailing newline and indent, so whatever already stood after the `[`
    // starts on its own line instead of being glued to the closing paren.
    const entries = `${block},\n${options.adminModule.className},`;
    // What follows the `[` decides the last indent. An array that was empty
    // closes at the array's own level; one that had entries continues at the
    // entries' level, so what was already there lines up with what was added.
    const wasEmpty = /^\s*\]/.test(withImports.slice(target.openBracket + 1));
    const trailing = wasEmpty ? ' '.repeat(target.indent) : indent;
    const inserted = `\n${indent}${entries.split('\n').join(`\n${indent}`)}\n${trailing}`;

    return {
        source:
            withImports.slice(0, target.openBracket + 1) +
            inserted +
            withImports.slice(target.openBracket + 1),
        status: 'patched',
        reason: '',
        manualBlock: '',
    };
}

interface ImportsArray {
    /** Index of the `[` that opens the array. */
    readonly openBracket: number;
    /** Column the `imports:` key starts at. */
    readonly indent: number;
}

/**
 * The `imports: [` of an `@Module` decorator.
 *
 * Scoped to a decorator rather than the first `imports:` anywhere, because a
 * file can carry several and only one of them composes the application.
 */
function findImportsArray(source: string): ImportsArray | null {
    const decorator = source.indexOf('@Module(');
    if (decorator === -1) return null;
    const match = /(^|\n)([ \t]*)imports\s*:\s*\[/.exec(source.slice(decorator));
    if (!match) return null;
    const openBracket = decorator + match.index + match[0].length - 1;
    return { openBracket, indent: match[2]!.length };
}

/**
 * The `import` lines the block needs, as text.
 *
 * Only what the inserted code actually uses. `APP_FILTER` and
 * `LimitExceededFilter` are not among them: the filter is printed for the
 * integrator to paste rather than inserted (see `LIMIT_FILTER_PROVIDER`), and
 * importing a symbol the file does not use is a lint error in the first project
 * this lands in.
 */
function renderImports(options: PatchAppModuleOptions): string {
    const lines = [
        "import { loadPlanCatalogFromFile } from '@saasicat/nest/billing';",
        "import { SaaSiCatModule, defineSaaSiCat } from '@saasicat/nest/platform';",
        `import { ${options.registry.constName} } from '${options.registry.importPath}';`,
        `import { ${options.adminModule.className} } from '${options.adminModule.importPath}';`,
    ];
    if (options.persistenceImport) {
        lines.push(`import { persistence } from '${options.persistenceImport}';`);
    }
    for (const quota of options.quotaProviders) {
        lines.push(`import { ${quota.className} } from '${quota.importPath}';`);
    }
    return lines.join('\n');
}

/**
 * Adds the import statements after the last existing one.
 *
 * After rather than before: an import inserted above `reflect-metadata` or a
 * polyfill changes evaluation order, and that failure is silent until it is
 * not.
 */
function addImportStatements(source: string, options: PatchAppModuleOptions): string {
    const lines = source.split('\n');
    const block = renderImports(options).split('\n');
    lines.splice(endOfLastImport(lines) + 1, 0, ...block);
    return lines.join('\n');
}

/**
 * The line on which the last import STATEMENT ends, or -1 when there is none.
 *
 * Not the line it starts on. An import may span several lines, and a root
 * module whose last one does — `import {\n    Module,\n} from '@nestjs/common'`
 * is ordinary Prettier output past three named imports — was cut open at its
 * opening brace, so the generated imports landed inside it and the file stopped
 * being TypeScript. The generator had already written six files by then.
 *
 * A statement ends at the first line carrying its terminating quote: either
 * `from '…'` or a bare side-effect import such as `import 'reflect-metadata'`.
 */
function endOfLastImport(lines: readonly string[]): number {
    let end = -1;
    let open = false;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        if (!open && !/^\s*import\s/.test(line)) continue;
        open = true;
        // `from '…'` closes a braced import; a bare `import '…';` closes itself.
        if (/\bfrom\s+['"][^'"]+['"]/.test(line) || /^\s*import\s+['"][^'"]+['"]/.test(line)) {
            end = index;
            open = false;
        }
    }
    return end;
}

/** The `SaaSiCatModule.forRoot(...)` call, indented from column zero. */
function renderForRootBlock(options: PatchAppModuleOptions): string {
    const quotaList = options.quotaProviders.map((q) => q.className).join(', ');
    return [
        'SaaSiCatModule.forRoot(',
        '    defineSaaSiCat({',
        '        // Plans straight from the YAML. Apps that manage plans in the',
        '        // SuperAdmin UI pass `dbCatalog` instead.',
        "        planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),",
        '        // Your authentication guard. This does NOT compile until you',
        '        // name one, and that is deliberate: an empty array is how the',
        '        // platform is told an endpoint should be auth-free, so a',
        '        // placeholder `[]` here would publish GET /admin/discovery —',
        '        // your whole capability inventory — and the manifest routes to',
        '        // anyone who asks. Import your guard and put it in.',
        '        controller: { guards: [YourAuthGuard] },',
        options.persistenceImport
            ? '        persistence,'
            : '        // persistence: prismaPersistence({ client: PrismaService }),',
        '        catalog: { featureUiRegistry: ' + options.registry.constName + ' },',
        '        adminResources: true,',
        '        promoCodes: true,',
        quotaList ? `        quotaProviders: [${quotaList}],` : '        quotaProviders: [],',
        '    }),',
        ')',
    ].join('\n');
}

/**
 * The `APP_FILTER` provider, as text.
 *
 * Not inserted automatically: `providers` is where an application keeps its own
 * wiring, and an entry added into the middle of it is the edit most likely to
 * land somewhere surprising. Printed instead, with the reason.
 */
export const LIMIT_FILTER_PROVIDER = '{ provide: APP_FILTER, useClass: LimitExceededFilter }';

/**
 * The imports that provider needs, printed with it rather than inserted.
 *
 * They are not in `renderImports` on purpose: the file would import two symbols
 * it does not use, which is a lint error in the first project this lands in.
 */
export const LIMIT_FILTER_IMPORTS = [
    "import { APP_FILTER } from '@nestjs/core';",
    "import { LimitExceededFilter } from '@saasicat/nest/billing';",
].join('\n');
