/**
 * Types for `raised-out-of-band.mjs`, which the component suite imports from
 * TypeScript. The helper itself stays plain JavaScript because the Node test
 * files that use it are plain JavaScript too.
 */

/** Runs `body` and returns its value and the messages raised out of band meanwhile. */
export declare function raisedWhile<T>(
    body: () => T | Promise<T>,
): Promise<{ value: T; raised: string[] }>;
