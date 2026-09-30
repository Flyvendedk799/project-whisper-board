import { supabase } from "@/integrations/supabase/client";
import { PLAN_ATTACHMENT_BUCKET } from "@/lib/upload";

/**
 * Puts one file in the plan-attachments bucket and reports progress.
 *
 * supabase-js does not expose upload progress, so this speaks to the storage
 * endpoint directly with the signed-in user's token. The bucket policy is the
 * same one the SDK would hit: the first path segment has to be the uploader.
 */
export async function uploadPlanFile(
  file: File,
  path: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!token || !base || !key) throw new Error("You need to be signed in to attach files.");

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${base.replace(/\/$/, "")}/storage/v1/object/${PLAN_ATTACHMENT_BUCKET}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", key);
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      let message = "The upload was refused.";
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        message = body.message ?? body.error ?? message;
      } catch {
        /* keep the generic message */
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}
