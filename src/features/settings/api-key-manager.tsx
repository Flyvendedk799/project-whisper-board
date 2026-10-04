import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";
import { apiKeysQuery } from "@/data/planner";
import { createApiKey, revokeApiKey } from "@/lib/planner.functions";
import { useAuth } from "@/components/auth-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type KeyKind = "account" | "planner";

const KIND_COPY: Record<KeyKind, { scopes: string[]; intro: ReactNode; placeholder: string }> = {
  account: {
    scopes: ["planner", "account"],
    intro: (
      <>
        Account keys reach projects, tickets and plans at <span className="font-mono">/api/v1</span>
        , and the planner API too. They act across the whole workspace, so treat them like a
        password.
      </>
    ),
    placeholder: "Key name, e.g. GitHub Actions",
  },
  planner: {
    scopes: ["planner"],
    intro: (
      <>
        Planner keys reach tasks on AI plans at <span className="font-mono">/api/planner</span> and
        nothing else. For projects and tickets, generate an account key in Settings.
      </>
    ),
    placeholder: "Key name, e.g. Claude Code on this plan",
  },
};

const isAccountKey = (scopes: string[] | null) => (scopes ?? ["planner"]).includes("account");

/**
 * Generate and revoke the keys agents use. An `account` manager lists and creates keys that
 * reach the whole workspace API; a `planner` manager only deals in plan-only keys. A new key
 * is shown once, in a banner you have to dismiss; revoking asks for a second click.
 */
export function ApiKeyManager({ kind, onClose }: { kind: KeyKind; onClose?: () => void }) {
  const { workspaceId } = useAuth();
  const isMobile = useIsMobile();
  const copy = KIND_COPY[kind];
  const keys = useQuery(apiKeysQuery(workspaceId));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

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

  const rows = (keys.data?.keys ?? []).filter(
    (key) => isAccountKey(key.scopes) === (kind === "account"),
  );

  const revokeButton = (key: (typeof rows)[number]) => {
    const confirming = revokeId === key.id;
    if (key.revoked_at) return <span className="text-xs text-destructive">Revoked</span>;
    return (
      <Button
        type="button"
        variant={confirming ? "destructive" : "ghost"}
        size="sm"
        className={cn(
          "h-[26px] px-2.5 text-xs max-md:h-11 max-md:px-4 max-md:text-sm",
          !confirming && "text-destructive hover:text-destructive",
        )}
        disabled={revoke.busy}
        onClick={() => (confirming ? revoke.fire({ keyId: key.id }) : setRevokeId(key.id))}
        onBlur={() => confirming && setRevokeId(null)}
      >
        {confirming ? "Confirm revoke" : "Revoke"}
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4 max-md:flex-col max-md:gap-3">
        <p className="flex-1 text-[13px] leading-normal text-muted-foreground max-md:text-sm">
          {copy.intro}
        </p>
        <Button
          type="button"
          className="whitespace-nowrap bg-foreground text-background hover:bg-foreground/90 max-md:w-full"
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
          <div className="flex items-center gap-2 max-md:flex-col max-md:items-stretch">
            <code className="flex-1 select-all break-all rounded-lg bg-card px-3 py-2.5 text-xs">
              {newKey}
            </code>
            <div className="grid grid-cols-2 gap-2 md:contents">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-md:h-11"
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
                className="bg-foreground text-background hover:bg-foreground/90 max-md:h-11"
                onClick={() => setNewKey(null)}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {creating ? (
        <form
          className="flex flex-col gap-3 rounded-[10px] border p-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && workspaceId) {
              create.fire({ name: name.trim(), workspaceId, scopes: copy.scopes });
            }
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={copy.placeholder}
            aria-label="Key name"
            maxLength={100}
            autoComplete="off"
            enterKeyHint="done"
          />
          <div className="flex justify-end gap-2 max-md:[&>*]:flex-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={create.busy || !name.trim()}>
              {create.busy ? "Generating…" : "Generate"}
            </Button>
          </div>
        </form>
      ) : null}

      {isMobile ? (
        <ul className="overflow-hidden rounded-[10px] border">
          {rows.map((key) => (
            <li
              key={key.id}
              className={cn(
                "flex items-center gap-3 border-t px-3.5 py-3 first:border-t-0",
                key.revoked_at && "opacity-50",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{key.name}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {key.key_prefix}…
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Created {new Date(key.created_at).toLocaleDateString()} · Last used{" "}
                  {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "never"}
                </div>
              </div>
              {revokeButton(key)}
            </li>
          ))}
          {rows.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              {keys.isPending ? "Loading keys…" : "No API keys generated yet."}
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="bg-surface text-xs text-muted-foreground">
              <tr>
                <th className="px-3.5 py-2.5 font-normal">Name</th>
                <th className="px-3.5 py-2.5 font-normal">Prefix</th>
                <th className="px-3.5 py-2.5 font-normal">Created</th>
                <th className="px-3.5 py-2.5 font-normal">Last used</th>
                <th className="px-3.5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((key) => {
                return (
                  <tr key={key.id} className={cn("border-t", key.revoked_at && "opacity-50")}>
                    <td className="px-3.5 py-3 font-medium">{key.name}</td>
                    <td className="px-3.5 py-3 font-mono text-xs text-muted-foreground">
                      {key.key_prefix}…
                    </td>
                    <td className="px-3.5 py-3 text-muted-foreground">
                      {new Date(key.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3.5 py-3 text-muted-foreground">
                      {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="flex justify-end gap-1.5">{revokeButton(key)}</div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    {keys.isPending ? "Loading keys…" : "No API keys generated yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {onClose ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" className="max-md:w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : null}
    </div>
  );
}
