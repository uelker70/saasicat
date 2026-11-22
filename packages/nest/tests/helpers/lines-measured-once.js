// Values that only one measure answers alike at every door: a detail is
// measured once trimmed, in the UTF-16 code units a browser's `maxlength`
// counts too, and by the platform alone — so the application's
// `ValidationPipe` takes each of them, and the platform answers the ones that
// do not fit with its own refusal rather than the pipe with a 400.

import { SUBSCRIBER_ADDRESS_MAX_LENGTHS } from '@saasicat/core';

/** One character outside the Basic Multilingual Plane: two UTF-16 code units. */
export const EMOJI = '\u{1F600}';

const BOUND = SUBSCRIBER_ADDRESS_MAX_LENGTHS.city;

/** A city as each case gives it, and whether it fits its bound: `[field, why, value, fits]`. */
export const CITIES_MEASURED_ONCE = [
    ['city', 'at its bound with blanks after it', `${'x'.repeat(BOUND)}${' '.repeat(10)}`, true],
    ['city', 'of emoji filling its bound in code units', EMOJI.repeat(BOUND / 2), true],
    [
        'city',
        'of one emoji more than its bound holds in code units',
        EMOJI.repeat(BOUND / 2 + 1),
        false,
    ],
    [
        'city',
        'of one emoji more than its bound holds in characters',
        EMOJI.repeat(BOUND + 1),
        false,
    ],
];
