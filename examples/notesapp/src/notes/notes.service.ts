import { Injectable } from '@nestjs/common';
import type { Note } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateNoteDto } from './create-note.dto';

@Injectable()
export class NotesService {
    constructor(private readonly prisma: PrismaService) {}

    async list(tenantId: string): Promise<Note[]> {
        return this.prisma.note.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
        });
    }

    async create(tenantId: string, dto: CreateNoteDto): Promise<Note> {
        return this.prisma.note.create({
            data: { tenantId, title: dto.title, body: dto.body ?? null },
        });
    }
}
