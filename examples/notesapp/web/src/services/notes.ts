// Notes API — typed wrappers over `/api/v1/notes`.
//
// Create returns HTTP 402 once the tenant's `notesMax` quota is hit
// (EnforceQuota → LimitExceededFilter); that single status is surfaced as a
// typed `QuotaExceededError` so the page can render the limit inline instead of
// as a generic failure.

import axios from 'axios';
import { api } from './http';

export interface Note {
    id: string;
    tenantId: string;
    title: string;
    body: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface CreateNoteInput {
    title: string;
    body?: string;
}

export interface NotesExport {
    format: string;
    count: number;
    notes: Note[];
}

/** Wire shape of the LimitExceededFilter 402 body. */
interface LimitExceededBody {
    used?: number;
    max?: number;
    message?: string;
}

export class QuotaExceededError extends Error {
    constructor(
        readonly used: number,
        readonly max: number,
        message: string,
    ) {
        super(message);
        this.name = 'QuotaExceededError';
    }
}

export async function listNotes(): Promise<Note[]> {
    const { data } = await api.get<Note[]>('/notes');
    return data;
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
    try {
        const { data } = await api.post<Note>('/notes', input);
        return data;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 402) {
            const body = (err.response.data ?? {}) as LimitExceededBody;
            throw new QuotaExceededError(
                body.used ?? 0,
                body.max ?? 0,
                body.message ?? 'Note quota reached.',
            );
        }
        throw err;
    }
}

export async function exportNotes(): Promise<NotesExport> {
    const { data } = await api.post<NotesExport>('/notes/export');
    return data;
}
