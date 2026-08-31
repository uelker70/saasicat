// How a quota is read out of a JSON column — one reading, in one place.
//
// The same decision was written three times and came out differently each
// time, which produced two opposite defects on the same data:
//
//   - `plan-mapping` dropped every entry that was not a `number`, so a legacy
//     `{"users": "100"}` reached the version diff as *absent*. Replacing it
//     with 50 then read as 0 → 50, an improvement, and published with none of
//     the confirmation a lowered allowance is supposed to need.
//   - the adapters' `toQuotaMap` cast the column straight through, so the same
//     value reached enforcement as the string `"100"`. `"-1"` is the one that
//     costs: unlimited is `=== -1` at every enforcement site, so an unlimited
//     quota written as a string became a limit, `used + delta > "-1"` was true
//     for any usage, and the tenant was refused everything.
//   - `subscription-contract-mapping` dropped it too, so an allowance somebody
//     bought vanished from their contract.
//
// A `number` written as a string is that number — `"100"` is 100 and `"-1"` is
// unlimited — and reading it as one is not leniency, it is the only reading
// that is true. What cannot be read as a finite number is a different case, and
// the callers do not agree on it, so this function answers `null` and each says
// what it wants:
//
//   - the diff keeps the key as `NaN`, because it has to tell "the plan did not
//     have this quota" from "the plan had something nobody can read", and it
//     reports the value that was actually there;
//   - everything that computes with a quota keeps the key as `-1`. Not dropped:
//     absent means *undeclared*, and `enforceLimit` answers an undeclared
//     dimension with a 500 because that is the installation's mistake
//     (`SC-ENTL-011`). A quota that is declared and cannot be read is the other
//     requirement — `SC-ENTL-010`, "a limit nothing can count does not block
//     anybody" — and `-1` is how that is written as data: it is the value every
//     enforcement site short-circuits on, and it survives a round trip through
//     the JSON column a contract snapshot is stored in, which `NaN` does not.
//
// The cost of `-1` is stated rather than hidden: a corrupt value reads as
// unlimited to anything that renders it. The alternatives were measured and are
// worse — dropping it refuses the tenant every operation on that dimension with
// a 500, and `NaN` becomes `null` on the way through a snapshot, where it then
// blocks at zero.
//
// What is not done: `SC-ENTL-010` also asks for the gap to be reported for
// review, and nothing here reports it — these functions are framework-free and
// have nowhere to log. New rows cannot arrive this way, because the boundary
// refuses a non-number outright now; this is for rows written before it did.

/** A quota as a finite number, or `null` where the value cannot be read as one. */
export function readQuotaValue(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    if (value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Declared and unreadable: the quota is there, and nothing can count it.
 *
 * `-1` is the platform's "unlimited", and every enforcement site short-circuits
 * on it, so it is also the value that blocks nobody — which is what
 * `SC-ENTL-010` asks for.
 */
const UNCOUNTABLE = -1;

/**
 * Every quota in a JSON column, for a caller that computes with them.
 *
 * A key that is there stays there. Dropping an unreadable one made it *absent*,
 * and absent means undeclared: `enforceLimit` answers an undeclared dimension
 * with a 500, so every operation on that quota was refused — a fail-closed
 * answer to somebody else's corrupt row.
 */
export function readQuotaRecord(value: unknown): Record<string, number> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const quotas: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        quotas[key] = readQuotaValue(entry) ?? UNCOUNTABLE;
    }
    return quotas;
}
