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
//   - the diff keeps the key, because it has to tell "the plan did not have
//     this quota" from "the plan had something nobody can read";
//   - everything that computes with a quota drops it, because a limit nothing
//     can count blocks nobody (`SC-ENTL-010`) and a snapshot has to stay a
//     JSON value.
//
// The boundary refuses a non-number outright now, so this is for rows written
// before it did.

/** A quota as a finite number, or `null` where the value cannot be read as one. */
export function readQuotaValue(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    if (value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Every quota in a JSON column, for a caller that computes with them.
 *
 * A value nobody can read is left out: it cannot be summed, compared against a
 * usage count, or written back into a snapshot as anything a reader would
 * believe.
 */
export function readQuotaRecord(value: unknown): Record<string, number> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const quotas: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const quota = readQuotaValue(entry);
        if (quota !== null) quotas[key] = quota;
    }
    return quotas;
}
