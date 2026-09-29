import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { isPersistenceRefusal, type PersistenceRefusal } from '@saasicat/core';

/** The exception the caller's own check throws for a refusal's case. */
export type RefusalAnswer = (refusal: PersistenceRefusal) => Error;

/**
 * Runs a write and answers an adapter's refusal the way the caller's own check
 * answers the same case before it writes, so the loser of a double click reads
 * the same code as a request that arrived a moment later, rather than a 500.
 *
 * `answers` names that answer by code, wherever the check answers with a
 * status or a body of its own. Any other refusal is answered by what the
 * adapter found: a row that is gone as 404, one that moved as 422 — which is
 * what the catalogue's checks answer.
 */
export async function answeringRefusals<T>(
    write: () => Promise<T>,
    answers: Readonly<Record<string, RefusalAnswer>> = {},
): Promise<T> {
    try {
        return await write();
    } catch (error) {
        if (!isPersistenceRefusal(error)) throw error;
        const answer = Object.prototype.hasOwnProperty.call(answers, error.code)
            ? answers[error.code]
            : undefined;
        if (answer) throw answer(error);
        const body = { code: error.code, message: error.message, params: error.params };
        throw error.reason === 'gone'
            ? new NotFoundException(body)
            : new UnprocessableEntityException(body);
    }
}
