import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";
import { apiKeysQuery } from "@/data/planner";
import { createApiKey, revokeApiKey } from "@/lib/planner.functions";
import { useAuth } from "@/components/auth-provider";

export function ApiKeyManager() {
  const { workspaceId } = useAuth();
  const keys = useQuery(apiKeysQuery(workspaceId));
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const create = useServerAction(useServerFn(createApiKey), {
    label: "apikeys.create",
    invalidate: [qk.apiKeys()],
    onSuccess: (result) => {
      setNewKey(result.rawKey);
      setIsCreating(false);
      setName("");
    },
  });

  const revoke = useServerAction(useServerFn(revokeApiKey), {
    label: "apikeys.revoke",
    invalidate: [qk.apiKeys()],
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !workspaceId) return;
    create.fire({ name, workspaceId });
  };

  const rows = keys.data?.keys ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">API Keys</h3>
          <p className="text-sm text-muted-foreground">Manage keys for agent access to the API.</p>
        </div>
        <Button onClick={() => setIsCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Generate new key
        </Button>
      </div>

      <div className="rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Prefix</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Last used</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((k) => (
              <tr key={k.id} className={k.revoked_at ? "opacity-50" : ""}>
                <td className="px-4 py-3 font-medium">{k.name}</td>
                <td className="px-4 py-3 font-mono text-muted-foreground">{k.key_prefix}...</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(k.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never"}
                </td>
                <td className="px-4 py-3 text-right">
                  {!k.revoked_at && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        if (confirm("Are you sure you want to revoke this key?")) {
                          revoke.fire({ keyId: k.id });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  {k.revoked_at && (
                    <span className="text-xs font-medium text-destructive">Revoked</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No API keys generated yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
            <DialogDescription>Create a new API key for agent automation.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="keyName">Key Name</Label>
              <Input
                id="keyName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GitHub Actions"
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.busy || !name.trim()}>
                Generate
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!newKey} onOpenChange={() => setNewKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save your API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Please copy this API key now. You will not be able to see it again!
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4 rounded-md bg-muted p-4 font-mono text-sm break-all">{newKey}</div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNewKey(null)}>I have copied it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
