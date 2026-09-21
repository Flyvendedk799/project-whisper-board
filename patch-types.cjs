const fs = require("fs");

const typesPath = "src/integrations/supabase/types.ts";
let content = fs.readFileSync(typesPath, "utf8");

const tablesInsert = `
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      }
      plan_agents: {
        Row: {
          api_key_id: string | null
          capabilities: string[]
          created_at: string
          id: string
          is_active: boolean
          last_seen_at: string | null
          metadata: Json
          model: string | null
          name: string
          provider: string
          workspace_id: string
        }
        Insert: {
          api_key_id?: string | null
          capabilities?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          metadata?: Json
          model?: string | null
          name: string
          provider: string
          workspace_id: string
        }
        Update: {
          api_key_id?: string | null
          capabilities?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          metadata?: Json
          model?: string | null
          name?: string
          provider?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_agents_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      }
      plan_events: {
        Row: {
          actor_id: string | null
          agent_id: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["plan_event_kind"]
          metadata: Json
          new_value: string | null
          old_value: string | null
          plan_id: string
          task_id: string | null
        }
        Insert: {
          actor_id?: string | null
          agent_id?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["plan_event_kind"]
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          plan_id: string
          task_id?: string | null
        }
        Update: {
          actor_id?: string | null
          agent_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["plan_event_kind"]
          metadata?: Json
          new_value?: string | null
          old_value?: string | null
          plan_id?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "plan_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "plan_tasks"
            referencedColumns: ["id"]
          }
        ]
      }
      plan_sections: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          plan_id: string
          position: number
          title: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          plan_id: string
          position?: number
          title: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          plan_id?: string
          position?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_sections_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          }
        ]
      }
      plan_task_comments: {
        Row: {
          agent_id: string | null
          author_id: string | null
          body: string
          created_at: string
          id: string
          metadata: Json
          task_id: string
        }
        Insert: {
          agent_id?: string | null
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          metadata?: Json
          task_id: string
        }
        Update: {
          agent_id?: string | null
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          metadata?: Json
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_task_comments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "plan_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "plan_tasks"
            referencedColumns: ["id"]
          }
        ]
      }
      plan_tasks: {
        Row: {
          acceptance_criteria: string | null
          actual_minutes: number | null
          assigned_agent_id: string | null
          assigned_user_id: string | null
          branch_name: string | null
          claimed_at: string | null
          completed_at: string | null
          complexity: Database["public"]["Enums"]["plan_task_complexity"]
          context_files: string[]
          created_at: string
          depends_on: string[]
          description: string | null
          estimated_minutes: number | null
          id: string
          labels: string[]
          plan_id: string
          position: number
          preferred_models: string[]
          preferred_providers: string[]
          pr_number: number | null
          pr_status: string | null
          pr_url: string | null
          priority: Database["public"]["Enums"]["plan_task_priority"]
          section_id: string
          status: Database["public"]["Enums"]["plan_task_status"]
          ticket_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          acceptance_criteria?: string | null
          actual_minutes?: number | null
          assigned_agent_id?: string | null
          assigned_user_id?: string | null
          branch_name?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          complexity?: Database["public"]["Enums"]["plan_task_complexity"]
          context_files?: string[]
          created_at?: string
          depends_on?: string[]
          description?: string | null
          estimated_minutes?: number | null
          id?: string
          labels?: string[]
          plan_id: string
          position?: number
          preferred_models?: string[]
          preferred_providers?: string[]
          pr_number?: number | null
          pr_status?: string | null
          pr_url?: string | null
          priority?: Database["public"]["Enums"]["plan_task_priority"]
          section_id: string
          status?: Database["public"]["Enums"]["plan_task_status"]
          ticket_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          acceptance_criteria?: string | null
          actual_minutes?: number | null
          assigned_agent_id?: string | null
          assigned_user_id?: string | null
          branch_name?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          complexity?: Database["public"]["Enums"]["plan_task_complexity"]
          context_files?: string[]
          created_at?: string
          depends_on?: string[]
          description?: string | null
          estimated_minutes?: number | null
          id?: string
          labels?: string[]
          plan_id?: string
          position?: number
          preferred_models?: string[]
          preferred_providers?: string[]
          pr_number?: number | null
          pr_status?: string | null
          pr_url?: string | null
          priority?: Database["public"]["Enums"]["plan_task_priority"]
          section_id?: string
          status?: Database["public"]["Enums"]["plan_task_status"]
          ticket_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_tasks_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "plan_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_tasks_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_tasks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_tasks_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "plan_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_tasks_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          }
        ]
      }
      plan_followers: {
        Row: {
          plan_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          plan_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          plan_id?: string
          user_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_followers_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_followers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      plans: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          github_base: string | null
          github_repo: string | null
          id: string
          project_id: string | null
          status: Database["public"]["Enums"]["plan_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          github_base?: string | null
          github_repo?: string | null
          id?: string
          project_id?: string | null
          status?: Database["public"]["Enums"]["plan_status"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          github_base?: string | null
          github_repo?: string | null
          id?: string
          project_id?: string | null
          status?: Database["public"]["Enums"]["plan_status"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          }
        ]
      }
`;

const enumsInsert = `
      plan_event_kind:
        | "task_created"
        | "task_updated"
        | "task_claimed"
        | "task_unclaimed"
        | "task_started"
        | "task_completed"
        | "task_blocked"
        | "task_reviewed"
        | "pr_opened"
        | "pr_merged"
        | "pr_closed"
        | "section_created"
        | "section_updated"
        | "plan_created"
        | "plan_activated"
        | "plan_completed"
        | "agent_registered"
        | "agent_deactivated"
        | "comment_added"
      plan_status: "draft" | "active" | "paused" | "completed" | "archived"
      plan_task_complexity: "trivial" | "small" | "medium" | "large" | "epic"
      plan_task_priority: "low" | "medium" | "high" | "critical"
      plan_task_status:
        | "backlog"
        | "available"
        | "claimed"
        | "in_progress"
        | "in_review"
        | "done"
        | "blocked"
`;

content = content.replace(/ {6}\}\r?\n {4}\}\r?\n {4}Views: \{/, '      }\n' + tablesInsert + '    }\n    Views: {');
content = content.replace("    Enums: {", "    Enums: {" + enumsInsert);

fs.writeFileSync(typesPath, content, "utf8");
console.log("Successfully patched types.ts");
