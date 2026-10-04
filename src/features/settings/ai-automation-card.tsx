import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { QueryState } from "@/components/query-state";
import { qk } from "@/data/keys";
import { userAiSettingsQuery } from "@/data/planner";
import { useAiEnabled } from "@/hooks/use-ai-enabled";
import { setAiSettings } from "@/lib/ai-planner.functions";
import { AUTO_ENRICH_SESSION_CAP, AUTO_ENRICH_SPACING_MS } from "@/lib/auto-enrich";
import { useServerAction } from "@/lib/use-server-action";

/**
 * Your own switch for the AI that looks at tasks in the background. Per
 * person: turning it on here does nothing for anyone else on the plan.
 *
 * Be plain about what "background" means: it runs in your browser while a plan
 * is open. There is no server job, so closing the tab stops it.
 */
export function AiAutomationCard() {
  const aiEnabled = useAiEnabled();
  const settings = useQuery({ ...userAiSettingsQuery(), enabled: aiEnabled });

  const save = useServerAction(useServerFn(setAiSettings), {
    label: "aiSettings.set",
    invalidate: [qk.aiSettings()],
    success: (result) => (result.autoEnrich ? "AI automation is on." : "AI automation is off."),
  });

  // No AI, no AI controls. Say why instead of showing a switch that does nothing.
  if (!aiEnabled) {
    return (
      <Card className="space-y-2 rounded-[14px] p-5 max-md:p-4">
        <h2 className="font-display text-[22px] leading-tight">AI automation</h2>
        <p className="text-sm text-muted-foreground">
          This appears once AI is set up for the workspace. Until then there is nothing to switch
          on.
        </p>
      </Card>
    );
  }

  return (
    <QueryState query={settings} errorTitle="Couldn't load your AI settings">
      {(data) => (
        <Card className="space-y-4 rounded-[14px] p-5 max-md:p-4">
          <div>
            <h2 className="font-display text-[22px] leading-tight">AI automation</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Let the AI look over your tasks as you work and prepare what they need.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 max-md:min-h-14">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="ai-auto-enrich" className="text-sm font-medium">
                Assess and enrich tasks automatically
              </Label>
              <p className="text-xs text-muted-foreground">
                For tasks that are not done, the AI decides whether each needs code context, a
                feature list, sub-steps or questions, and writes technical context from the
                plan&rsquo;s repository when it does. Its notes go in their own field and never
                overwrite your brief. It uses your own AI account and your own GitHub connection.
              </p>
            </div>
            <Switch
              id="ai-auto-enrich"
              className="max-md:mt-1"
              checked={data.autoEnrich}
              disabled={save.busy}
              onCheckedChange={(next) => save.fire({ autoEnrich: next })}
            />
          </div>

          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            This runs in your browser while a plan is open: there is no background server job, so
            nothing happens while you are away or after you close the tab. To keep your AI
            subscription from being drained it looks at one task at a time, about{" "}
            {Math.round(AUTO_ENRICH_SPACING_MS / 1000)} seconds apart, and at most{" "}
            {AUTO_ENRICH_SESSION_CAP} tasks each time you load the app.
          </p>
        </Card>
      )}
    </QueryState>
  );
}
