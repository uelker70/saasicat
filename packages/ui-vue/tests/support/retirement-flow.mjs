// What a retirement flow is driven with in a test: the three operations its
// resource declares, recording what they were asked, and a second-factor prompt
// answered with `code` — or cancelled, for `null`. A plan version's flow and an
// add-on version's ask the same three, each under its own paths.

/**
 * @param {{
 *   requests: unknown[][],
 *   list: () => Promise<unknown[]>,
 *   preview: unknown,
 *   announce: (...args: unknown[]) => Promise<unknown>,
 * }} options `preview` is the answer, or a function of the arguments giving it.
 */
export function recordingRetirements({ requests, list, preview, announce }) {
    return {
        list: async () => {
            requests.push(['list']);
            return list();
        },
        preview: async (...args) => {
            requests.push(['preview', ...args]);
            return typeof preview === 'function' ? preview(...args) : preview;
        },
        announce: async (...args) => {
            requests.push(['announce', ...args]);
            return announce(...args);
        },
    };
}

/** @param {{ prompts: string[], code: string | null }} options */
export function answeringSecondFactor({ prompts, code }) {
    return {
        async run(description, _invalid, action) {
            prompts.push(description);
            if (code === null) return { done: false };
            return { done: true, value: await action(code) };
        },
    };
}
