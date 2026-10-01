import { resolveErrorMessage, type ResolvableErrorBody } from '@saasicat/core';

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

/**
 * A refusal in the reader's language, from its code. The thrown text where the
 * body says nothing that can be read — a validation pipe answers with a list
 * of messages and no code, and a sentence that resolves to nothing would leave
 * the reader with a refused click and no reason.
 */
export function refusalMessage(err: unknown, messages: Partial<Record<string, string>>): string {
    const body = refusalOf(err);
    const resolved = body ? resolveErrorMessage(body, messages) : '';
    if (resolved) return resolved;
    return err instanceof Error ? err.message : String(err);
}
