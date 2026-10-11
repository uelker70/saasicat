// Writes the sample invoices of `tests/support/invoices.js` as the renderer
// renders them, one file per treatment, into the directory named on the
// command line. CI hands them to the format's own validators (`SC-PRIC-078`).
//
//   node scripts/write-samples.mjs <directory>

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { zugferdInvoiceRenderer } from '../dist/index.js';
import { SAMPLES } from '../tests/support/invoices.js';

const [directory] = process.argv.slice(2);
if (!directory) {
    console.error('usage: node scripts/write-samples.mjs <directory>');
    process.exit(2);
}
mkdirSync(directory, { recursive: true });
const renderer = zugferdInvoiceRenderer();
for (const { name, invoice } of SAMPLES) {
    const document = await renderer.render(invoice);
    writeFileSync(join(directory, `${name}.pdf`), document.content);
    console.log(`${name}.pdf: ${document.content.byteLength} bytes`);
}
