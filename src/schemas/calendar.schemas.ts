import { z } from 'zod';

export const createCalendarEventSchema = z.object({
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().nullable().optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime().nullable().optional(),
    allDay: z.boolean().default(false),
    color: z.string().default('#3B82F6'),
    location: z.string().nullable().optional(),
    attachments: z.array(z.object({
        fileName: z.string(),
        fileUrl: z.string(),
        fileType: z.string(),
        fileSize: z.number()
    }))
});

export const updateCalendarEventSchema = createCalendarEventSchema.partial();

export const calendarEventIdSchema = z.object({
    id: z.string()
});
