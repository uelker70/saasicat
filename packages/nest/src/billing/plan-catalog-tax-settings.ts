// Where a catalogue's rate comes from: the file's `vatRate`, or the tax adapter
// `tax` names — one of the two, never both and never neither. The schema cannot
// say that in a way that names the line to fix (`if`/`then` makes Ajv report
// the document root), so the loader says it, in the shape of a schema error.

import type { AjvErrorLike } from './plan-catalog-loader.js';
import { knowsTimeZone } from '../tax/time-zone.js';

/** What is wrong with a document's rate source and time zone; empty when nothing is. */
export function taxSettingsProblems(document: Record<string, unknown>): AjvErrorLike[] {
    const names = (key: string) => document[key] !== undefined;
    const problems: AjvErrorLike[] = [];
    if (names('tax') && names('vatRate')) {
        problems.push({
            instancePath: '/vatRate',
            message:
                'is not allowed beside `tax`: the tax adapter decides every rate. Delete this line.',
        });
    }
    if (!names('tax') && !names('vatRate')) {
        // The wording Ajv used while `vatRate` was required, so an integrator
        // meets the same sentence as before, and the alternative beside it.
        problems.push({
            instancePath: '',
            params: { missingProperty: 'vatRate' },
            message: "must have required property 'vatRate' (or name a tax adapter under `tax`)",
        });
    }
    const timeZone = document['timeZone'];
    if (typeof timeZone === 'string' && !knowsTimeZone(timeZone)) {
        problems.push({
            instancePath: '/timeZone',
            message:
                'names no time zone this runtime knows; give an IANA name such as Europe/Berlin.',
        });
    }
    return problems;
}
