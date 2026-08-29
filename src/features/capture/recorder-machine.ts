/**
 * The recorder's state machine, as a pure reducer.
 *
 * Screen recording is genuinely fiddly: the person can stop it from the
 * browser's own bar instead of ours, permission can be refused, the tab can be
 * closed mid-recording, and pausing has to stop the clock without stopping the
 * stream. None of that needs MediaRecorder to test, so none of it lives near it.
 */

export type RecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "finalising"
  | "ready"
  | "error";

export interface RecorderState {
  status: RecorderStatus;
  /** Wall-clock start of the current running span. */
  runningSince: number | null;
  /** Milliseconds accumulated before the current span. */
  accumulatedMs: number;
  bytes: number;
  error: string | null;
  micEnabled: boolean;
}

export type RecorderEvent =
  | { type: "request"; micEnabled: boolean }
  | { type: "started"; at: number }
  | { type: "paused"; at: number }
  | { type: "resumed"; at: number }
  | { type: "data"; bytes: number }
  | { type: "stopping"; at: number }
  | { type: "finished" }
  | { type: "failed"; message: string }
  | { type: "reset" };

export const MAX_DURATION_MS = 5 * 60_000;
export const MAX_BYTES = 200 * 1024 * 1024;
/** Warn rather than surprise someone with an automatic stop. */
export const WARN_RATIO = 0.8;

export const initialRecorderState: RecorderState = {
  status: "idle",
  runningSince: null,
  accumulatedMs: 0,
  bytes: 0,
  error: null,
  micEnabled: false,
};

export function recorderReducer(state: RecorderState, event: RecorderEvent): RecorderState {
  switch (event.type) {
    case "request":
      return { ...initialRecorderState, status: "requesting", micEnabled: event.micEnabled };

    case "started":
      return { ...state, status: "recording", runningSince: event.at, error: null };

    case "paused":
      if (state.status !== "recording") return state;
      return {
        ...state,
        status: "paused",
        accumulatedMs: state.accumulatedMs + (event.at - (state.runningSince ?? event.at)),
        runningSince: null,
      };

    case "resumed":
      if (state.status !== "paused") return state;
      return { ...state, status: "recording", runningSince: event.at };

    case "data":
      return { ...state, bytes: state.bytes + event.bytes };

    case "stopping":
      // Reached from recording or paused; either way the clock stops here.
      if (state.status !== "recording" && state.status !== "paused") return state;
      return {
        ...state,
        status: "finalising",
        accumulatedMs:
          state.accumulatedMs + (state.runningSince != null ? event.at - state.runningSince : 0),
        runningSince: null,
      };

    case "finished":
      return { ...state, status: "ready", runningSince: null };

    case "failed":
      return { ...state, status: "error", runningSince: null, error: event.message };

    case "reset":
      return { ...initialRecorderState, micEnabled: state.micEnabled };

    default:
      return state;
  }
}

/** Elapsed excludes paused spans, which is what people expect a timer to show. */
export function elapsedMs(state: RecorderState, now: number = Date.now()): number {
  return state.accumulatedMs + (state.runningSince != null ? now - state.runningSince : 0);
}

export function shouldAutoStop(state: RecorderState, now: number = Date.now()): boolean {
  if (state.status !== "recording" && state.status !== "paused") return false;
  return elapsedMs(state, now) >= MAX_DURATION_MS || state.bytes >= MAX_BYTES;
}

export function shouldWarn(state: RecorderState, now: number = Date.now()): boolean {
  if (state.status !== "recording" && state.status !== "paused") return false;
  return (
    elapsedMs(state, now) >= MAX_DURATION_MS * WARN_RATIO || state.bytes >= MAX_BYTES * WARN_RATIO
  );
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Safari supports neither webm nor vp9. The original code only ever tried webm,
 * so recording was simply broken there.
 */
export const CODEC_PREFERENCES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return CODEC_PREFERENCES.find(isSupported);
}

export function extensionFor(mimeType: string | undefined): string {
  return mimeType?.startsWith("video/mp4") ? "mp4" : "webm";
}
