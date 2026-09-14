// Reads the usage example out of the README: which ports and seed writers its
// harness wires, and which gaps it declares.
//
// Cut with indexOf and read line by line rather than matched with a pattern:
// the README is prose with fenced blocks, and the example lists one member per
// line, which is all this reads.

const FENCE = '```';

/** The code of the first `js` block under `## Usage`. */
export function usageExample(readme) {
    const heading = readme.indexOf('## Usage');
    const opens = heading === -1 ? -1 : readme.indexOf(`${FENCE}js`, heading);
    const body = opens + `${FENCE}js`.length;
    const closes = opens === -1 ? -1 : readme.indexOf(FENCE, body);
    if (closes === -1) throw new Error('the README has no usage example under "## Usage"');
    return readme.slice(body, closes);
}

/** The text between `<key>: <open>` and the bracket that closes it. */
function between(code, key, open, close) {
    const start = code.indexOf(`${key}: ${open}`);
    if (start === -1) throw new Error(`the usage example names no \`${key}\``);
    const inner = start + `${key}: ${open}`.length;
    let depth = 1;
    for (let i = inner; i < code.length; i++) {
        if (code[i] === open) depth++;
        if (code[i] === close) depth--;
        if (depth === 0) return code.slice(inner, i);
    }
    throw new Error(`\`${key}\` in the usage example never closes`);
}

/** The member names an object literal lists, one per line, at its own level. */
function memberNames(block) {
    const names = [];
    let depth = 0;
    for (const raw of block.split('\n')) {
        const line = raw.split('//')[0].trim();
        const name = line.split(/[:,\s]/)[0];
        if (depth === 0 && /^[A-Za-z]+$/.test(name)) names.push(name);
        for (const char of line) {
            if (char === '{') depth++;
            if (char === '}') depth--;
        }
    }
    return names;
}

export function exampleParts(code) {
    const gapList = between(code, 'gaps', '[', ']');
    return {
        adapter: memberNames(between(code, 'adapter', '{', '}')).filter(
            (name) => name !== 'capabilities',
        ),
        seed: memberNames(between(code, 'seed', '{', '}')),
        gaps: gapList.split("'").filter((_, index) => index % 2 === 1),
    };
}
