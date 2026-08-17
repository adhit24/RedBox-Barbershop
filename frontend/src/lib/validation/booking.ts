import { z } from 'zod';

export const bookingSchema = z.object({
  name: z.string().trim().min(1).max(120),
  wa: z.string().trim().regex(/^[0-9+\-\s()]{8,20}$/, 'Nomor WA tidak valid'),
  service_id: z.union([z.string(), z.number()]).optional().nullable(),
  service: z.string().trim().min(1).max(200),
  price: z.union([z.string(), z.number()]).optional().nullable(),
  duration: z.union([z.string(), z.number()]).optional().nullable(),
  barber_id: z.string().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal tidak valid (YYYY-MM-DD)'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Format waktu tidak valid (HH:mm)'),
  location: z.string().trim().min(1).max(60),
  payment: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export type BookingInput = z.infer<typeof bookingSchema>;
