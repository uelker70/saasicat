// An audit log in memory, for the runs that record a failure once and must
// record it still where the first write to the log failed.

/** Records each entry in `audited`, after failing the first `failures` writes. */
export function auditLogFailing(audited, failures = 0) {
    let left = failures;
    return {
        log: async (entry) => {
            if (left > 0) {
                left -= 1;
                throw new Error('the audit log is unreachable');
            }
            audited.push(entry);
        },
    };
}
