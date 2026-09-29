import { useLayoutEffect, useRef, useState, type RefObject } from "react";

type Label = {
  x: number;
  y: number;
  width: number;
  text: string;
  fill: boolean;
};
type Term = { start: number; end: number; lookup: string };

/** Keep native textarea selection/IME; measure the same raw text in an inert mirror. */
export function PromptAnnotations({
  input,
  value,
  terms,
  annotations,
}: {
  input: RefObject<HTMLTextAreaElement | null>;
  value: string;
  terms: Term[];
  annotations: Record<string, string>;
}) {
  const mirror = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  useLayoutEffect(() => {
    const textarea = input.current,
      measure = mirror.current,
      overlay = layer.current;
    if (!textarea || !measure || !overlay) return;
    let frame = 0,
      active = true;
    const syncScroll = () => {
      overlay.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    };
    const layout = () => {
      const style = getComputedStyle(textarea);
      for (const name of [
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "line-height",
        "letter-spacing",
        "word-spacing",
        "tab-size",
        "text-align",
        "direction",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "overflow-wrap",
        "word-break",
      ])
        measure.style.setProperty(name, style.getPropertyValue(name));
      measure.style.width = textarea.clientWidth + "px";
      measure.style.left = textarea.clientLeft + "px";
      measure.style.top = textarea.clientTop + "px";
      measure.textContent = value + "\u200b";
      const node = measure.firstChild!;
      const root = measure.getBoundingClientRect();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.font = `9px ${style.fontFamily}`;
      const next: Label[] = [];
      for (const term of terms) {
        let remaining = annotations[term.lookup] || "";
        if (!remaining || term.end <= term.start) continue;
        const range = document.createRange();
        range.setStart(node, Math.min(term.start, value.length));
        range.setEnd(node, Math.min(term.end, value.length));
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        rects.forEach((rect, index) => {
          const width = Math.max(1, rect.width - 1);
          let consumed = 0;
          for (const char of remaining) {
            if (
              ctx.measureText(remaining.slice(0, consumed) + char).width > width
            )
              break;
            consumed += char.length;
          }
          if (!consumed && remaining && index < rects.length - 1)
            consumed = [...remaining][0].length;
          const text =
            index === rects.length - 1
              ? remaining
              : remaining.slice(0, consumed);
          remaining =
            index === rects.length - 1 ? "" : remaining.slice(consumed);
          next.push({
            x: rect.left - root.left,
            y: rect.bottom - root.top + 1,
            width,
            text,
            fill: !remaining && ctx.measureText(text).width + 3 <= rect.width,
          });
        });
      }
      if (active) setLabels(next);
      syncScroll();
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(textarea);
    textarea.addEventListener("scroll", syncScroll, { passive: true });
    document.fonts.ready.then(() => {
      if (active) schedule();
    });
    layout();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      textarea.removeEventListener("scroll", syncScroll);
    };
  }, [input, value, terms, annotations]);
  return (
    <>
      <div ref={mirror} className="prompt-measure" aria-hidden="true" />
      <div className="prompt-annotation-clip" aria-hidden="true">
        <div ref={layer} className="prompt-annotation-layer">
          {labels.map((label, i) => (
            <span
              key={i}
              className="prompt-annotation"
              style={{ left: label.x, top: label.y, width: label.width }}
            >
              <span className="prompt-annotation-text">{label.text}</span>
              {label.fill && <span className="prompt-annotation-line" />}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
