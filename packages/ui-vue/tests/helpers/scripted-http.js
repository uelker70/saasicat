// An HTTP client for composables that talk to the platform: it answers each
// request with the next scripted status and body, and records what was asked.

/** An HTTP client answering each request with the next scripted status and body. */
export function scriptedHttp(...answers) {
    const calls = [];
    return {
        calls,
        client: async (url, init) => {
            calls.push({
                url,
                method: init?.method ?? 'GET',
                body: init?.body ? JSON.parse(init.body) : undefined,
            });
            const [status, body] = answers.shift();
            return {
                status,
                headers: { get: () => null },
                json: async () => body,
                text: async () => JSON.stringify(body),
            };
        },
    };
}
