export function PromptTokenBudget({
  tokens,
  limit,
  loading,
  error,
}: {
  tokens: { positive: number; negative: number } | null;
  limit: number;
  loading: boolean;
  error: string;
}) {
  return (
    <div
      className="prompt-token-budget"
      aria-label="提示词 Token 用量"
      aria-busy={loading}
    >
      {error ? (
        <span className="error" role="status">
          {error}
        </span>
      ) : (
        (["positive", "negative"] as const).map((key) => {
          const count = tokens?.[key];
          const label = key === "positive" ? "正面" : "负面";
          const tone =
            count != null && count > limit
              ? "over"
              : count != null && count >= limit * 0.85
                ? "near"
                : "normal";
          return (
            <div className={`prompt-token-row ${tone}`} key={key}>
              <span aria-hidden="true">{key === "positive" ? "+" : "−"}</span>
              <div
                className="prompt-token-track"
                role="progressbar"
                aria-label={`${label} Token`}
                aria-valuemin={0}
                aria-valuemax={limit}
                aria-valuenow={
                  count == null ? undefined : Math.min(count, limit)
                }
                aria-valuetext={`${count ?? "计算中"}/${limit}${loading ? "，更新中" : ""}`}
              >
                <span
                  style={{
                    width: `${Math.min(1, (count ?? 0) / limit) * 100}%`,
                  }}
                />
              </div>
              <span className="prompt-token-count">
                {count ?? "…"}/{limit}
                {loading && count != null ? "…" : ""}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
