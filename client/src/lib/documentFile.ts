import { useEffect, useState } from "react";

export const documentFileUrl = (id: number, download = false) =>
  `/api/documents/${id}/file${download ? "?download=1" : ""}`;

type State = {
  loading: boolean;
  error: string | null;
  url: string | null;
  mimeType: string | null;
  size: number | null;
};

/** Loads a stored scan as a blob (plain binary, no base64) with a clear error and a time limit. */
export function useDocumentFile(id: number | null, timeoutMs = 90_000): State & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ loading: false, error: null, url: null, mimeType: null, size: null });
  useEffect(() => {
    if (!id) {
      setState({ loading: false, error: null, url: null, mimeType: null, size: null });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
    let objectUrl: string | null = null;
    setState({ loading: true, error: null, url: null, mimeType: null, size: null });
    (async () => {
      try {
        const response = await fetch(documentFileUrl(id), { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) {
          const text = (await response.text().catch(() => "")).trim();
          throw new Error(text && text.length < 300 && !text.startsWith("<") ? text : `Сервер ответил ошибкой ${response.status}`);
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setState({ loading: false, error: null, url: objectUrl, mimeType: blob.type || response.headers.get("Content-Type"), size: blob.size });
      } catch (error) {
        if (controller.signal.aborted && controller.signal.reason !== "timeout") return;
        setState({
          loading: false,
          error: controller.signal.reason === "timeout" ? "Скан загружается слишком долго. Проверьте интернет и попробуйте ещё раз." : error instanceof Error ? error.message : "Не удалось загрузить скан",
          url: null,
          mimeType: null,
          size: null,
        });
      } finally {
        window.clearTimeout(timer);
      }
    })();
    return () => {
      controller.abort("closed");
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL?.(objectUrl);
    };
  }, [id, attempt, timeoutMs]);
  return { ...state, retry: () => setAttempt(value => value + 1) };
}
