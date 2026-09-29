// Port of Android AiJsonOutputExtractor. Used only by research planning;
// final design replies retain their separate parse/one-repair contract.
export function jsonObjectCandidates(raw: string): string[] {
  const source = raw.trim();
  let repaired = "",
    inString = false,
    escaped = false,
    previous = "";
  const significant = (start: number) => {
    let i = start;
    while (i < source.length && /\s/.test(source[i])) i++;
    return i;
  };
  const closes = (char: string) => [",", "}", "]", ":", ""].includes(char);
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      repaired += ch;
      escaped = false;
    } else if (inString && ch === "\\") {
      repaired += ch;
      escaped = true;
    } else if (ch === '"') {
      if (inString) {
        const j = significant(i + 1),
          next = source[j] || "";
        if (closes(next)) {
          inString = false;
          repaired += ch;
        } else if (next === '"') {
          if (closes(source[significant(j + 1)] || "")) repaired += "\\" + ch;
          else {
            inString = false;
            repaired += ch + ",";
          }
        } else if (next === "{" || next === "[") {
          inString = false;
          repaired += ch + ",";
        } else repaired += "\\" + ch;
      } else {
        if (["}", "]", '"'].includes(previous)) repaired += ",";
        inString = true;
        repaired += ch;
      }
    } else if (!inString && (ch === "{" || ch === "[")) {
      if (["}", "]", '"'].includes(previous)) repaired += ",";
      previous = ch;
      repaired += ch;
    } else {
      if (!inString && !/\s/.test(ch)) previous = ch;
      repaired += ch;
    }
  }
  const extract = (text: string, closeUnfinished = false) => {
    const result: string[] = [];
    for (let start = 0; start < text.length; start++) {
      if (text[start] !== "{") continue;
      const stack: string[] = [];
      let quoted = false,
        escape = false,
        valid = true;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (escape) escape = false;
        else if (quoted && ch === "\\") escape = true;
        else if (ch === '"') quoted = !quoted;
        else if (!quoted) {
          if (ch === "{" || (closeUnfinished && ch === "[")) stack.push(ch);
          else if (ch === "}" || (closeUnfinished && ch === "]")) {
            if (stack.pop() !== (ch === "}" ? "{" : "[")) {
              valid = false;
              break;
            }
            if (!closeUnfinished && !stack.length) {
              result.push(text.slice(start, i + 1));
              break;
            }
          }
        }
      }
      if (closeUnfinished && valid && stack.length)
        result.push(
          text.slice(start) +
            (quoted ? '"' : "") +
            stack
              .reverse()
              .map((ch) => (ch === "{" ? "}" : "]"))
              .join(""),
        );
    }
    return result;
  };
  const fenced = [
    ...repaired.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi),
  ].flatMap((match) => extract(match[1]));
  const balanced = [
    ...new Set(
      [...fenced, ...extract(repaired)].map((s) => s.trim()).filter(Boolean),
    ),
  ];
  return balanced.length ? balanced : [...new Set(extract(repaired, true))];
}
