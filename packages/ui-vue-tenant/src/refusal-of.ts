import { resolveErrorMessage, type ResolvableErrorBody } from '@saasicat/core';
import type { PlanChangePreviewIssueShape } from '@saasicat/ui-vue';

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

/**
 * The reasons a refusal lists beside its own sentence — a plan change blocked
 * at the moment it is made carries them as `blockers`, as its preview does —,
 * each with its code, its English message and its values; none where it lists
 * none. An entry without a code and a message is not a reason anybody can read.
 */
export function refusalBlockersOf(err: unknown): PlanChangePreviewIssueShape[] {
    const listed = refusalOf(err)?.blockers;
    if (!Array.isArray(listed)) return [];
    return listed.flatMap((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const code = 'code' in entry ? entry.code : undefined;
        const message = 'message' in entry ? entry.message : undefined;
        if (typeof code !== 'string' || typeof message !== 'string') return [];
        const given = 'params' in entry ? entry.params : undefined;
        const params: Record<string, string | number> = {};
        if (typeof given === 'object' && given !== null) {
            for (const [name, value] of Object.entries(given)) {
                if (typeof value === 'string' || typeof value === 'number') params[name] = value;
            }
        }
        return [{ code, message, params }];
    });
}

/**
 * One blocker or warning in the reader's language, from its code and values,
 * the platform's English where the catalogue does not know it.
 */
export function issueSentence(
    issue: PlanChangePreviewIssueShape,
    messages: Partial<Record<string, string>>,
): string {
    return resolveErrorMessage(
        { code: issue.code, message: issue.message, params: issue.params },
        messages,
    );
}
