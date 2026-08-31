// A promise that admits no exception has to be able to answer for it.
//
// "Never", "every", "only", "uniformly" — the words that make a requirement
// worth having are the same ones that make it easy to get wrong, and they were
// the most common defect across the three requirement documents this
// repository's catalogue came out of. The sentence reads well, nobody argues
// with it, and the one case it does not cover is discovered by a customer.
//
// Two things settle it, and either is enough:
//
//   - **a proof**. A test that runs the promise past its own boundary is worth
//     more than any wording, and an absolute is the easiest kind of promise to
//     write a test for: there is nothing to argue about at the edge.
//   - **a named exception**. Where the absolute is not quite true, the entry
//     says where it stops. `SC-ENTL-021` names the one catalogue edit that does
//     reach a running contract; `SC-LANG-002` names the two defaults that
//     disagree. Both are more useful than the absolute would have been.
//
// What is left over — an absolute nothing measures and nothing qualifies — is
// debt, and it is frozen rather than paid off. Backfilling would be a week of
// rewording for a number nobody would trust; freezing costs nothing and stops
// the next one. The credit is fungible for the same reason it is in the proof
// ratchet: a promise that genuinely admits no exception and has no test worth
// writing can still be added by settling one already owed.
//
// The lists below are this file's subject. There is no source to derive "which
// words are absolute" from, and a shorter list that is right beats a longer one
// that fires on ordinary prose — so each entry is a word that makes a claim
// about *all* cases, and nothing is here merely for being emphatic.

/** Words that claim every case, with no room left over. */
export const ABSOLUTES = [
    'all',
    'always',
    'any',
    'anything',
    'cannot',
    'each',
    'everything',
    'everywhere',
    'every',
    'exclusively',
    'must not',
    'never',
    'none',
    'nothing',
    'no',
    'only',
    'uniformly',
    'uniform',
];

/** Words with which an entry says where its absolute stops. */
export const EXCEPTIONS = [
    'apart from',
    'aside from',
    'besides',
    'exceptions',
    'exception',
    'except',
    'other than',
    'save for',
    'unless',
];

/**
 * The promise reduced to its words, with a space at each end.
 *
 * Compared as data rather than through a pattern assembled from the lists: a
 * regular expression built from a value is what `no-restricted-syntax` refuses
 * here, and the escaping question it raises has no good answer. Everything that
 * is not a letter becomes a separator, so a word wrapped in punctuation, a line
 * break or backticks is the same word — and `anyone` is not `any`, because the
 * surrounding spaces are part of what is looked for.
 */
function wordsOf(text) {
    return ` ${text
        .toLowerCase()
        .replace(/[^\p{L}]+/gu, ' ')
        .trim()} `;
}

/** The promise an entry makes: its heading and whatever stands under it. */
export function promiseOf(entry) {
    return `${entry.title} ${entry.text}`;
}

function saysAnyOf(entry, phrases) {
    const words = wordsOf(promiseOf(entry));
    return phrases.some((phrase) => words.includes(` ${phrase} `));
}

/** Whether an entry claims every case. */
export function claimsEveryCase(entry) {
    return saysAnyOf(entry, ABSOLUTES);
}

/** Whether an entry says where its claim stops. */
export function namesAnException(entry) {
    return saysAnyOf(entry, EXCEPTIONS);
}

/**
 * The standing promises that admit no exception, name none, and prove nothing.
 *
 * Only standing ones, for the reason the proof debt counts only those: a draft
 * is not a promise yet, a retired one is not one any more, and one marked as
 * decided-but-not-delivered has nothing to answer for until it is built.
 */
export function unqualified(entries, named) {
    return entries
        .filter((entry) => entry.status === 'current' && entry.delivered)
        .filter((entry) => claimsEveryCase(entry))
        .filter((entry) => !namesAnException(entry))
        .filter((entry) => !named.has(entry.id))
        .map((entry) => entry.id);
}

/**
 * The absolutes move one way: a new one arrives with a test or with its
 * exception, or it settles one already owed.
 *
 * An entry leaving the debt only counts as credit while it still stands.
 * Retiring a promise says nothing about the wording of the next one, and
 * without that condition superseding an old absolute would pay for a new one.
 */
export function absoluteRatchet(before, after) {
    const owedNow = new Set(after.debt);
    const wasOwed = new Set(before.debt);
    const standingNow = new Set(after.standing);

    const arrived = after.debt.filter((id) => !wasOwed.has(id));
    const settled = before.debt.filter((id) => standingNow.has(id) && !owedNow.has(id));

    if (arrived.length <= settled.length) return [];
    return [
        `${arrived.length} promise(s) claim every case with neither a test nor a named ` +
            `exception, and ${settled.length} that owed one gained it.\n` +
            `    Unqualified: ${arrived.slice(0, 5).join(', ')}` +
            `${arrived.length > 5 ? `, and ${arrived.length - 5} more` : ''}\n` +
            '    Either name a test for it, or say in the entry where the absolute stops\n' +
            '    ("except", "unless", "other than"). An absolute with no boundary is the\n' +
            '    one somebody finds by falling outside it.',
    ];
}
