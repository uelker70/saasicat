// What `subscriptionEnds.deletion` takes, and why a start is refused without
// it (`SC-PRIV-021`): the identifier of the environment the process runs in,
// which a deletion compares with the mark of the database, and where that mark
// is read from. The sentences are shared by the start rules of `SaaSiCatModule`
// and by `TenantBillingModule` wired by hand, so both say the same.

import {
    INSTALLATION_IDENTIFIER_MAX_LENGTH,
    type InstallationIdentifierProblem,
} from '@saasicat/core';

/**
 * What is wrong with the value given, in words. The value itself is never
 * repeated: a misplaced variable may hold something that belongs in no log.
 */
const WHAT_IS_WRONG: Readonly<Record<InstallationIdentifierProblem, string>> = {
    missing: 'is missing',
    'not-a-string': 'is not an installation identifier, which is a string',
    blank: 'is blank',
    'too-long': `is longer than ${INSTALLATION_IDENTIFIER_MAX_LENGTH} characters`,
    characters:
        'is not an installation identifier, which is letters, digits, `.`, `_` and `-`, ' +
        'beginning with a letter or a digit and with nothing around it',
};

/**
 * Why a start is refused where the ends of subscriptions are kept and the
 * identifier of this environment is not one, naming the option the way
 * `option` spells it.
 */
export function installationNotNamed(
    option: string,
    problem: InstallationIdentifierProblem,
): string {
    return (
        `${option} ${WHAT_IS_WRONG[problem]}: wherever the end of a subscription is kept, a ` +
        "tenant is deleted only from a database marked as this installation's own " +
        '(SC-PRIV-021), so pass the identifier of the environment this process runs in the ' +
        'way the application passes its other settings from there — such as ' +
        '`deletion: { installation: process.env.SAASICAT_INSTALLATION }` — and mark the ' +
        'database once with `<app> installation mark <identifier>`.'
    );
}

/**
 * Why `TenantBillingModule` wired by hand is refused where the ends of
 * subscriptions are kept and nothing says where the mark is read from.
 */
export function installationMarksNotWired(option: string): string {
    return (
        `${option} is missing: wherever the end of a subscription is kept, the mark of the ` +
        'installation is read before a tenant is deleted (SC-PRIV-021), and a brake that ' +
        'cannot be read cannot hold — pass an InstallationMarkPort, which both shipped ' +
        'persistence adapters provide from the `InstallationMark` model of `@saasicat/spec`.'
    );
}
