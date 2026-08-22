// Placeholder interpolation for catalog messages: `{name}` is replaced with
// `params.name`. Unknown placeholders stay verbatim so a missing param is
// visible in the UI instead of silently disappearing.
//
// The implementation lives in `@saasicat/core` because the shipped error-text
// catalogue needs the same interpolation and must not depend on a UI package.
// This stays as the name the UI code already imports.

import { formatErrorMessage } from '@saasicat/core';

export type MessageParams = Record<string, string | number>;

export function formatMessage(template: string, params: MessageParams): string {
    return formatErrorMessage(template, params);
}
