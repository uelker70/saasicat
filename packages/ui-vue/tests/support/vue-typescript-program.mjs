/**
 * Handing a directory of `.vue` and `.ts` files to the TypeScript compiler.
 *
 * Two guards need this and neither may own it: reading a single-file component
 * with a pattern is what `injection-keys-are-global-symbols` was rewritten away
 * from, and a second hand-rolled reader would reintroduce exactly the shapes
 * that rewrite exists to decide — a type alias that hides a function type, a
 * `</script >` with a space in it.
 *
 * Everything here is mechanical: find the script blocks, name the file
 * something the compiler will parse, read the package's own compiler settings.
 * What a guard then asks of the resulting program is the guard's own business.
 */
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const PACKAGE = join(__dirname, '..', '..');
export const SRC = join(PACKAGE, 'src');

/** Every `.ts` and `.vue` file under `dir`, depth first. */
export function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (entry.endsWith('.ts') || entry.endsWith('.vue')) yield full;
    }
}

/** 1-based line the offset falls on. */
export function lineAt(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

/* -------------------------------------------------------------------------
 * Handing a `.vue` file to a TypeScript parser
 * ---------------------------------------------------------------------- */

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
 * Blanking rather than slicing is the point: every offset — and therefore every
 * line number this file reports — keeps pointing at the original file, so a
 * failure can be opened at the line it names. What is left is TypeScript, which
 * is what lets the parser below read a single-file component at all.
 *
 * The scan resumes behind each closing tag, which is what makes the `<script`
 * an SFC mentions inside its own script body harmless: it is part of a block
 * already read, not the start of a new one. A block that never closes is
 * reported instead of dropped — everything from there on would otherwise be
 * blanked, and blanked code is code this guard silently stops looking at.
 */
export function scriptBlocksOnly(source) {
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
 * One set of files to judge together, prepared for the compiler.
 *
 * TypeScript decides a file's language from its extension, so a `.vue` enters
 * the program under a name it accepts (`Page.vue.ts`) carrying only its script
 * blocks — and a `./Page.vue` specifier resolves to exactly that file, so a key
 * crossing the boundary is still reachable. `path` stays the name the file has
 * on disk, because that is what a failure message has to print.
 */
export function tree(root, files) {
    return files.map(({ path, text }) => {
        const isVue = path.endsWith('.vue');
        const { code, anomalies } = isVue ? scriptBlocksOnly(text) : { code: text, anomalies: [] };
        return { path, fileName: join(root, isVue ? `${path}.ts` : path), code, anomalies };
    });
}

export function filesUnder(dir) {
    return [...walk(dir)].map((file) => ({
        path: relative(dir, file).split(sep).join('/'),
        text: readFileSync(file, 'utf8'),
    }));
}

/**
 * The package's own compiler settings, which is where module resolution, the
 * target and the lib set are decided. Reading them beats restating them: a
 * guard that resolved modules differently from the build would be answering a
 * question nobody asked.
 *
 * Emit is switched off because nothing is emitted, `rootDir` is dropped so the
 * in-memory counter-check trees may sit beside `src`, and ambient type packages
 * are dropped because they answer none of this file's questions while costing
 * most of its run time.
 */
export function compilerOptions() {
    const configPath = join(PACKAGE, 'tsconfig.json');
    const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
    if (error) throw new Error(`cannot read ${configPath}: ${error.messageText}`);
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, PACKAGE, undefined, configPath);
    const options = {
        ...parsed.options,
        types: [],
        noEmit: true,
        declaration: false,
        declarationMap: false,
        sourceMap: false,
        composite: false,
        incremental: false,
    };
    delete options.outDir;
    delete options.rootDir;
    return options;
}

/* -------------------------------------------------------------------------
 * A program that can read files which are not on disk
 * ---------------------------------------------------------------------- */

/**
 * A compiler host that serves the given units from memory and everything else
 * from disk.
 *
 * Counter-check trees need this. A guard that only ever reads `src` cannot show
 * that it fails on the shape it forbids, and writing that shape to disk to
 * prove it would ship it. The units carry file names inside the package, so
 * `vue` resolves for them along the same `node_modules` walk as for `src` —
 * which is why the directories they pretend to live in are registered too:
 * module resolution walks upward and stops at a directory that does not exist.
 */
export function inMemoryHost(units, options) {
    const files = new Map();
    const directories = new Set();
    for (const unit of units) {
        files.set(unit.fileName, unit.code);
        let directory = dirname(unit.fileName);
        for (;;) {
            if (directories.has(directory)) break;
            directories.add(directory);
            const parent = dirname(directory);
            if (parent === directory) break;
            directory = parent;
        }
    }

    const base = ts.createCompilerHost(options, true);
    const host = {
        ...base,
        fileExists: (name) => files.has(name) || base.fileExists(name),
        readFile: (name) => (files.has(name) ? files.get(name) : base.readFile(name)),
        directoryExists: (name) => directories.has(name) || Boolean(base.directoryExists?.(name)),
        getSourceFile: (name, languageVersion, onError, shouldCreate) =>
            files.has(name)
                ? ts.createSourceFile(name, files.get(name), languageVersion, true)
                : base.getSourceFile(name, languageVersion, onError, shouldCreate),
    };
    return { host, fileNames: [...files.keys()] };
}
