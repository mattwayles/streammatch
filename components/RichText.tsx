"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Renders a minimal, safe subset of inline markdown: **bold** and *italic*.
 * Balanced pairs become <strong>/<em>; any leftover stray asterisks are stripped
 * so users never see raw "*" characters. No HTML injection (no dangerouslySetInnerHTML).
 */
export default function RichText({ text }: { text: string }) {
  const tokenRe = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  const pushPlain = (s: string) => {
    const cleaned = s.replace(/\*/g, ""); // drop unbalanced/stray asterisks
    if (cleaned) nodes.push(<Fragment key={key++}>{cleaned}</Fragment>);
  };

  while ((m = tokenRe.exec(text)) !== null) {
    if (m.index > last) pushPlain(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold text-white">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={key++} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = tokenRe.lastIndex;
  }
  if (last < text.length) pushPlain(text.slice(last));

  return <>{nodes}</>;
}
