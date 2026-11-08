// @requirement SC-SCOPE-009 — SaaSiCat is source-available and must not be called open source

// Guard: what ships never calls SaaSiCat open source.
//
// The licence is PolyForm Shield, which the Open Source Initiative has not
// approved. The wrong word is easy to write in passing — a comment explaining
// a default, a README sentence, a release note — and each copy is read by
// somebody deciding what they may do with the code.
//
// The guard reads every file `scripts/what-ships.mjs` counts as shipped, the
// changesets included, since Changesets copies them into the
// published changelog. Every mention of the two words has to be a negation
// ("not OSI open source") or the name of the Open Source Initiative. The words
// are compared as a token stream, so a hyphen, a line break or a comment
// marker between them hides nothing.
//
// Negation is read in the few words right before the mention, not in the
// sentence around it: "because the project is open source and a developer who
// does not configure a locale…" carries a "not" that negates something else.
//
// One kind of text is exempt, and it is derived rather than listed: the
// requirement that states the rule, and the decision records its `_Source:_`
// line names. They have to name the claim to forbid it — "describing the
// project as open source is a factual error" — and no reading of the words
// alone tells that from the claim itself.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCatalogue } from '../scripts/requirements/parse.mjs';
import { shippedFiles } from '../scripts/what-ships.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULE = 'SC-SCOPE-009';
const ADR_DIRECTORY = 'docs/explanation/adr';

/** One quantifier over a class that excludes its own separator — nothing to backtrack. */
const NOT_A_WORD = /[^\p{L}\p{N}]+/u;
const NEGATIONS = new Set(['not', 'never']);

/** How many words before a mention a negation may stand and still be its own. */
const NEGATION_REACH = 3;

/** Every word of a text, lower-cased, with the line it stands on. */
function wordsOf(text) {
    return text.split('\n').flatMap((line, at) =>
        line
            .toLowerCase()
            .split(NOT_A_WORD)
            .filter(Boolean)
            .map((word) => ({ word, line: at + 1 })),
    );
}

/** The lines on which a text calls something open source without negating it. */
export function claimsIn(text) {
    const words = wordsOf(text);
    const claims = [];
    for (let at = 0; at + 1 < words.length; at++) {
        if (words[at].word !== 'open' || words[at + 1].word !== 'source') continue;
        if (words[at + 2]?.word === 'initiative') continue;
        const before = words.slice(Math.max(0, at - NEGATION_REACH), at);
        if (before.some(({ word }) => NEGATIONS.has(word))) continue;
        claims.push(words[at].line);
    }
    return claims;
}

/** The requirement's own wording, and the decision records it names as its source. */
function exemptions() {
    const entry = readCatalogue(ROOT).entries.find(({ id }) => id === RULE);
    assert.ok(entry, `${RULE} is not in the catalogue, so there is no rule to hold`);
    const adrNumbers = entry.sources.flatMap((source) =>
        [...source.matchAll(/\bADR (\d{4})\b/g)].map(([, number]) => number),
    );
    const records = readdirSync(join(ROOT, ADR_DIRECTORY))
        .filter((name) => adrNumbers.some((number) => name.startsWith(`${number}-`)))
        .map((name) => `${ADR_DIRECTORY}/${name}`);
    return { passages: [entry.title, entry.text], records };
}

/** A file's text with every exempt passage cut out. */
function withoutPassages(text, passages) {
    return passages.reduce((rest, passage) => rest.split(passage).join(''), text);
}

const shipped = shippedFiles(ROOT);

describe('what ships never calls SaaSiCat open source', () => {
    test('there are shipped files to look at, and the exemptions resolve', () => {
        assert.ok(shipped.length > 200);
        const { records, passages } = exemptions();
        // Without a resolved record the exemption is empty and the guard fails
        // on the decision itself; with more than one, a source line now names
        // something this guard was not written for.
        assert.equal(records.length, 1, `the ADR named by ${RULE} resolved to ${records}`);
        assert.ok(passages.every((passage) => passage.length > 20));
    });

    test('no shipped file makes the claim', () => {
        const { passages, records } = exemptions();
        const offenders = [];
        for (const path of shipped) {
            if (records.includes(path)) continue;
            const text = withoutPassages(readFileSync(join(ROOT, path), 'utf8'), passages);
            for (const line of claimsIn(text)) offenders.push(`${path}:${line}`);
        }
        assert.deepEqual(
            offenders,
            [],
            `Called open source in what ships:\n  ${offenders.join('\n  ')}\n` +
                `The licence is source-available, not OSI-approved (${RULE}). Say ` +
                '"source-available", or "not OSI open source" where the distinction is the point.',
        );
    });

    test('the requirement itself is still read once its own wording is cut out', () => {
        const text = readFileSync(join(ROOT, 'docs/requirements.md'), 'utf8');
        const { passages } = exemptions();
        assert.notEqual(withoutPassages(text, passages), text, 'nothing was cut');
        assert.deepEqual(claimsIn(withoutPassages(text, passages)), []);
    });
});

describe('what counts as the claim', () => {
    test('a plain statement is one, however it is spelled or broken', () => {
        assert.deepEqual(claimsIn('the project is open source'), [1]);
        assert.deepEqual(claimsIn('an Open-Source platform'), [1]);
        assert.deepEqual(claimsIn('a\n * the project is open\n * source'), [2]);
    });

    test('a negation right before it is not', () => {
        assert.deepEqual(claimsIn('source-available, not OSI open source.'), []);
        assert.deepEqual(claimsIn('source-available, not OSI\nopen source.'), []);
        assert.deepEqual(claimsIn('must not be called open source'), []);
        assert.deepEqual(claimsIn('never calls SaaSiCat open source'), []);
    });

    test('a negation further away belongs to something else', () => {
        assert.deepEqual(
            claimsIn('because the project is open source and a developer who does not configure'),
            [1],
        );
        assert.deepEqual(claimsIn('This is not optional. The project is open source.'), [1]);
    });

    test('the name of the Open Source Initiative is not the claim', () => {
        assert.deepEqual(claimsIn('not approved by the Open Source Initiative'), []);
    });

    test('words that merely contain the two are not either', () => {
        assert.deepEqual(claimsIn('reopen sources; opensource; open sourcing'), []);
    });
});
