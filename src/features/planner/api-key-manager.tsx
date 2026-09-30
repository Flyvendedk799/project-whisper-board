import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";
import { apiKeysQuery } from "@/data/planner";
import { createApiKey, revokeApiKey, updateApiKeyScopes } from "@/lib/planner.functions";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

type Scope = "planner" | "account";

const SCOPE_OPTIONS: Array<{ value: Scope; label: string; hint: string }> = [
  { value: "planner", label: "Planner", hint: "Tasks on AI plans" },
  { value: "account", label: "Account", hint: "Projects, tickets and plans" },
];

/**
 * Generate, grant and revoke the keys agents use. A new key is shown once, in a
 * banner you have to dismiss; revoking asks for a second click.
 */
export function ApiKeyManager({ onClose }: { onClose?: () => void }) {
  const { workspaceId } = useAuth();
  const keys = useQuery(apiKeysQuery(workspaceId));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [scopes, setScopes] = useState<Scope[]>(["planner", "account"]);

  const create = useServerAction(useServerFn(createApiKey), {
    label: "apikeys.create",
    invalidate: [qk.apiKeys()],
    onSuccess: (result) => {
      setNewKey(result.rawKey);
      setCreating(false);
      setName("");
    },
  });
  const revoke = useServerAction(useServerFn(revokeApiKey), {
    label: "apikeys.revoke",
    success: "Key revoked. Agents using it lose access.",
    invalidate: [qk.apiKeys()],
    onSuccess: () => setRevokeId(null),
  });
  const grantAccount = useServerAction(useServerFn(updateApiKeyScopes), {
    label: "apikeys.updateScopes",
    success: "Account access granted",
    invalidate: [qk.apiKeys()],
  });

  const toggleScope = (scope: Scope) =>
    setScopes((current) => {
      const next = current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope];
      return next.length > 0 ? next : current;
    });

  const rows = keys.data?.keys ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <p className="flex-1 text-[13px] leading-normal text-muted-foreground">
          Planner keys reach <span className="font-mono">/api/planner</span>. Account keys also
          reach projects, tickets and plans at <span className="font-mono">/api/v1</span>.
        </p>
        <Button
          type="button"
          className="whitespace-nowrap bg-foreground text-background hover:bg-foreground/90"
          onClick={() => {
            setCreating(true);
            setNewKey(null);
          }}
        >
          + Generate key
        </Button>
      </div>

      {newKey ? (
        <div role="status" className="flex flex-col gap-2 rounded-[10px] bg-success/15 p-3.5">
          <div className="text-[13px] font-medium">
            Copy this key now. It will not be shown again.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-card px-3 py-2.5 text-xs">
              {newKey}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                navigator.clipboard
                  .writeText(newKey)
                  .then(() => toast.success("Key copied"))
                  .catch(() => toast.error("Couldn't copy. Select the key and copy it by hand."))
              }
            >
              Copy
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-foreground text-background hover:bg-foreground/90"
              onClick={() => setNewKey(null)}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}

      {creating ? (
        <form
          className="flex flex-col gap-3 rounded-[10px] border p-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && workspaceId) {
              create.fire({ name: name.trim(), workspaceId, scopes });
            }
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Key name, e.g. GitHub Actions"
            aria-label="Key name"
            maxLength={100}
          />
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Access</legend>
            {SCOPE_OPTIONS.map((option) => {
              const on = scopes.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggleScope(option.value)}
                  className={cn(
                    "rounded-[10px] border px-3.5 py-2.5 text-left text-[13px]",
                    on ? "border-primary bg-accent" : "bg-card hover:bg-muted/60",
                  )}
                >
                  {on ? "☑" : "☐"} {option.label}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={create.busy || !name.trim()}>
              {create.busy ? "Generating…" : "Generate"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-[10px] border">
        <table className="w-full min-w-[620px] text-left text-[13px]">
          <thead className="bg-surface text-xs text-muted-foreground">
            <tr>
              <th className="px-3.5 py-2.5 font-normal">Name</th>
              <th className="px-3.5 py-2.5 font-normal">Prefix</th>
              <th className="px-3.5 py-2.5 font-normal">Access</th>
              <th className="px-3.5 py-2.5 font-normal">Created</th>
              <th className="px-3.5 py-2.5 font-normal">Last used</th>
              <th className="px-3.5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((key) => {
              const keyScopes = (key.scopes ?? ["planner"]) as string[];
              const confirming = revokeId === key.id;
              return (
                <tr key={key.id} className={cn("border-t", key.revoked_at && "opacity-50")}>
                  <td className="px-3.5 py-3 font-medium">{key.name}</td>
                  <td className="px-3.5 py-3 font-mono text-xs text-muted-foreground">
                    {key.key_prefix}…
                  </td>
                  <td className="px-3.5 py-3 text-muted-foreground">{keyScopes.join(", ")}</td>
                  <td className="px-3.5 py-3 text-muted-foreground">
                    {new Date(key.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3.5 py-3 text-muted-foreground">
                    {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-3.5 py-3">
                    <div className="flex justify-end gap-1.5">
                      {!key.revoked_at && !keyScopes.includes("account") ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-[26px] px-2.5 text-xs"
                          disabled={grantAccount.busy}
                          onClick={() =>
                            grantAccount.fire({
                              keyId: key.id,
                              scopes: [...new Set([...keyScopes, "account"])] as Scope[],
                            })
                          }
                        >
                          Grant account
                        </Button>
                      ) : null}
                      {!key.revoked_at ? (
                        <Button
                          type="button"
                          variant={confirming ? "destructive" : "ghost"}
                          size="sm"
                          className={cn(
                            "h-[26px] px-2.5 text-xs",
                            !confirming && "text-destructive hover:text-destructive",
                          )}
                          disabled={revoke.busy}
                          onClick={() =>
                            confirming ? revoke.fire({ keyId: key.id }) : setRevokeId(key.id)
                          }
                          onBlur={() => confirming && setRevokeId(null)}
                        >
                          {confirming ? "Confirm revoke" : "Revoke"}
                        </Button>
                      ) : (
                        <span className="text-xs text-destructive">Revoked</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {keys.isPending ? "Loading keys…" : "No API keys generated yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {onClose ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : null}
    </div>
  );
}
