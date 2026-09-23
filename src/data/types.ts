import type { Database } from "@/integrations/supabase/types";

/**
 * Row shapes, derived from the generated schema.
 *
 * Everything in `src/data` types its results from these rather than casting.
 * The embedded-relation shapes below are declared once and handed to
 * `.returns<T>()`, which is the sanctioned way to describe a PostgREST select
 * without reaching for `any` — and the reason the app no longer contains 41 of
 * them.
 */

export type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Insert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type Update<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export type Ticket = Row<"tickets">;
export type TicketComment = Row<"ticket_comments">;
export type TicketAttachment = Row<"ticket_attachments">;
export type TicketEvent = Row<"ticket_events">;
export type TicketRelation = Row<"ticket_relations">;
export type CaptureContext = Row<"ticket_capture_context">;
export type Project = Row<"projects">;
export type ProjectMember = Row<"project_members">;
export type ProjectUpdate = Row<"project_updates">;
export type Organization = Row<"organizations">;
export type Milestone = Row<"milestones">;
export type Meeting = Row<"meetings">;
export type MeetingActionItem = Row<"meeting_action_items">;
export type Quote = Row<"quotes">;
export type QuoteLineItem = Row<"quote_line_items">;
export type Invoice = Row<"invoices">;
export type InvoiceLineItem = Row<"invoice_line_items">;
export type Payment = Row<"payments">;
export type Notification = Row<"notifications">;
export type NotificationPreferences = Row<"notification_preferences">;
export type Profile = Row<"profiles">;
export type SavedView = Row<"saved_views">;
export type TimeEntry = Row<"time_entries">;
export type Workspace = Row<"workspaces">;
export type OutboundMessage = Row<"outbound_messages">;
export type AppErrorRow = Row<"app_errors">;
export type SlaPolicy = Row<"sla_policies">;

// AI Planner
export type Plan = Row<"plans">;
export type PlanSection = Row<"plan_sections">;
export type PlanTask = Row<"plan_tasks">;
export type PlanAgent = Row<"plan_agents">;
export type PlanEvent = Row<"plan_events">;
export type PlanTaskComment = Row<"plan_task_comments">;
export type ApiKey = Row<"api_keys">;

/** The subset of a profile shown next to something someone did. */
export type PersonRef = Pick<Profile, "id" | "full_name" | "email" | "avatar_url">;
export const PERSON_REF_COLUMNS = "id, full_name, email, avatar_url" as const;

export type ProjectRef = Pick<Project, "id" | "title" | "status">;

/** A row in the triage queue. Deliberately narrower than a full ticket:
 *  the list renders thousands of these and never needs the description. */
export type TicketListRow = Pick<
  Ticket,
  | "id"
  | "ticket_number"
  | "title"
  | "type"
  | "priority"
  | "status"
  | "labels"
  | "created_at"
  | "updated_at"
  | "due_date"
  | "eta_date"
  | "sla_due_at"
  | "first_response_at"
  | "resolved_at"
  | "project_id"
> & {
  project: ProjectRef | null;
  reporter: PersonRef | null;
  assignee: PersonRef | null;
};

export type TicketDetail = Ticket & {
  project:
    | (ProjectRef & { github_repo: string | null; github_default_branch: string | null })
    | null;
  reporter: PersonRef | null;
  assignee: PersonRef | null;
};

export type CommentWithAuthor = TicketComment & { author: PersonRef | null };
export type EventWithActor = TicketEvent & { actor: PersonRef | null };
export type UpdateWithAuthor = ProjectUpdate & { author: PersonRef | null };
export type MemberWithProfile = ProjectMember & { profile: PersonRef | null };
export type QuoteWithLines = Quote & { quote_line_items: QuoteLineItem[] };
export type InvoiceWithLines = Invoice & {
  invoice_line_items: InvoiceLineItem[];
  payments: Payment[];
  quote?: Pick<Quote, "id" | "title"> | null;
};
export type MeetingWithActionItems = Meeting & { meeting_action_items: MeetingActionItem[] };
export type ProjectWithOrg = Project & { organization: Pick<Organization, "id" | "name"> | null };
export type TimeEntryWithRefs = TimeEntry & {
  ticket: Pick<Ticket, "id" | "ticket_number" | "title"> | null;
  user: PersonRef | null;
};
export type RelationWithTicket = TicketRelation & {
  to_ticket: Pick<Ticket, "id" | "ticket_number" | "title" | "status"> | null;
};

// AI Planner composite types
export type PlanAgentRef = Pick<PlanAgent, "id" | "name" | "provider" | "model">;
export type PlanProjectRef =
  | (Pick<Project, "id" | "title"> & {
      github_repo?: string | null;
      github_default_branch?: string | null;
    })
  | null;
export type PlanListItem = Plan & {
  project?: PlanProjectRef;
  section_count?: number;
  task_count?: number;
  done_task_count?: number;
};
export type PlanWithSections = Plan & {
  project?: PlanProjectRef;
  sections: (PlanSection & { tasks: TaskWithAgent[] })[];
};
export type TaskWithAgent = PlanTask & {
  assigned_agent: PlanAgentRef | null;
  assigned_user?: PersonRef | null;
  ticket?: Pick<Ticket, "id" | "ticket_number" | "title" | "status"> | null;
};
export type TaskWithComments = PlanTask & {
  plan_task_comments: (PlanTaskComment & {
    author: PersonRef | null;
    agent: PlanAgentRef | null;
  })[];
  assigned_agent: PlanAgentRef | null;
};
export type EventWithRefs = PlanEvent & {
  actor: PersonRef | null;
  agent: PlanAgentRef | null;
};

/** One page of a keyset-paginated list. */
export type Page<T> = { rows: T[]; nextCursor: string | null };

export const PAGE_SIZE = 40;
