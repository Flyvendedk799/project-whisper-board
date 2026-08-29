export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ai_summaries: {
        Row: {
          created_at: string;
          id: string;
          source_hash: string | null;
          subject_id: string;
          subject_type: string;
          summary: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          source_hash?: string | null;
          subject_id: string;
          subject_type: string;
          summary: string;
          workspace_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          source_hash?: string | null;
          subject_id?: string;
          subject_type?: string;
          summary?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_summaries_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      app_errors: {
        Row: {
          context: Json | null;
          fingerprint: string;
          id: string;
          message: string;
          occurred_at: string;
          release: string | null;
          severity: string;
          side: string;
          stack: string | null;
          url: string | null;
          user_id: string | null;
          workspace_id: string | null;
        };
        Insert: {
          context?: Json | null;
          fingerprint: string;
          id?: string;
          message: string;
          occurred_at?: string;
          release?: string | null;
          severity?: string;
          side?: string;
          stack?: string | null;
          url?: string | null;
          user_id?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          context?: Json | null;
          fingerprint?: string;
          id?: string;
          message?: string;
          occurred_at?: string;
          release?: string | null;
          severity?: string;
          side?: string;
          stack?: string | null;
          url?: string | null;
          user_id?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "app_errors_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "app_errors_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_line_items: {
        Row: {
          description: string;
          id: string;
          invoice_id: string;
          position: number;
          quantity: number;
          unit_price_cents: number;
          workspace_id: string;
        };
        Insert: {
          description: string;
          id?: string;
          invoice_id: string;
          position?: number;
          quantity?: number;
          unit_price_cents?: number;
          workspace_id?: string;
        };
        Update: {
          description?: string;
          id?: string;
          invoice_id?: string;
          position?: number;
          quantity?: number;
          unit_price_cents?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_line_items_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          due_date: string | null;
          id: string;
          issued_at: string | null;
          milestone_id: string | null;
          notes: string | null;
          number: string | null;
          paid_at: string | null;
          payment_link: string | null;
          project_id: string;
          quote_id: string | null;
          status: Database["public"]["Enums"]["invoice_status"];
          stripe_payment_intent: string | null;
          subtotal_cents: number;
          tax_bps: number;
          workspace_id: string;
        };
        Insert: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          due_date?: string | null;
          id?: string;
          issued_at?: string | null;
          milestone_id?: string | null;
          notes?: string | null;
          number?: string | null;
          paid_at?: string | null;
          payment_link?: string | null;
          project_id: string;
          quote_id?: string | null;
          status?: Database["public"]["Enums"]["invoice_status"];
          stripe_payment_intent?: string | null;
          subtotal_cents?: number;
          tax_bps?: number;
          workspace_id?: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          due_date?: string | null;
          id?: string;
          issued_at?: string | null;
          milestone_id?: string | null;
          notes?: string | null;
          number?: string | null;
          paid_at?: string | null;
          payment_link?: string | null;
          project_id?: string;
          quote_id?: string | null;
          status?: Database["public"]["Enums"]["invoice_status"];
          stripe_payment_intent?: string | null;
          subtotal_cents?: number;
          tax_bps?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_milestone_id_fkey";
            columns: ["milestone_id"];
            isOneToOne: false;
            referencedRelation: "milestones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      meeting_action_items: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          meeting_id: string;
          status: Database["public"]["Enums"]["action_item_status"];
          ticket_id: string | null;
          title: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          meeting_id: string;
          status?: Database["public"]["Enums"]["action_item_status"];
          ticket_id?: string | null;
          title: string;
          workspace_id?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          meeting_id?: string;
          status?: Database["public"]["Enums"]["action_item_status"];
          ticket_id?: string | null;
          title?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meeting_action_items_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meeting_action_items_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meeting_action_items_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      meetings: {
        Row: {
          agenda: string | null;
          ai_summary: string | null;
          created_at: string;
          duration_minutes: number | null;
          id: string;
          meeting_url: string | null;
          notes: string | null;
          project_id: string;
          scheduled_at: string;
          status: Database["public"]["Enums"]["meeting_status"];
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          agenda?: string | null;
          ai_summary?: string | null;
          created_at?: string;
          duration_minutes?: number | null;
          id?: string;
          meeting_url?: string | null;
          notes?: string | null;
          project_id: string;
          scheduled_at: string;
          status?: Database["public"]["Enums"]["meeting_status"];
          title: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Update: {
          agenda?: string | null;
          ai_summary?: string | null;
          created_at?: string;
          duration_minutes?: number | null;
          id?: string;
          meeting_url?: string | null;
          notes?: string | null;
          project_id?: string;
          scheduled_at?: string;
          status?: Database["public"]["Enums"]["meeting_status"];
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meetings_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meetings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      milestones: {
        Row: {
          amount_cents: number | null;
          completed_at: string | null;
          created_at: string;
          description: string | null;
          due_date: string | null;
          id: string;
          position: number;
          project_id: string;
          status: Database["public"]["Enums"]["milestone_status"];
          title: string;
          workspace_id: string;
        };
        Insert: {
          amount_cents?: number | null;
          completed_at?: string | null;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          position?: number;
          project_id: string;
          status?: Database["public"]["Enums"]["milestone_status"];
          title: string;
          workspace_id?: string;
        };
        Update: {
          amount_cents?: number | null;
          completed_at?: string | null;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          position?: number;
          project_id?: string;
          status?: Database["public"]["Enums"]["milestone_status"];
          title?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "milestones_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          channels: Json;
          digest_frequency: string;
          quiet_hours_end: number | null;
          quiet_hours_start: number | null;
          timezone: string;
          updated_at: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          channels?: Json;
          digest_frequency?: string;
          quiet_hours_end?: number | null;
          quiet_hours_start?: number | null;
          timezone?: string;
          updated_at?: string;
          user_id: string;
          workspace_id?: string;
        };
        Update: {
          channels?: Json;
          digest_frequency?: string;
          quiet_hours_end?: number | null;
          quiet_hours_start?: number | null;
          timezone?: string;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_preferences_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["notification_kind"];
          link: string | null;
          read_at: string | null;
          title: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["notification_kind"];
          link?: string | null;
          read_at?: string | null;
          title: string;
          user_id: string;
          workspace_id?: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["notification_kind"];
          link?: string | null;
          read_at?: string | null;
          title?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          logo_url: string | null;
          name: string;
          notes: string | null;
          updated_at: string;
          website: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          logo_url?: string | null;
          name: string;
          notes?: string | null;
          updated_at?: string;
          website?: string | null;
          workspace_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          logo_url?: string | null;
          name?: string;
          notes?: string | null;
          updated_at?: string;
          website?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organizations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      outbound_messages: {
        Row: {
          body_html: string | null;
          body_text: string | null;
          channel: string;
          created_at: string;
          error: string | null;
          id: string;
          provider: string | null;
          provider_message_id: string | null;
          related_id: string | null;
          related_type: string | null;
          scheduled_for: string | null;
          sent_at: string | null;
          status: Database["public"]["Enums"]["outbound_status"];
          subject: string | null;
          template: string;
          to_address: string;
          to_user_id: string | null;
          workspace_id: string;
        };
        Insert: {
          body_html?: string | null;
          body_text?: string | null;
          channel?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          provider?: string | null;
          provider_message_id?: string | null;
          related_id?: string | null;
          related_type?: string | null;
          scheduled_for?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["outbound_status"];
          subject?: string | null;
          template: string;
          to_address: string;
          to_user_id?: string | null;
          workspace_id?: string;
        };
        Update: {
          body_html?: string | null;
          body_text?: string | null;
          channel?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          provider?: string | null;
          provider_message_id?: string | null;
          related_id?: string | null;
          related_type?: string | null;
          scheduled_for?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["outbound_status"];
          subject?: string | null;
          template?: string;
          to_address?: string;
          to_user_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "outbound_messages_to_user_id_fkey";
            columns: ["to_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "outbound_messages_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          id: string;
          invoice_id: string;
          paid_at: string;
          provider: string;
          provider_ref: string | null;
          recorded_by: string | null;
          status: string;
          workspace_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency?: string;
          id?: string;
          invoice_id: string;
          paid_at?: string;
          provider?: string;
          provider_ref?: string | null;
          recorded_by?: string | null;
          status?: string;
          workspace_id?: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          invoice_id?: string;
          paid_at?: string;
          provider?: string;
          provider_ref?: string | null;
          recorded_by?: string | null;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          company: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          company?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          company?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      project_members: {
        Row: {
          created_at: string;
          id: string;
          project_id: string;
          role: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          project_id: string;
          role?: string;
          user_id: string;
          workspace_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          project_id?: string;
          role?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      project_updates: {
        Row: {
          author_id: string | null;
          body: string | null;
          created_at: string;
          data: Json | null;
          id: string;
          kind: Database["public"]["Enums"]["update_kind"];
          project_id: string;
          title: string | null;
          workspace_id: string;
        };
        Insert: {
          author_id?: string | null;
          body?: string | null;
          created_at?: string;
          data?: Json | null;
          id?: string;
          kind?: Database["public"]["Enums"]["update_kind"];
          project_id: string;
          title?: string | null;
          workspace_id?: string;
        };
        Update: {
          author_id?: string | null;
          body?: string | null;
          created_at?: string;
          data?: Json | null;
          id?: string;
          kind?: Database["public"]["Enums"]["update_kind"];
          project_id?: string;
          title?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_updates_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_updates_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_updates_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          budget_cents: number | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          description: string | null;
          end_date: string | null;
          hourly_rate_cents: number | null;
          id: string;
          organization_id: string | null;
          progress: number;
          start_date: string | null;
          status: Database["public"]["Enums"]["project_status"];
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          budget_cents?: number | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string | null;
          end_date?: string | null;
          hourly_rate_cents?: number | null;
          id?: string;
          organization_id?: string | null;
          progress?: number;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          title: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Update: {
          budget_cents?: number | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string | null;
          end_date?: string | null;
          hourly_rate_cents?: number | null;
          id?: string;
          organization_id?: string | null;
          progress?: number;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_line_items: {
        Row: {
          description: string;
          id: string;
          position: number;
          quantity: number;
          quote_id: string;
          unit_price_cents: number;
          workspace_id: string;
        };
        Insert: {
          description: string;
          id?: string;
          position?: number;
          quantity?: number;
          quote_id: string;
          unit_price_cents?: number;
          workspace_id?: string;
        };
        Update: {
          description?: string;
          id?: string;
          position?: number;
          quantity?: number;
          quote_id?: string;
          unit_price_cents?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_line_items_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_line_items_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      quotes: {
        Row: {
          created_at: string;
          currency: string;
          id: string;
          notes: string | null;
          project_id: string;
          responded_at: string | null;
          sent_at: string | null;
          status: Database["public"]["Enums"]["quote_status"];
          subtotal_cents: number;
          title: string;
          total_cents: number;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          id?: string;
          notes?: string | null;
          project_id: string;
          responded_at?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["quote_status"];
          subtotal_cents?: number;
          title: string;
          total_cents?: number;
          workspace_id?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          id?: string;
          notes?: string | null;
          project_id?: string;
          responded_at?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["quote_status"];
          subtotal_cents?: number;
          title?: string;
          total_cents?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_views: {
        Row: {
          created_at: string;
          filters: Json;
          icon: string | null;
          id: string;
          is_shared: boolean;
          name: string;
          owner_id: string;
          position: number;
          scope: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          filters?: Json;
          icon?: string | null;
          id?: string;
          is_shared?: boolean;
          name: string;
          owner_id: string;
          position?: number;
          scope?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Update: {
          created_at?: string;
          filters?: Json;
          icon?: string | null;
          id?: string;
          is_shared?: boolean;
          name?: string;
          owner_id?: string;
          position?: number;
          scope?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_views_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_views_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sla_policies: {
        Row: {
          first_response_minutes: number;
          id: string;
          priority: Database["public"]["Enums"]["ticket_priority"];
          resolution_minutes: number;
          workspace_id: string;
        };
        Insert: {
          first_response_minutes: number;
          id?: string;
          priority: Database["public"]["Enums"]["ticket_priority"];
          resolution_minutes: number;
          workspace_id?: string;
        };
        Update: {
          first_response_minutes?: number;
          id?: string;
          priority?: Database["public"]["Enums"]["ticket_priority"];
          resolution_minutes?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sla_policies_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_attachments: {
        Row: {
          annotations: Json | null;
          checksum: string | null;
          created_at: string;
          duration_ms: number | null;
          file_name: string;
          has_audio: boolean | null;
          height: number | null;
          id: string;
          is_recording: boolean;
          kind: string;
          mime_type: string | null;
          size_bytes: number | null;
          source_attachment_id: string | null;
          storage_bucket: string;
          storage_path: string;
          thumbnail_path: string | null;
          ticket_id: string;
          uploader_id: string;
          width: number | null;
          workspace_id: string;
        };
        Insert: {
          annotations?: Json | null;
          checksum?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          file_name: string;
          has_audio?: boolean | null;
          height?: number | null;
          id?: string;
          is_recording?: boolean;
          kind?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          source_attachment_id?: string | null;
          storage_bucket: string;
          storage_path: string;
          thumbnail_path?: string | null;
          ticket_id: string;
          uploader_id: string;
          width?: number | null;
          workspace_id?: string;
        };
        Update: {
          annotations?: Json | null;
          checksum?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          file_name?: string;
          has_audio?: boolean | null;
          height?: number | null;
          id?: string;
          is_recording?: boolean;
          kind?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          source_attachment_id?: string | null;
          storage_bucket?: string;
          storage_path?: string;
          thumbnail_path?: string | null;
          ticket_id?: string;
          uploader_id?: string;
          width?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_source_attachment_id_fkey";
            columns: ["source_attachment_id"];
            isOneToOne: false;
            referencedRelation: "ticket_attachments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_attachments_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_attachments_uploader_id_fkey";
            columns: ["uploader_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_attachments_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_capture_context: {
        Row: {
          app_version: string | null;
          browser: string | null;
          browser_version: string | null;
          console_log: Json | null;
          created_at: string;
          device_type: string | null;
          dpr: number | null;
          extra: Json | null;
          locale: string | null;
          network_errors: Json | null;
          online: boolean | null;
          os: string | null;
          page_title: string | null;
          referrer: string | null;
          screen_h: number | null;
          screen_w: number | null;
          ticket_id: string;
          timezone: string | null;
          url: string | null;
          user_agent: string | null;
          viewport_h: number | null;
          viewport_w: number | null;
          workspace_id: string;
        };
        Insert: {
          app_version?: string | null;
          browser?: string | null;
          browser_version?: string | null;
          console_log?: Json | null;
          created_at?: string;
          device_type?: string | null;
          dpr?: number | null;
          extra?: Json | null;
          locale?: string | null;
          network_errors?: Json | null;
          online?: boolean | null;
          os?: string | null;
          page_title?: string | null;
          referrer?: string | null;
          screen_h?: number | null;
          screen_w?: number | null;
          ticket_id: string;
          timezone?: string | null;
          url?: string | null;
          user_agent?: string | null;
          viewport_h?: number | null;
          viewport_w?: number | null;
          workspace_id?: string;
        };
        Update: {
          app_version?: string | null;
          browser?: string | null;
          browser_version?: string | null;
          console_log?: Json | null;
          created_at?: string;
          device_type?: string | null;
          dpr?: number | null;
          extra?: Json | null;
          locale?: string | null;
          network_errors?: Json | null;
          online?: boolean | null;
          os?: string | null;
          page_title?: string | null;
          referrer?: string | null;
          screen_h?: number | null;
          screen_w?: number | null;
          ticket_id?: string;
          timezone?: string | null;
          url?: string | null;
          user_agent?: string | null;
          viewport_h?: number | null;
          viewport_w?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_capture_context_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: true;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_capture_context_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_comments: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          is_internal: boolean;
          ticket_id: string;
          workspace_id: string;
        };
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          id?: string;
          is_internal?: boolean;
          ticket_id: string;
          workspace_id?: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          is_internal?: boolean;
          ticket_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_comments_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_comments_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          data: Json | null;
          field: string | null;
          id: string;
          kind: string;
          new_value: string | null;
          old_value: string | null;
          ticket_id: string;
          workspace_id: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          data?: Json | null;
          field?: string | null;
          id?: string;
          kind: string;
          new_value?: string | null;
          old_value?: string | null;
          ticket_id: string;
          workspace_id?: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          data?: Json | null;
          field?: string | null;
          id?: string;
          kind?: string;
          new_value?: string | null;
          old_value?: string | null;
          ticket_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_events_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_relations: {
        Row: {
          created_at: string;
          created_by: string | null;
          from_ticket_id: string;
          id: string;
          kind: Database["public"]["Enums"]["ticket_relation_kind"];
          to_ticket_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          from_ticket_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["ticket_relation_kind"];
          to_ticket_id: string;
          workspace_id?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          from_ticket_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["ticket_relation_kind"];
          to_ticket_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_relations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_relations_from_ticket_id_fkey";
            columns: ["from_ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_relations_to_ticket_id_fkey";
            columns: ["to_ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_relations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: {
          ai_screenshot_analysis: string | null;
          ai_suggested_priority: Database["public"]["Enums"]["ticket_priority"] | null;
          ai_suggested_type: Database["public"]["Enums"]["ticket_type"] | null;
          ai_summary: string | null;
          assignee_id: string | null;
          created_at: string;
          description: string | null;
          due_date: string | null;
          estimate_hours: number | null;
          eta_date: string | null;
          first_response_at: string | null;
          id: string;
          labels: string[];
          priority: Database["public"]["Enums"]["ticket_priority"];
          project_id: string;
          reopened_count: number;
          reporter_id: string | null;
          resolved_at: string | null;
          search_tsv: unknown | null;
          sla_due_at: string | null;
          status: Database["public"]["Enums"]["ticket_status"];
          ticket_number: number;
          title: string;
          type: Database["public"]["Enums"]["ticket_type"];
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          ai_screenshot_analysis?: string | null;
          ai_suggested_priority?: Database["public"]["Enums"]["ticket_priority"] | null;
          ai_suggested_type?: Database["public"]["Enums"]["ticket_type"] | null;
          ai_summary?: string | null;
          assignee_id?: string | null;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          estimate_hours?: number | null;
          eta_date?: string | null;
          first_response_at?: string | null;
          id?: string;
          labels?: string[];
          priority?: Database["public"]["Enums"]["ticket_priority"];
          project_id: string;
          reopened_count?: number;
          reporter_id?: string | null;
          resolved_at?: string | null;
          search_tsv?: unknown | null;
          sla_due_at?: string | null;
          status?: Database["public"]["Enums"]["ticket_status"];
          ticket_number?: number;
          title: string;
          type?: Database["public"]["Enums"]["ticket_type"];
          updated_at?: string;
          workspace_id?: string;
        };
        Update: {
          ai_screenshot_analysis?: string | null;
          ai_suggested_priority?: Database["public"]["Enums"]["ticket_priority"] | null;
          ai_suggested_type?: Database["public"]["Enums"]["ticket_type"] | null;
          ai_summary?: string | null;
          assignee_id?: string | null;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          estimate_hours?: number | null;
          eta_date?: string | null;
          first_response_at?: string | null;
          id?: string;
          labels?: string[];
          priority?: Database["public"]["Enums"]["ticket_priority"];
          project_id?: string;
          reopened_count?: number;
          reporter_id?: string | null;
          resolved_at?: string | null;
          search_tsv?: unknown | null;
          sla_due_at?: string | null;
          status?: Database["public"]["Enums"]["ticket_status"];
          ticket_number?: number;
          title?: string;
          type?: Database["public"]["Enums"]["ticket_type"];
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tickets_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      time_entries: {
        Row: {
          billable: boolean;
          created_at: string;
          duration_minutes: number | null;
          ended_at: string | null;
          id: string;
          invoice_id: string | null;
          note: string | null;
          project_id: string;
          rate_cents: number | null;
          started_at: string;
          ticket_id: string | null;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          billable?: boolean;
          created_at?: string;
          duration_minutes?: number | null;
          ended_at?: string | null;
          id?: string;
          invoice_id?: string | null;
          note?: string | null;
          project_id: string;
          rate_cents?: number | null;
          started_at?: string;
          ticket_id?: string | null;
          user_id: string;
          workspace_id?: string;
        };
        Update: {
          billable?: boolean;
          created_at?: string;
          duration_minutes?: number | null;
          ended_at?: string | null;
          id?: string;
          invoice_id?: string | null;
          note?: string | null;
          project_id?: string;
          rate_cents?: number | null;
          started_at?: string;
          ticket_id?: string | null;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_entries_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
          workspace_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_roles_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          brand_color: string | null;
          created_at: string;
          id: string;
          invoice_prefix: string;
          invoice_seq: number;
          logo_url: string | null;
          name: string;
          settings: Json;
          slug: string;
          support_email: string | null;
          ticket_seq: number;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          brand_color?: string | null;
          created_at?: string;
          id?: string;
          invoice_prefix?: string;
          invoice_seq?: number;
          logo_url?: string | null;
          name: string;
          settings?: Json;
          slug: string;
          support_email?: string | null;
          ticket_seq?: number;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          brand_color?: string | null;
          created_at?: string;
          id?: string;
          invoice_prefix?: string;
          invoice_seq?: number;
          logo_url?: string | null;
          name?: string;
          settings?: Json;
          slug?: string;
          support_email?: string | null;
          ticket_seq?: number;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: { _user_id: string; _role: Database["public"]["Enums"]["app_role"] };
        Returns: boolean;
      };
      is_admin: {
        Args: { _user_id: string };
        Returns: boolean;
      };
      is_project_member: {
        Args: { _project_id: string; _user_id: string };
        Returns: boolean;
      };
      is_workspace_admin: {
        Args: { _workspace_id: string; _user_id: string };
        Returns: boolean;
      };
      recompute_project_progress: {
        Args: { _project_id: string };
        Returns: undefined;
      };
      user_workspace_ids: {
        Args: { _user_id: string };
        Returns: string[];
      };
    };
    Enums: {
      action_item_status: "open" | "converted" | "done" | "dismissed";
      app_role: "admin" | "client_admin" | "client";
      invoice_status: "draft" | "sent" | "paid" | "overdue" | "void";
      meeting_status: "scheduled" | "completed" | "cancelled";
      milestone_status: "pending" | "in_progress" | "done";
      notification_kind:
        | "mention"
        | "ticket_update"
        | "comment"
        | "milestone"
        | "invoice"
        | "meeting";
      outbound_status: "queued" | "sent" | "skipped" | "failed";
      project_status: "discovery" | "proposal" | "in_progress" | "review" | "done" | "archived";
      quote_status: "draft" | "sent" | "accepted" | "declined" | "expired";
      ticket_priority: "low" | "medium" | "high" | "urgent";
      ticket_relation_kind: "duplicate_of" | "blocks" | "blocked_by" | "relates_to" | "parent_of";
      ticket_status: "open" | "triaged" | "in_progress" | "in_review" | "done" | "wont_fix";
      ticket_type: "bug" | "feature" | "question" | "feedback" | "change_request";
      update_kind:
        | "post"
        | "ticket_opened"
        | "ticket_closed"
        | "milestone_done"
        | "meeting_held"
        | "invoice_paid";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      action_item_status: ["open", "converted", "done", "dismissed"],
      app_role: ["admin", "client_admin", "client"],
      invoice_status: ["draft", "sent", "paid", "overdue", "void"],
      meeting_status: ["scheduled", "completed", "cancelled"],
      milestone_status: ["pending", "in_progress", "done"],
      notification_kind: ["mention", "ticket_update", "comment", "milestone", "invoice", "meeting"],
      outbound_status: ["queued", "sent", "skipped", "failed"],
      project_status: ["discovery", "proposal", "in_progress", "review", "done", "archived"],
      quote_status: ["draft", "sent", "accepted", "declined", "expired"],
      ticket_priority: ["low", "medium", "high", "urgent"],
      ticket_relation_kind: ["duplicate_of", "blocks", "blocked_by", "relates_to", "parent_of"],
      ticket_status: ["open", "triaged", "in_progress", "in_review", "done", "wont_fix"],
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
} as const;
