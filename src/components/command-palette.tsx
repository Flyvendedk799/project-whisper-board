import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bug,
  BarChart3,
  BrainCircuit,
  Building2,
  Clock,
  FolderKanban,
  Home,
  Inbox,
  Keyboard,
  ListFilter,
  Moon,
  Plus,
  Settings,
  Sun,
  Ticket,
  Users,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/components/auth-provider";
import { useTheme } from "@/components/theme-provider";
import { useHotkeys, SHORTCUTS } from "@/lib/use-hotkeys";
import { ticketSearchQuery } from "@/data/tickets";
import { projectSearchQuery } from "@/data/projects";
import { TICKET_STATUS_LABEL } from "@/data/enums";

/**
 * ⌘K.
 *
 * Doubles as global search: typing two characters starts searching tickets and
 * projects in Postgres, so the palette answers "where is that thing" as well as
 * "do that thing". `cmdk` and the command primitives were already installed and
 * completely unused.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [term, setTerm] = useState("");
  const navigate = useNavigate();
  const { isAdmin, workspaceId } = useAuth();
  const { resolved, toggle } = useTheme();

  // Debounced: the palette fires on every keystroke otherwise.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 180);
    return () => clearTimeout(id);
  }, [term]);

  const tickets = useQuery({
    ...ticketSearchQuery(debounced, workspaceId),
    enabled: open && Boolean(workspaceId) && debounced.length >= 2,
  });
  const projects = useQuery({
    ...projectSearchQuery(debounced, workspaceId),
    enabled: open && Boolean(workspaceId) && debounced.length >= 2,
  });

  useHotkeys({
    "mod+k": () => setOpen((value) => !value),
    "?": () => setShortcutsOpen(true),
    "g h": () => void navigate({ to: "/app" }),
    "g t": () => void navigate({ to: isAdmin ? "/app/triage" : "/app/tickets" }),
    "g p": () => void navigate({ to: "/app/projects" }),
    "g i": () => void navigate({ to: "/app/inbox" }),
    "g s": () => void navigate({ to: "/app/settings" }),
    c: () => void navigate({ to: "/app/report" }),
  });

  const run = (action: () => void) => {
    setOpen(false);
    setTerm("");
    action();
  };

  const groups = useMemo(
    () =>
      SHORTCUTS.reduce<Record<string, typeof SHORTCUTS>>((acc, shortcut) => {
        (acc[shortcut.group] ??= []).push(shortcut);
        return acc;
      }, {}),
    [],
  );

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Find anything">
        <CommandInput
          placeholder="Search tickets, projects, or type a command…"
          value={term}
          onValueChange={setTerm}
        />
        <CommandList>
          <CommandEmpty>
            {debounced.length >= 2 ? "Nothing matched." : "Keep typing to search."}
          </CommandEmpty>

          {(tickets.data?.length ?? 0) > 0 && (
            <CommandGroup heading="Tickets">
              {tickets.data!.map((ticket) => (
                <CommandItem
                  key={ticket.id}
                  value={`ticket-${ticket.id}-${ticket.title}`}
                  onSelect={() =>
                    run(
                      () =>
                        void navigate({
                          to: "/app/tickets/$ticketId",
                          params: { ticketId: ticket.id },
                        }),
                    )
                  }
                >
                  <Ticket className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
                  <CommandShortcut>
                    #{ticket.ticket_number} · {TICKET_STATUS_LABEL[ticket.status]}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {(projects.data?.length ?? 0) > 0 && (
            <CommandGroup heading="Projects">
              {projects.data!.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`project-${project.id}-${project.title}`}
                  onSelect={() =>
                    run(
                      () =>
                        void navigate({
                          to: "/app/projects/$projectId",
                          params: { projectId: project.id },
                        }),
                    )
                  }
                >
                  <FolderKanban className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{project.title}</span>
                  <CommandShortcut>{project.progress}%</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandSeparator />

          <CommandGroup heading="Go to">
            <CommandItem value="home" onSelect={() => run(() => void navigate({ to: "/app" }))}>
              <Home className="mr-2 h-4 w-4" aria-hidden="true" />
              Home
              <CommandShortcut>g h</CommandShortcut>
            </CommandItem>
            {isAdmin ? (
              <CommandItem
                value="triage"
                onSelect={() => run(() => void navigate({ to: "/app/triage" }))}
              >
                <ListFilter className="mr-2 h-4 w-4" aria-hidden="true" />
                Triage queue
                <CommandShortcut>g t</CommandShortcut>
              </CommandItem>
            ) : (
              <CommandItem
                value="my-tickets"
                onSelect={() => run(() => void navigate({ to: "/app/tickets" }))}
              >
                <Ticket className="mr-2 h-4 w-4" aria-hidden="true" />
                My tickets
                <CommandShortcut>g t</CommandShortcut>
              </CommandItem>
            )}
            <CommandItem
              value="projects"
              onSelect={() => run(() => void navigate({ to: "/app/projects" }))}
            >
              <FolderKanban className="mr-2 h-4 w-4" aria-hidden="true" />
              Projects
              <CommandShortcut>g p</CommandShortcut>
            </CommandItem>
            <CommandItem
              value="inbox"
              onSelect={() => run(() => void navigate({ to: "/app/inbox" }))}
            >
              <Inbox className="mr-2 h-4 w-4" aria-hidden="true" />
              Inbox
              <CommandShortcut>g i</CommandShortcut>
            </CommandItem>
            {isAdmin && (
              <>
                <CommandItem
                  value="clients"
                  onSelect={() => run(() => void navigate({ to: "/app/organizations" }))}
                >
                  <Building2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Clients
                </CommandItem>
                <CommandItem
                  value="time"
                  onSelect={() => run(() => void navigate({ to: "/app/time" }))}
                >
                  <Clock className="mr-2 h-4 w-4" aria-hidden="true" />
                  Time
                </CommandItem>
                <CommandItem
                  value="reports"
                  onSelect={() => run(() => void navigate({ to: "/app/reports" }))}
                >
                  <BarChart3 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Reports
                </CommandItem>
                <CommandItem
                  value="team"
                  onSelect={() => run(() => void navigate({ to: "/app/team" }))}
                >
                  <Users className="mr-2 h-4 w-4" aria-hidden="true" />
                  Team
                </CommandItem>
                <CommandItem
                  value="planner"
                  onSelect={() => run(() => void navigate({ to: "/app/planner" }))}
                >
                  <BrainCircuit className="mr-2 h-4 w-4" aria-hidden="true" />
                  AI Planner
                </CommandItem>
              </>
            )}
            <CommandItem
              value="settings"
              onSelect={() => run(() => void navigate({ to: "/app/settings" }))}
            >
              <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
              Settings
              <CommandShortcut>g s</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading="Do">
            <CommandItem
              value="report"
              onSelect={() => run(() => void navigate({ to: "/app/report" }))}
            >
              <Bug className="mr-2 h-4 w-4" aria-hidden="true" />
              Report an issue
              <CommandShortcut>c</CommandShortcut>
            </CommandItem>
            {isAdmin && (
              <CommandItem
                value="new-project"
                onSelect={() => run(() => void navigate({ to: "/app/projects" }))}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                New project
              </CommandItem>
            )}
            <CommandItem value="theme" onSelect={() => run(toggle)}>
              {resolved === "dark" ? (
                <Sun className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Switch to {resolved === "dark" ? "light" : "dark"} theme
            </CommandItem>
            <CommandItem value="shortcuts" onSelect={() => run(() => setShortcutsOpen(true))}>
              <Keyboard className="mr-2 h-4 w-4" aria-hidden="true" />
              Keyboard shortcuts
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {Object.entries(groups).map(([group, shortcuts]) => (
              <div key={group}>
                <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group}
                </h3>
                <ul className="space-y-1">
                  {shortcuts.map((shortcut) => (
                    <li
                      key={shortcut.keys}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{shortcut.label}</span>
                      <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {shortcut.keys}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
