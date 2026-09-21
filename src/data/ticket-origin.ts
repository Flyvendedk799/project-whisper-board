import { z } from "zod";

/**
 * Where a ticket detail was opened from — used for Back when history
 * can't go back (new tab, deep link). Triage filters themselves are restored
 * via history.back() when the SPA navigated here.
 */
export const ticketOriginSchema = z.object({
  from: z.enum(["triage", "tickets", "project", "home", "inbox", "meeting"]).optional(),
  projectId: z.string().uuid().optional(),
});

export type TicketOrigin = z.infer<typeof ticketOriginSchema>;
