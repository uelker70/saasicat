// What an isolated report raised while a test ran.
//
// A notify port that throws is raised again out of band on purpose — it must
// not go unnoticed — so it lands on `uncaughtException`, one tick after the
// test that caused it. Capturing it here is what keeps that from failing the
// file, and lets the test say what was raised.

/** Runs `body` and returns its value and the messages raised out of band meanwhile. */
export async function raisedWhile(body) {
    const raised = [];
    const previous = process.listeners('uncaughtException');
    for (const listener of previous) process.off('uncaughtException', listener);
    const capture = (err) => raised.push(err.message);
    process.on('uncaughtException', capture);
    try {
        const value = await body();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { value, raised };
    } finally {
        process.off('uncaughtException', capture);
        for (const listener of previous) process.on('uncaughtException', listener);
    }
}
