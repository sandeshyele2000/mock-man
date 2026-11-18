import { memo, type ReactNode } from "react";

// Render tokens as React text nodes so client payloads never become markup.
const jsonTokens =
  /(?<key>"(?:\\.|[^"\\])*")(?=\s*:)|(?<string>"(?:\\.|[^"\\])*")|(?<number>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(?<literal>\b(?:true|false)\b)|(?<null>\bnull\b)|(?<punctuation>[{}\[\],:])/g;

export const JsonPreview = memo(function JsonPreview({
  text,
  testID,
}: {
  text: string;
  testID?: string;
}) {
  const tokens: ReactNode[] = [];
  try {
    JSON.parse(text);
    let cursor = 0;
    for (const match of text.matchAll(jsonTokens)) {
      if (match.index > cursor) tokens.push(text.slice(cursor, match.index));
      const kind = Object.keys(match.groups!).find(
        (key) => match.groups![key] !== undefined,
      );
      tokens.push(
        <span className={`json-${kind}`} key={match.index}>
          {match[0]}
        </span>,
      );
      cursor = match.index + match[0].length;
    }
    tokens.push(text.slice(cursor));
  } catch {
    // Non-JSON bodies (or truncated captures) keep their original text.
    tokens.push(text);
  }
  return (
    <pre className="json-preview" data-testid={testID}>
      <code>{tokens}</code>
    </pre>
  );
});
