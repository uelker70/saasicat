// What a run writes to the audit log once per process, however often it finds
// the same thing again: a hold that lasts, a failure that repeats every
// quarter of an hour.
//
// A key is reserved before its entry is written, so a run overlapping this one
// writes no second entry, and released where the write fails, so the next run
// tries it again. A restart writes it once more.

export class AuditedOnce {
    private readonly keys = new Set<string>();

    /**
     * Writes the entry under `key` unless it was written or is being written.
     * `write` resolves whether the entry was written, or there is no audit log
     * to write it to.
     */
    async record(key: string, write: () => Promise<boolean>): Promise<void> {
        if (this.keys.has(key)) return;
        this.keys.add(key);
        if (!(await write())) this.keys.delete(key);
    }
}
