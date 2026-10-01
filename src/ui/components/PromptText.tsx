import { useRef } from "react";
import { useStudio } from "../store";
import { PromptAnnotations } from "./PromptAnnotations";
import { usePromptTranslation } from "./usePromptTranslation";

/** Source text stays selectable/copyable; annotations never enter the source. */
export function PromptText({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const { settings } = useStudio();
  const input = useRef<HTMLSpanElement>(null);
  const { terms, annotations, error } = usePromptTranslation(
    value,
    settings.translate,
  );
  return (
    <span
      className={`prompt-display ${settings.translate ? "with-translation" : ""} ${className}`}
    >
      <span className="prompt-display-source" ref={input}>
        {value}
      </span>
      {settings.translate && value && (
        <PromptAnnotations
          input={input}
          value={value}
          terms={terms}
          annotations={annotations}
        />
      )}
      {error && (
        <span className="translation-error" role="status">
          {error}
        </span>
      )}
    </span>
  );
}

export function PromptFields({ fields }: { fields: [string, string][] }) {
  return (
    <div className="prompt-fields">
      {fields
        .filter(([, value]) => !!value)
        .map(([label, value], i) => (
          <div key={`${label}:${i}`}>
            <h4>{label}</h4>
            <PromptText value={value} />
          </div>
        ))}
    </div>
  );
}
