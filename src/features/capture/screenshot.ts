import { AppError } from "@/lib/errors";

/**
 * A single frame of the screen, without leaving the app.
 *
 * A client who has to alt-tab to a screenshot tool, save a file, come back and
 * find it usually gives up and writes "it looks wrong" instead. This grabs one
 * frame from the same picker the recorder uses and stops the stream immediately.
 */
export async function captureScreenshot(): Promise<File> {
  if (typeof navigator?.mediaDevices?.getDisplayMedia !== "function") {
    throw new AppError(
      "capture_unsupported",
      "This browser can't capture the screen. You can attach an image instead.",
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (error) {
    throw new AppError(
      "capture_declined",
      error instanceof Error && error.name === "NotAllowedError"
        ? "Screen capture was declined."
        : "Couldn't capture the screen.",
    );
  }

  try {
    const track = stream.getVideoTracks()[0];
    if (!track) throw new AppError("capture_failed", "Couldn't capture the screen.");

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    // One frame is not necessarily ready the instant play() resolves.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const settings = track.getSettings();
    const canvas = document.createElement("canvas");
    canvas.width = settings.width ?? video.videoWidth;
    canvas.height = settings.height ?? video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AppError("capture_failed", "Couldn't capture the screen.");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.srcObject = null;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new AppError("capture_failed", "Couldn't save the screenshot.");

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return new File([blob], `screenshot-${stamp}.png`, { type: "image/png" });
  } finally {
    // Whatever happened, do not leave the share running.
    stream.getTracks().forEach((track) => track.stop());
  }
}

/** Reads a file into an <img>, so the annotator knows its real dimensions. */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AppError("image_unreadable", `Couldn't read ${file.name}.`));
    };
    image.src = url;
  });
}
