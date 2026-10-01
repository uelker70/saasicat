// The parts behind a version notice run: where the notices are recorded, and
// the application's port that sends them — both kept in memory, so a test can
// read what was sent and what the record says.

/**
 * A notice record that keeps one entry per subscription, kind and subject, and
 * honours a claim the way the persistence contract asks every adapter to.
 */
export function noticeRecord() {
    const rows = new Map();
    const keyOf = (key) => `${key.subscriptionId}|${key.kind}|${key.subject}`;
    const held = (id, claimedAt) =>
        [...rows.values()].find(
            (row) =>
                row.id === id &&
                row.deliveredAt === null &&
                row.claimedAt?.getTime() === claimedAt.getTime(),
        );
    return {
        rows,
        async claim(key, content, now, staleBefore) {
            if (!rows.has(keyOf(key))) {
                rows.set(keyOf(key), {
                    id: `notice-${rows.size + 1}`,
                    ...key,
                    content,
                    createdAt: now,
                    claimedAt: null,
                    deliveredAt: null,
                    delivery: null,
                });
            }
            const row = rows.get(keyOf(key));
            if (row.deliveredAt !== null) return null;
            if (row.claimedAt !== null && row.claimedAt >= staleBefore) return null;
            Object.assign(row, { claimedAt: now, content });
            return { ...row };
        },
        async confirm(id, claimedAt, delivery, now) {
            const row = held(id, claimedAt);
            if (!row) return false;
            Object.assign(row, { deliveredAt: now, delivery });
            return true;
        },
        async release(id, claimedAt) {
            const row = held(id, claimedAt);
            if (row) row.claimedAt = null;
        },
        async listDeliveredSubscriptionIds(kind, subject) {
            return [...rows.values()]
                .filter((row) => row.kind === kind && row.subject === subject && row.deliveredAt)
                .map((row) => row.subscriptionId);
        },
        async listForSubscription(subscriptionId) {
            return [...rows.values()].filter((row) => row.subscriptionId === subscriptionId);
        },
    };
}

/**
 * The application's port: records every notice it is handed and answers with
 * `answer` — a delivery, or a function of the notice that returns or throws one.
 */
export function sendingPort(answer = { recipients: ['admin@example.com'], channel: 'email' }) {
    const sent = [];
    return {
        sent,
        async deliver(notice) {
            sent.push(notice);
            return typeof answer === 'function' ? answer(notice) : answer;
        },
    };
}
