import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, StatusPill } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/projects/")({
  component: ProjectsPage,
});

function ProjectsPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const projects = useQuery({
    queryKey: ["projects-all", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,title,description,status,progress,start_date,end_date,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <>
      <PageHeader
        title="Projects"
        description={isAdmin ? "All client engagements." : "Your projects."}
        action={
          isAdmin && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1.5" />New project</Button>
              </DialogTrigger>
              <NewProjectDialog
                onCreated={() => {
                  setOpen(false);
                  qc.invalidateQueries({ queryKey: ["projects-all"] });
                  qc.invalidateQueries({ queryKey: ["projects"] });
                }}
              />
            </Dialog>
          )
        }
      />
      <div className="max-w-6xl mx-auto px-8 py-10">
        {projects.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (projects.data?.length ?? 0) === 0 ? (
          <Card className="p-12 text-center">
            <h3 className="font-display text-2xl">No projects yet</h3>
            <p className="text-sm text-muted-foreground mt-2">{isAdmin ? "Create your first project to start tracking work." : "You haven't been added to any project yet."}</p>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.data!.map((p) => (
              <Link key={p.id} to="/app/projects/$projectId" params={{ projectId: p.id }}>
                <Card className="p-5 h-full hover:border-foreground/20 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <StatusPill>{p.status.replace("_", " ")}</StatusPill>
                    <span className="text-xs text-muted-foreground">{p.progress}%</span>
                  </div>
                  <h3 className="font-display text-xl">{p.title}</h3>
                  {p.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.description}</p>}
                  <div className="mt-4 h-1.5 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function NewProjectDialog({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("projects").insert({ title, description: description || null, created_by: user.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Project created");
    setTitle("");
    setDescription("");
    onCreated();
  }

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="t">Title</Label>
          <Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d">Description</Label>
          <Textarea id="d" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create project"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
