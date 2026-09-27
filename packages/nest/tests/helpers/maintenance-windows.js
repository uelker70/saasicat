// The maintenance window port, in memory, with its state open for assertions.
//
// It keeps the port's promise the way the database does: at most one window
// open, and a move lands only while the window is still at the stage the caller
// read. Two services over one instance therefore behave as two processes over
// one table — which is what the tests about a lock reaching another process
// need, and what a fake that always wrote would hide.

export class FakeMaintenanceWindowPort {
    windows = [];
    reads = 0;
    /** Set to an Error to make every read fail, as a database that does not answer. */
    failReads = null;
    /** Moves to refuse before one lands: a stand-in for another operator getting there first. */
    refuseNextUpdates = 0;
    #next = 0;

    async findOpen() {
        this.reads += 1;
        if (this.failReads) throw this.failReads;
        const open = this.windows.find((window) => window.endedAt === null);
        return open ? { ...open } : null;
    }

    async listRecent(limit) {
        return [...this.windows]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit)
            .map((window) => ({ ...window }));
    }

    async open(window) {
        if (this.windows.some((existing) => existing.endedAt === null)) return null;
        const stored = { id: `window-${++this.#next}`, ...window, endedAt: null, endedBy: null };
        this.windows.push(stored);
        return { ...stored };
    }

    async update(id, stage, changes) {
        if (this.refuseNextUpdates > 0) {
            this.refuseNextUpdates -= 1;
            return null;
        }
        const window = this.windows.find(
            (candidate) =>
                candidate.id === id &&
                candidate.endedAt === null &&
                (candidate.lockedAt !== null) === (stage === 'locked'),
        );
        if (!window) return null;
        Object.assign(window, changes);
        return { ...window };
    }

    /** Locks the open window, or opens one locked, as another process would. */
    lockBehindTheServicesBack(at = new Date()) {
        const open = this.windows.find((window) => window.endedAt === null);
        if (open) {
            Object.assign(open, { lockedAt: at, lockedBy: 'cli:other@example.com:elsewhere' });
            return open;
        }
        const window = {
            id: `window-${++this.#next}`,
            startsAt: null,
            endsAt: null,
            message: null,
            createdAt: at,
            createdBy: 'cli:other@example.com:elsewhere',
            lockedAt: at,
            lockedBy: 'cli:other@example.com:elsewhere',
            endedAt: null,
            endedBy: null,
        };
        this.windows.push(window);
        return window;
    }
}

/** An audit port that keeps what it is given. */
export class RecordingAuditPort {
    entries = [];
    failWith = null;

    async write(entry) {
        if (this.failWith) throw this.failWith;
        this.entries.push(entry);
    }
}

/** A notification port that keeps what it is told, and can fail or hang. */
export class RecordingNotifications {
    events = [];
    failWith = null;

    async windowChanged(event) {
        this.events.push(event);
        if (this.failWith) throw this.failWith;
    }
}

export const OPERATOR = {
    userId: 'user-ops',
    email: 'ops@example.com',
    source: 'web',
    context: 's1',
};

export const OPERATOR_TAG = 'web:ops@example.com:s1';

/** A moment `minutes` from now; negative for the past. */
export function inMinutes(minutes) {
    return new Date(Date.now() + minutes * 60_000);
}

/** Waits until the fire-and-forget notification has been handed over. */
export function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}
