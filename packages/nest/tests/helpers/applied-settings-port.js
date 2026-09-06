// The applied-settings port, in memory, with its state open for assertions.
//
// It keeps the port's promise the way a database does: a write lands only
// while the record still carries the fingerprint the caller read, and a change
// lands together with the record it supersedes or not at all. Two recorders
// over one instance therefore behave as two replicas over one table — which is
// what the tests about replicas starting together need, and what a fake that
// always wrote would hide.

export class FakeAppliedSettingsPort {
    applied = null;
    changes = [];

    async readApplied() {
        return this.applied;
    }

    async writeApplied(record, expectedFingerprint) {
        if ((this.applied?.fingerprint ?? null) !== expectedFingerprint) return false;
        this.applied = { ...record };
        return true;
    }

    async recordChange(change, record, expectedFingerprint) {
        if (!(await this.writeApplied(record, expectedFingerprint))) return null;
        const stored = {
            id: `change-${this.changes.length + 1}`,
            ...change,
            acknowledgedAt: null,
            acknowledgedBy: null,
        };
        this.changes.unshift(stored);
        return stored;
    }

    async listChanges(filter = {}) {
        const rows = this.changes.filter(
            (c) =>
                filter.acknowledged === undefined ||
                (c.acknowledgedAt !== null) === filter.acknowledged,
        );
        return filter.limit === undefined ? rows : rows.slice(0, filter.limit);
    }

    async acknowledgeChange(id, by, at) {
        const change = this.changes.find((c) => c.id === id);
        if (!change) return null;
        if (change.acknowledgedAt === null)
            Object.assign(change, { acknowledgedAt: at, acknowledgedBy: by });
        return change;
    }
}
