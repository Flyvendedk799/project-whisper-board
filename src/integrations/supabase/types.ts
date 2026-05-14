export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_summaries: {
        Row: {
          created_at: string
          id: string
          source_hash: string | null
          subject_id: string
          subject_type: string
          summary: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_hash?: string | null
          subject_id: string
          subject_type: string
          summary: string
        }
        Update: {
          created_at?: string
          id?: string
          source_hash?: string | null
          subject_id?: string
          subject_type?: string
          summary?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          due_date: string | null
          id: string
          milestone_id: string | null
          number: string | null
          paid_at: string | null
          project_id: string
          status: Database["public"]["Enums"]["invoice_status"]
          stripe_payment_intent: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          milestone_id?: string | null
          number?: string | null
          paid_at?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_payment_intent?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          milestone_id?: string | null
          number?: string | null
          paid_at?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_payment_intent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_action_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          meeting_id: string
          status: Database["public"]["Enums"]["action_item_status"]
          ticket_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          meeting_id: string
          status?: Database["public"]["Enums"]["action_item_status"]
          ticket_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          meeting_id?: string
          status?: Database["public"]["Enums"]["action_item_status"]
          ticket_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_action_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_action_items_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          agenda: string | null
          ai_summary: string | null
          created_at: string
          duration_minutes: number | null
          id: string
          meeting_url: string | null
          notes: string | null
          project_id: string
          scheduled_at: string
          status: Database["public"]["Enums"]["meeting_status"]
          title: string
          updated_at: string
        }
        Insert: {
          agenda?: string | null
          ai_summary?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          meeting_url?: string | null
          notes?: string | null
          project_id: string
          scheduled_at: string
          status?: Database["public"]["Enums"]["meeting_status"]
          title: string
          updated_at?: string
        }
        Update: {
          agenda?: string | null
          ai_summary?: string | null
          created_at?: string
          duration_minutes?: number | null
          id?: string
          meeting_url?: string | null
          notes?: string | null
          project_id?: string
          scheduled_at?: string
          status?: Database["public"]["Enums"]["meeting_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          amount_cents: number | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          position: number
          project_id: string
          status: Database["public"]["Enums"]["milestone_status"]
          title: string
        }
        Insert: {
          amount_cents?: number | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          position?: number
          project_id: string
          status?: Database["public"]["Enums"]["milestone_status"]
          title: string
        }
        Update: {
          amount_cents?: number | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          position?: number
          project_id?: string
          status?: Database["public"]["Enums"]["milestone_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          notes: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          notes?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_updates: {
        Row: {
          author_id: string | null
          body: string | null
          created_at: string
          data: Json | null
          id: string
          kind: Database["public"]["Enums"]["update_kind"]
          project_id: string
          title: string | null
        }
        Insert: {
          author_id?: string | null
          body?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          kind?: Database["public"]["Enums"]["update_kind"]
          project_id: string
          title?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          kind?: Database["public"]["Enums"]["update_kind"]
          project_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget_cents: number | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          end_date: string | null
          hourly_rate_cents: number | null
          id: string
          organization_id: string | null
          progress: number
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          title: string
          updated_at: string
        }
        Insert: {
          budget_cents?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          end_date?: string | null
          hourly_rate_cents?: number | null
          id?: string
          organization_id?: string | null
          progress?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          title: string
          updated_at?: string
        }
        Update: {
          budget_cents?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          end_date?: string | null
          hourly_rate_cents?: number | null
          id?: string
          organization_id?: string | null
          progress?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_line_items: {
        Row: {
          description: string
          id: string
          position: number
          quantity: number
          quote_id: string
          unit_price_cents: number
        }
        Insert: {
          description: string
          id?: string
          position?: number
          quantity?: number
          quote_id: string
          unit_price_cents?: number
        }
        Update: {
          description?: string
          id?: string
          position?: number
          quantity?: number
          quote_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_line_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string
          currency: string
          id: string
          notes: string | null
          project_id: string
          responded_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal_cents: number
          title: string
          total_cents: number
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          project_id: string
          responded_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal_cents?: number
          title: string
          total_cents?: number
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          project_id?: string
          responded_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal_cents?: number
          title?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          is_recording: boolean
          mime_type: string | null
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          ticket_id: string
          uploader_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          is_recording?: boolean
          mime_type?: string | null
          size_bytes?: number | null
          storage_bucket: string
          storage_path: string
          ticket_id: string
          uploader_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          is_recording?: boolean
          mime_type?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          ticket_id?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          is_internal: boolean
          ticket_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          is_internal?: boolean
          ticket_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_events: {
        Row: {
          actor_id: string | null
          created_at: string
          data: Json | null
          id: string
          kind: string
          ticket_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          kind: string
          ticket_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          kind?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          ai_screenshot_analysis: string | null
          ai_suggested_priority:
            | Database["public"]["Enums"]["ticket_priority"]
            | null
          ai_suggested_type: Database["public"]["Enums"]["ticket_type"] | null
          ai_summary: string | null
          assignee_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          estimate_hours: number | null
          eta_date: string | null
          id: string
          priority: Database["public"]["Enums"]["ticket_priority"]
          project_id: string
          reporter_id: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          title: string
          type: Database["public"]["Enums"]["ticket_type"]
          updated_at: string
        }
        Insert: {
          ai_screenshot_analysis?: string | null
          ai_suggested_priority?:
            | Database["public"]["Enums"]["ticket_priority"]
            | null
          ai_suggested_type?: Database["public"]["Enums"]["ticket_type"] | null
          ai_summary?: string | null
          assignee_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          estimate_hours?: number | null
          eta_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          project_id: string
          reporter_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          title: string
          type?: Database["public"]["Enums"]["ticket_type"]
          updated_at?: string
        }
        Update: {
          ai_screenshot_analysis?: string | null
          ai_suggested_priority?:
            | Database["public"]["Enums"]["ticket_priority"]
            | null
          ai_suggested_type?: Database["public"]["Enums"]["ticket_type"] | null
          ai_summary?: string | null
          assignee_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          estimate_hours?: number | null
          eta_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["ticket_priority"]
          project_id?: string
          reporter_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          title?: string
          type?: Database["public"]["Enums"]["ticket_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      action_item_status: "open" | "converted" | "done" | "dismissed"
      app_role: "admin" | "client_admin" | "client"
      invoice_status: "draft" | "sent" | "paid" | "overdue" | "void"
      meeting_status: "scheduled" | "completed" | "cancelled"
      milestone_status: "pending" | "in_progress" | "done"
      notification_kind:
        | "mention"
        | "ticket_update"
        | "comment"
        | "milestone"
        | "invoice"
        | "meeting"
      project_status:
        | "discovery"
        | "proposal"
        | "in_progress"
        | "review"
        | "done"
        | "archived"
      quote_status: "draft" | "sent" | "accepted" | "declined" | "expired"
      ticket_priority: "low" | "medium" | "high" | "urgent"
      ticket_status:
        | "open"
        | "triaged"
        | "in_progress"
        | "in_review"
        | "done"
        | "wont_fix"
      ticket_type:
        | "bug"
        | "feature"
        | "question"
        | "feedback"
        | "change_request"
      update_kind:
        | "post"
        | "ticket_opened"
        | "ticket_closed"
        | "milestone_done"
        | "meeting_held"
        | "invoice_paid"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      action_item_status: ["open", "converted", "done", "dismissed"],
      app_role: ["admin", "client_admin", "client"],
      invoice_status: ["draft", "sent", "paid", "overdue", "void"],
      meeting_status: ["scheduled", "completed", "cancelled"],
      milestone_status: ["pending", "in_progress", "done"],
      notification_kind: [
        "mention",
        "ticket_update",
        "comment",
        "milestone",
        "invoice",
        "meeting",
      ],
      project_status: [
        "discovery",
        "proposal",
        "in_progress",
        "review",
        "done",
        "archived",
      ],
      quote_status: ["draft", "sent", "accepted", "declined", "expired"],
      ticket_priority: ["low", "medium", "high", "urgent"],
      ticket_status: [
        "open",
        "triaged",
        "in_progress",
        "in_review",
        "done",
        "wont_fix",
      ],
      ticket_type: ["bug", "feature", "question", "feedback", "change_request"],
      update_kind: [
        "post",
        "ticket_opened",
        "ticket_closed",
        "milestone_done",
        "meeting_held",
        "invoice_paid",
      ],
    },
  },
} as const
