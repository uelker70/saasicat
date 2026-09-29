import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { isPersistenceRefusal } from '@saasicat/core';

/**
 * Runs a catalogue write and answers an adapter's refusal the way the
 * service's own check answers the same case before it writes: a version that
 * is gone as 404, one somebody published first as 422. The loser of a double
 * click then reads the same code as a request that arrived a moment later,
 * rather than a 500.
 */
export async function answeringRefusals<T>(write: () => Promise<T>): Promise<T> {
    try {
        return await write();
    } catch (error) {
        if (!isPersistenceRefusal(error)) throw error;
        const body = { code: error.code, message: error.message, params: error.params };
        throw error.reason === 'gone'
            ? new NotFoundException(body)
            : new UnprocessableEntityException(body);
    }
}
