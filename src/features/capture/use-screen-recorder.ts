import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  elapsedMs,
  extensionFor,
  initialRecorderState,
  pickMimeType,
  recorderReducer,
  shouldAutoStop,
  shouldWarn,
} from "./recorder-machine";

/**
 * Screen recording with narration.
 *
 * What the previous version was missing, in order of how much it mattered:
 * you could not talk over it, you could not pause, it only ever tried webm (so
 * it was broken on Safari), it lost everything if the tab crashed, and it left
 * the display stream running if the component unmounted mid-recording — which
 * leaves the browser's "sharing your screen" bar up with nothing behind it.
 */

export interface RecordingResult {
  file: File;
  durationMs: number;
  hasAudio: boolean;
}

export function isScreenRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    typeof window.MediaRecorder !== "undefined"
  );
}

export function useScreenRecorder(onComplete: (result: RecordingResult) => void) {
  const [state, dispatch] = useReducer(recorderReducer, initialRecorderState);
  const [, forceTick] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const durationRef = useRef(0);
  const hasAudioRef = useRef(false);

  const teardown = useCallback(() => {
    streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    streamsRef.current = [];
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    recorderRef.current = null;
  }, []);

  // Whatever ends the component — navigation, an error boundary, a route
  // change — the screen share must not outlive it.
  useEffect(() => teardown, [teardown]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    dispatch({ type: "stopping", at: Date.now() });
    recorder.stop();
  }, []);

  // A ticking clock, and the caps.
  useEffect(() => {
    if (state.status !== "recording") return;
    const id = setInterval(() => {
      forceTick((n) => n + 1);
      if (shouldAutoStop(state)) stop();
    }, 500);
    return () => clearInterval(id);
  }, [state, stop]);

  const start = useCallback(
    async (micEnabled: boolean) => {
      if (!isScreenRecordingSupported()) {
        dispatch({
          type: "failed",
          message: "This browser can't record the screen. You can attach a screenshot instead.",
        });
        return;
      }

      dispatch({ type: "request", micEnabled });
      chunksRef.current = [];

      let display: MediaStream;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: true,
        });
      } catch (error) {
        dispatch({
          type: "failed",
          message:
            error instanceof Error && error.name === "NotAllowedError"
              ? "Screen recording was declined."
              : "Couldn't start recording.",
        });
        return;
      }
      streamsRef.current.push(display);

      let mic: MediaStream | null = null;
      if (micEnabled) {
        try {
          mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          streamsRef.current.push(mic);
        } catch {
          // Recording without narration beats not recording. The panel shows
          // that the microphone did not come up.
          mic = null;
        }
      }

      // System audio and the microphone are separate tracks; MediaRecorder
      // takes one. An AudioContext destination mixes them into that one.
      const displayAudio = display.getAudioTracks();
      let audioTracks: MediaStreamTrack[] = [];
      if (displayAudio.length > 0 || mic) {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const destination = audioContext.createMediaStreamDestination();
        if (displayAudio.length > 0) {
          audioContext.createMediaStreamSource(new MediaStream(displayAudio)).connect(destination);
        }
        if (mic) audioContext.createMediaStreamSource(mic).connect(destination);
        audioTracks = destination.stream.getAudioTracks();
      }
      hasAudioRef.current = audioTracks.length > 0;

      const mixed = new MediaStream([display.getVideoTracks()[0], ...audioTracks]);
      const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(mixed, mimeType ? { mimeType } : undefined);
      } catch {
        teardown();
        dispatch({ type: "failed", message: "This browser can't record in a supported format." });
        return;
      }
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          dispatch({ type: "data", bytes: event.data.size });
        }
      };

      recorder.onstop = () => {
        const type = mimeType ?? "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        const file = new File([blob], `recording-${stamp}.${extensionFor(mimeType)}`, { type });
        teardown();
        dispatch({ type: "finished" });
        onComplete({ file, durationMs: durationRef.current, hasAudio: hasAudioRef.current });
      };

      // Most people stop from the browser's own "Stop sharing" bar rather than
      // ours, so that has to end the recording too.
      display.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorderRef.current?.state !== "inactive") stop();
      });

      // A one-second timeslice means a tab crash costs a second, not everything.
      recorder.start(1000);
      dispatch({ type: "started", at: Date.now() });
    },
    [onComplete, stop, teardown],
  );

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "recording") return;
    recorder.pause();
    dispatch({ type: "paused", at: Date.now() });
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "paused") return;
    recorder.resume();
    dispatch({ type: "resumed", at: Date.now() });
  }, []);

  const reset = useCallback(() => {
    teardown();
    dispatch({ type: "reset" });
  }, [teardown]);

  durationRef.current = elapsedMs(state);

  return {
    state,
    elapsed: elapsedMs(state),
    warning: shouldWarn(state),
    start,
    stop,
    pause,
    resume,
    reset,
  };
}
