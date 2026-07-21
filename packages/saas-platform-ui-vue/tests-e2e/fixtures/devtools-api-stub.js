// No-op stub for `@vue/devtools-api` in the E2E fixture. The pinia
// esm-browser build imports `setupDevtoolsPlugin` statically; without
// running Devtools the hook does nothing, but it must still be resolvable.
export function setupDevtoolsPlugin() {}
