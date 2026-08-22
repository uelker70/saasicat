/**
 * Types for `authenticating-client.mjs`, which the component suite imports from
 * TypeScript. The helper itself stays plain JavaScript because the Node test
 * files that use it are plain JavaScript too.
 */
import type { HttpClient } from '../../src/client/types.js';

/**
 * Wraps a client so every request carries `Authorization: Bearer <token>`.
 *
 * Pass a function to have the token read per call rather than captured once.
 * A `null` or `undefined` token sends no header at all.
 */
export declare function authenticating(
    http: HttpClient,
    token: string | null | (() => string | null),
): HttpClient;
