// @requirement SC-ADM-025 — An operator gets a description of the invoicing procedure to document its own on

// The description of the invoicing procedure names what an installation
// decides, so that an operator documents only what is its own. What an
// installation decides is read here from where it is defined: every key of the
// parts of `config/saas.yaml` the invoicing reads, from the file's schema, and
// every port an application wires into the invoicing chain, from the module
// options that take them. A setting or a port added without a word on the page
// fails here rather than leaving the operator's documentation short.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${REPO_ROOT}${path}`, 'utf8');

const PAGE = read('docs/explanation/invoicing-procedure.md');
const SCHEMA = JSON.parse(read('packages/spec/schemas/plan-catalog.schema.json'));
const OPTIONS = read('packages/nest/src/billing/tenant-billing.module.ts');

/** The parts of `config/saas.yaml` an invoice is made from, numbered by, paid through or dated in. */
const SECTIONS = ['invoicing', 'issuer', 'terms', 'tax', 'payments', 'timeZone'];

/** Where the options of `TenantBillingModule` wire the invoices. */
const WIRING_START = '        invoices?: {';

/** A node of the schema, its local `$ref` followed. */
function resolved(node) {
    if (!node.$ref) return node;
    return node.$ref
        .slice('#/'.length)
        .split('/')
        .reduce((at, key) => at[key], SCHEMA);
}

/** Each key under a section as `section.key`, or the section itself where it holds a value. */
function settingsOf(sections) {
    return sections.flatMap((section) => {
        const node = SCHEMA.properties[section];
        assert.ok(node, `config/saas.yaml has no ${section}`);
        const keys = Object.keys(resolved(node).properties ?? {});
        return keys.length === 0 ? [section] : keys.map((key) => `${section}.${key}`);
    });
}

/** The block that wires the invoices, from its opening brace to the one that closes it. */
function invoiceWiringOf(source) {
    const start = source.indexOf(WIRING_START);
    assert.notEqual(
        start,
        -1,
        'the options no longer wire the invoices where this test reads them',
    );
    let depth = 0;
    for (let at = source.indexOf('{', start); at < source.length; at += 1) {
        if (source[at] === '{') depth += 1;
        if (source[at] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, at + 1);
    }
    return assert.fail('the block that wires the invoices does not close');
}

/** Every port the block takes, by the type `ProviderSpec<…>` names. */
function portsOf(block) {
    const types = block
        .split('ProviderSpec<')
        .slice(1)
        .map((rest) => rest.slice(0, rest.indexOf('>')));
    return [...new Set(types)];
}

const unnamed = (names) => names.filter((name) => !PAGE.includes(`\`${name}\``));

test('the page names every setting of the file the invoicing reads', () => {
    const settings = settingsOf(SECTIONS);

    // Read off the schema rather than a list, so it is only as long as the file is wide.
    assert.ok(settings.length > SECTIONS.length, `only ${settings.length} settings were read`);
    assert.deepEqual(unnamed(settings), []);
});

test('the page names every port an application wires into the invoicing chain', () => {
    const ports = portsOf(invoiceWiringOf(OPTIONS));

    assert.ok(ports.includes('InvoiceRenderer'), `the ports read were ${ports.join(', ')}`);
    assert.deepEqual(unnamed(ports), []);
});
