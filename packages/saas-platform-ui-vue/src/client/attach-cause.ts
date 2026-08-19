/**
 * Attach a cause to an error without the ES2022 `Error` constructor option.
 *
 * `new Error(message, { cause })` needs `lib: ES2022`. This package ships eight
 * of its export subpaths as **source** — a consumer compiles those files with
 * their own `tsconfig`, and one of them is on ES2021, where that second
 * argument is a compile error in code they did not write.
 *
 * Defining the property afterwards reads identically to anything inspecting
 * `error.cause`, and needs nothing above ES5. `scripts/check-shipped-source.mjs`
 * holds the floor.
 */
export function attachCause<E extends Error>(error: E, cause: unknown): E {
    Object.defineProperty(error, 'cause', {
        value: cause,
        configurable: true,
        writable: true,
    });
    return error;
}
