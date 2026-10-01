import { useEffect, useMemo, useState } from "react";
import { translateLocal } from "../../data/catalog";
import { segments } from "../../domain/promptPolicy";

export function usePromptTranslation(value: string, enabled: boolean) {
  const terms = useMemo(() => segments(value), [value]);
  const [annotations, setAnnotations] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setError("");
    if (!enabled || !value) {
      setAnnotations({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const abort = new AbortController();
    const publish = (result: Record<string, string>) => {
      if (!abort.signal.aborted) setAnnotations(result);
    };
    const timer = setTimeout(() => {
      translateLocal(terms, abort.signal, publish)
        .then(publish)
        .catch((e) => {
          if (!abort.signal.aborted) setError(`翻译未完成：${String(e)}`);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [terms, enabled, value, attempt]);
  // A pending response may retain only translations belonging to current terms.
  const current = useMemo(
    () =>
      Object.fromEntries(
        terms
          .filter((t) => annotations[t.lookup])
          .map((t) => [t.lookup, annotations[t.lookup]]),
      ),
    [terms, annotations],
  );
  return {
    terms,
    annotations: enabled ? current : {},
    error: enabled ? error : "",
    loading: enabled && loading,
    retry: () => setAttempt((v) => v + 1),
  };
}
