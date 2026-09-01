// A value in `config/saas.yaml` may name an environment variable.
//
// `monthly: ${NOTICE_DAYS}` lets one file be wired differently for local
// development and for production. The reference is resolved here, BETWEEN the
// YAML parse and the schema check — so Ajv still sees an integer where the
// schema asks for one, and `monthly` keeps its `integer, minimum: 0`. Resolving
// after validation, or teaching the schema to accept `${…}` strings, would widen
// every typed field to `string | integer`, at which point the schema no longer
// rejects the thing it exists to reject.
//
// The resolved text is read AS THE TYPE THE FIELD DECLARES, not as YAML. An
// environment variable is always a string, so `NOTICE_DAYS=14` has to become
// the integer 14 before Ajv looks at it, and `NOTICE_DAYS=abc` has to be
// refused rather than becoming `NaN` or falling back to `0` — that is the
// silent zero the move into the file exists to end, one level down. Parsing the
// text as YAML instead would turn `BUILD_NUMBER=1234` into a number where
// `app.version` wants a string, and a build number is exactly what somebody
// puts there.
//
// Pure: no I/O, no framework. The loader hands in the parsed document, the
// schema, and the environment to resolve against.

/**
 * The variables a document may refer to; `process.env` in production.
 *
 * `null` means there is no environment to resolve against, and every reference
 * is then refused. That is the case for a document that did not come from the
 * installation's own file — an upload through the catalogue import — because
 * resolving `${DATABASE_URL}` for whoever posts a YAML body would hand them the
 * server's environment one variable at a time.
 */
export type EnvironmentVariables = Readonly<Record<string, string | undefined>> | null;

/**
 * One thing wrong with the references in a document, in the shape the loader
 * reports schema violations in — so every failure reads
 * `tenantBilling.cancellationNoticeDays.monthly: …` whatever caused it.
 */
export interface EnvironmentProblem {
    /** JSON-pointer-like path, as Ajv writes `instancePath`. */
    instancePath: string;
    message: string;
    params: { envVar: string };
}

/**
 * Raised when at least one reference cannot be resolved. All of them at once:
 * an operator fixing a deployment gets the whole list, not one restart per
 * variable.
 */
export class EnvironmentResolutionFailure extends Error {
    constructor(public readonly problems: EnvironmentProblem[]) {
        super(problems.map((p) => p.message).join('\n'));
        this.name = 'EnvironmentResolutionFailure';
    }
}

/** The part of a JSON Schema this module walks. */
export interface SchemaNode {
    type?: string | string[];
    properties?: Record<string, SchemaNode>;
    patternProperties?: Record<string, SchemaNode>;
    additionalProperties?: boolean | SchemaNode;
    items?: SchemaNode;
    $ref?: string;
    $defs?: Record<string, SchemaNode>;
}

/**
 * Variable names that announce a credential.
 *
 * A value that comes into the file becomes part of the catalogue: it is shown on
 * the login page, quoted in validation errors, and recorded as the applied
 * configuration. A secret must never take that route — it stays in the
 * environment and is read where it is used, which is what the `…EnvVar`
 * options (`setupTokenEnvVar`, `mfaSkipEnvVar`) are for: they carry the NAME of
 * a variable, and the platform reads it at the moment of use.
 *
 * Recognition is by name, because a value cannot be inspected for secrecy. The
 * kinds come from the decision that payment credentials live in the environment
 * and never in a file or a table; the words are how such variables are named in
 * practice. `KEY` alone is deliberately absent — `ENTERPRISE_PLAN_KEY` and
 * `APP_KEY` name identifiers, not secrets — so a key is refused only when a
 * qualifier says what kind it is. A credential under an innocuous name passes
 * this guard; the message says so, and that boundary is stated with the
 * requirement rather than hidden.
 */
const CREDENTIAL_WORDS = new Set([
    'SECRET',
    'SECRETS',
    'TOKEN',
    'TOKENS',
    'PASSWORD',
    'PASSWORDS',
    'PASSWD',
    'PWD',
    'CREDENTIAL',
    'CREDENTIALS',
]);
const CREDENTIAL_KEY_QUALIFIERS = new Set([
    'PRIVATE',
    'API',
    'ACCESS',
    'SIGNING',
    'SECRET',
    'AUTH',
]);

/** Whether a variable's name says it holds a credential. */
export function namesACredential(variable: string): boolean {
    const parts = variable.toUpperCase().split('_');
    if (parts.some((part) => CREDENTIAL_WORDS.has(part))) return true;
    return parts.some(
        (part, index) => part === 'KEY' && CREDENTIAL_KEY_QUALIFIERS.has(parts[index - 1] ?? ''),
    );
}

interface Reference {
    name: string;
    /** The text after `:-`, or null when the reference declares no default. */
    fallback: string | null;
}

/** A piece of a string value: literal text, or a reference to resolve. */
type Segment = { text: string } | { reference: Reference };

function isNameStart(ch: string): boolean {
    return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isNameChar(ch: string): boolean {
    return isNameStart(ch) || (ch >= '0' && ch <= '9');
}

/**
 * Splits a string into literal text and `${NAME}` / `${NAME:-default}`
 * references. A `$` that does not open a well-formed reference is ordinary
 * text — `$5` stays `$5` — and there is no escape: a literal `${NAME}` cannot
 * be written, which nothing in a catalogue has a use for.
 *
 * A hand-written scan rather than a pattern: the input is a consumer's file,
 * and a regular expression with two quantifiers that can share characters
 * backtracks on a long enough line.
 */
export function splitReferences(value: string): Segment[] {
    const segments: Segment[] = [];
    let literal = '';
    let index = 0;

    while (index < value.length) {
        const ch = value[index];
        if (ch !== '$') {
            literal += ch;
            index += 1;
            continue;
        }
        const reference = readReference(value, index);
        if (reference === null) {
            literal += ch;
            index += 1;
            continue;
        }
        if (literal !== '') segments.push({ text: literal });
        literal = '';
        segments.push({ reference: reference.reference });
        index = reference.end;
    }
    if (literal !== '') segments.push({ text: literal });
    return segments;
}

/** The reference opening at `start` (which points at `$`), or null if malformed. */
function readReference(value: string, start: number): { reference: Reference; end: number } | null {
    if (value[start + 1] !== '{') return null;
    let cursor = start + 2;
    if (!isNameStart(value[cursor] ?? '')) return null;
    while (cursor < value.length && isNameChar(value[cursor])) cursor += 1;
    const name = value.slice(start + 2, cursor);

    if (value[cursor] === '}') {
        return { reference: { name, fallback: null }, end: cursor + 1 };
    }
    if (value.startsWith(':-', cursor)) {
        const close = value.indexOf('}', cursor + 2);
        if (close === -1) return null;
        return {
            reference: { name, fallback: value.slice(cursor + 2, close) },
            end: close + 1,
        };
    }
    return null;
}

/**
 * The schema node that describes the value at `path`, or null where the schema
 * says nothing — Ajv then reports the unknown member itself.
 */
function schemaAt(root: SchemaNode, path: string[]): SchemaNode | null {
    let node: SchemaNode | null = root;
    for (const segment of path) {
        if (node === null) return null;
        node = deref(root, node);
        if (node.properties && segment in node.properties) {
            node = node.properties[segment];
        } else if (node.items && /^\d+$/.test(segment)) {
            node = node.items;
        } else if (node.patternProperties) {
            // The key's pattern is Ajv's to check; whatever member it accepts
            // has this shape. The catalogue schema has one pattern per map.
            node = Object.values(node.patternProperties)[0] ?? null;
        } else if (typeof node.additionalProperties === 'object') {
            node = node.additionalProperties;
        } else {
            return null;
        }
    }
    return node === null ? null : deref(root, node);
}

function deref(root: SchemaNode, node: SchemaNode): SchemaNode {
    if (!node.$ref) return node;
    const prefix = '#/$defs/';
    if (!node.$ref.startsWith(prefix)) {
        throw new Error(
            `plan-catalog.schema.json uses a $ref this resolver cannot follow: ${node.$ref}`,
        );
    }
    const target = root.$defs?.[node.$ref.slice(prefix.length)];
    if (!target) {
        throw new Error(`plan-catalog.schema.json refers to a missing definition: ${node.$ref}`);
    }
    return target;
}

/** The types a schema node declares, as a set; empty where it declares none. */
function declaredTypes(node: SchemaNode | null): Set<string> {
    if (!node?.type) return new Set();
    return new Set(Array.isArray(node.type) ? node.type : [node.type]);
}

const INTEGER_TEXT = /^-?\d+$/;
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

/**
 * Reads resolved text as the type the field declares.
 *
 * Strict on purpose: `14` is an integer, `1e3`, `0x10` and ` 14` are not. The
 * value is what an operator typed into a deployment, and a lenient reading is
 * how `NOTICE_DAYS=abc` would have become something other than a refusal.
 * Returns `undefined` where the text does not fit.
 */
export function readAs(text: string, types: Set<string>): unknown {
    if (types.has('string') || types.size === 0) return text;
    if (types.has('integer') && INTEGER_TEXT.test(text)) return Number(text);
    if (types.has('number') && NUMBER_TEXT.test(text)) return Number(text);
    if (types.has('boolean') && (text === 'true' || text === 'false')) return text === 'true';
    if (types.has('null') && text === 'null') return null;
    return undefined;
}

function describeTypes(types: Set<string>): string {
    return [...types].join(' or ');
}

function pointer(path: string[]): string {
    return path.length === 0 ? '' : `/${path.join('/')}`;
}

/**
 * Resolves every `${NAME}` in the document against `env`, converting each
 * resolved value to the type the schema declares at that spot.
 *
 * Returns a new document; the input is not touched. Throws
 * `EnvironmentResolutionFailure` carrying every problem found: a variable that
 * is not set and has no default, a value that does not fit the field's type, a
 * reference where the field takes a list or an object, and a variable whose
 * name says it holds a credential.
 */
export function resolveEnvironmentReferences(
    document: unknown,
    schema: SchemaNode,
    env: EnvironmentVariables,
): unknown {
    const problems: EnvironmentProblem[] = [];
    const resolved = walk(document, [], schema, env, problems);
    if (problems.length > 0) throw new EnvironmentResolutionFailure(problems);
    return resolved;
}

function walk(
    value: unknown,
    path: string[],
    schema: SchemaNode,
    env: EnvironmentVariables,
    problems: EnvironmentProblem[],
): unknown {
    if (typeof value === 'string') {
        return resolveString(value, path, schema, env, problems);
    }
    if (Array.isArray(value)) {
        return value.map((item, index) =>
            walk(item, [...path, String(index)], schema, env, problems),
        );
    }
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, member] of Object.entries(value)) {
            out[key] = walk(member, [...path, key], schema, env, problems);
        }
        return out;
    }
    return value;
}

function resolveString(
    value: string,
    path: string[],
    schema: SchemaNode,
    env: EnvironmentVariables,
    problems: EnvironmentProblem[],
): unknown {
    const segments = splitReferences(value);
    const references = segments.flatMap((segment) =>
        'reference' in segment ? [segment.reference] : [],
    );
    if (references.length === 0) return value;

    const instancePath = pointer(path);
    if (env === null) {
        for (const { name } of references) {
            problems.push({
                instancePath,
                params: { envVar: name },
                message:
                    `refers to \${${name}}. References to the environment are resolved only when ` +
                    'the platform reads its own configuration file, and this document arrived ' +
                    'another way.',
            });
        }
        return value;
    }

    const types = declaredTypes(schemaAt(schema, path));
    let text = '';
    let complete = true;
    let firstVariable = '';

    for (const segment of segments) {
        if ('text' in segment) {
            text += segment.text;
            continue;
        }
        const { name, fallback } = segment.reference;
        firstVariable ||= name;
        if (namesACredential(name)) {
            problems.push({
                instancePath,
                params: { envVar: name },
                message:
                    `\${${name}} names a credential, and a value the file resolves becomes part of ` +
                    'the catalogue — shown, logged and recorded. Credentials stay in the environment ' +
                    'and are read where they are used. Rename the variable if it holds no secret.',
            });
            complete = false;
            continue;
        }
        const fromEnv = env[name];
        if (fromEnv !== undefined && (fromEnv !== '' || fallback === null)) {
            text += fromEnv;
        } else if (fallback !== null) {
            text += fallback;
        } else {
            problems.push({
                instancePath,
                params: { envVar: name },
                message:
                    `refers to \${${name}}, which is not set. Set it in the environment, or ` +
                    `write a default into the file as \${${name}:-<value>}.`,
            });
            complete = false;
        }
    }
    if (!complete) return value;

    if (types.has('array') || types.has('object')) {
        problems.push({
            instancePath,
            params: { envVar: firstVariable },
            message:
                `\${${firstVariable}} stands where the field takes a ${describeTypes(types)}. A variable ` +
                'stands in for a single value: write the structure in the file and refer to a ' +
                'variable per entry.',
        });
        return value;
    }
    const converted = readAs(text, types);
    if (converted === undefined) {
        problems.push({
            instancePath,
            params: { envVar: firstVariable },
            message:
                `\${${firstVariable}} resolves to ${JSON.stringify(text)}, and the field takes ` +
                `${describeTypes(types)}.`,
        });
        return value;
    }
    return converted;
}
