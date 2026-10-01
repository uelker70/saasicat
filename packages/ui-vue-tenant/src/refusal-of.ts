import type { ResolvableErrorBody } from '@saasicat/core';

/**
 * The coded body a refused request carried, where it carried one — with the
 * fields a refusal brings beside its code, such as the offer or the preview as
 * they stand now.
 */
export function refusalOf(err: unknown): (ResolvableErrorBody & Record<string, unknown>) | null {
    const body = (err as { body?: unknown } | null)?.body;
    return body !== null && typeof body === 'object'
        ? (body as ResolvableErrorBody & Record<string, unknown>)
        : null;
}
