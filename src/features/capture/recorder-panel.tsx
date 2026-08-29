import { useState } from "react";
import { Circle, Mic, MicOff, Pause, Play, Square, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/app-shell";
import { formatElapsed } from "./recorder-machine";
import {
  isScreenRecordingSupported,
  useScreenRecorder,
  type RecordingResult,
} from "./use-screen-recorder";

/**
 * Recording controls that stay on screen.
 *
 * The old version's only stop button was the browser's own "Stop sharing" bar,
 * which sits over whatever the person is recording and is easy to miss. This
 * shows the elapsed time, whether the microphone is live, and how close the
 * recording is to the cap.
 */
export function RecorderPanel({ onRecorded }: { onRecorded: (result: RecordingResult) => void }) {
  const [micEnabled, setMicEnabled] = useState(true);
  const recorder = useScreenRecorder(onRecorded);
  const { state, elapsed, warning } = recorder;

  if (!isScreenRecordingSupported()) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <Video className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="mt-1.5 text-sm">Screen recording isn&rsquo;t available in this browser.</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Safari on iPhone and iPad can&rsquo;t record a tab. Attach a screenshot or a photo instead
          &mdash; that works everywhere.
        </p>
      </div>
    );
  }

  const isLive = state.status === "recording" || state.status === "paused";

  return (
    <div className="rounded-lg border p-4">
      {!isLive ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void recorder.start(micEnabled)}>
            <Circle className="mr-1.5 h-4 w-4 fill-current text-destructive" aria-hidden="true" />
            Record my screen
          </Button>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={micEnabled} onCheckedChange={setMicEnabled} id="mic" />
            <span className="flex items-center gap-1.5">
              {micEnabled ? (
                <Mic className="h-4 w-4" aria-hidden="true" />
              ) : (
                <MicOff className="h-4 w-4" aria-hidden="true" />
              )}
              Talk me through it
            </span>
          </label>

          {state.status === "error" && state.error && (
            <p role="alert" className="w-full text-sm text-destructive">
              {state.error}
            </p>
          )}
          {state.status === "ready" && (
            <p className="w-full text-sm text-muted-foreground">
              Recording attached. Record another if you need to.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="flex items-center gap-2 text-sm font-medium"
              role="status"
              aria-live="off"
            >
              <Circle
                className={`h-3 w-3 fill-current text-destructive ${
                  state.status === "recording" ? "animate-pulse" : ""
                }`}
                aria-hidden="true"
              />
              <span className="tabular-nums">{formatElapsed(elapsed)}</span>
            </span>

            {state.micEnabled && (
              <StatusPill tone="info">
                <Mic className="mr-1 h-3 w-3" aria-hidden="true" />
                Mic on
              </StatusPill>
            )}
            {state.status === "paused" && <StatusPill tone="warning">Paused</StatusPill>}

            <div className="ml-auto flex gap-2">
              {state.status === "recording" ? (
                <Button type="button" variant="outline" size="sm" onClick={recorder.pause}>
                  <Pause className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Pause
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={recorder.resume}>
                  <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Resume
                </Button>
              )}
              <Button type="button" variant="destructive" size="sm" onClick={recorder.stop}>
                <Square className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Stop
              </Button>
            </div>
          </div>

          {warning && (
            <p role="status" className="text-xs text-warning">
              Getting close to the five-minute limit — it&rsquo;ll stop on its own.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Show what went wrong the way you&rsquo;d show a colleague. Talking over it helps more
            than you&rsquo;d think.
          </p>
        </div>
      )}
    </div>
  );
}
