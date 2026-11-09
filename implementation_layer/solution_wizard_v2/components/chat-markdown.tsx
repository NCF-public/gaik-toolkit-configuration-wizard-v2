"use client";

import { useEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "@/lib/markdown";

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;

// Mermaid is large, so it loads only when a message has a diagram. Strict mode
// keeps the diagram text from adding scripts or links, and a diagram that does
// not parse throws instead of drawing an error picture into the page.
function loadMermaid() {
  mermaidReady ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      fontFamily: "inherit",
      suppressErrorRendering: true,
    });
    return mermaid;
  });
  return mermaidReady;
}

let diagramCount = 0;

// An assistant message as HTML. Once the message is complete, its ```mermaid
// blocks are drawn as diagrams (the agent describes workflows that way); a
// block that does not parse stays as code.
export function ChatMarkdown({
  content,
  final,
  diagramLabel,
}: {
  content: string;
  /** False while the message is still streaming: a half diagram does not parse. */
  final: boolean;
  diagramLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // One object per content: React 19 writes innerHTML again whenever this prop
  // is a new object, which on every render (each streamed token of any message)
  // threw away a drawn diagram and the reader's text selection.
  const markup = useMemo(() => ({ __html: renderMarkdown(content) }), [content]);

  useEffect(() => {
    if (!final || !ref.current?.querySelector("pre > code.language-mermaid")) return;
    let cancelled = false;
    void (async () => {
      let mermaid: Awaited<ReturnType<typeof loadMermaid>>;
      try {
        mermaid = await loadMermaid();
      } catch {
        mermaidReady = null; // try again with the next message
        return;
      }
      // Look the blocks up only now: while mermaid loaded, React may have
      // written the message's HTML again, which leaves earlier nodes detached.
      const root = ref.current;
      if (cancelled || !root) return;
      const blocks = [...root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
      for (const code of blocks) {
        const pre = code.parentElement;
        const source = code.textContent ?? "";
        if (cancelled || !pre?.isConnected) return;
        try {
          if (!(await mermaid.parse(source, { suppressErrors: true }))) continue;
          const { svg } = await mermaid.render(`chat-diagram-${++diagramCount}`, source);
          if (cancelled || !pre.isConnected) return;
          const figure = document.createElement("figure");
          figure.className = "chat-diagram";
          figure.setAttribute("role", "img");
          if (diagramLabel) figure.setAttribute("aria-label", diagramLabel);
          figure.dataset.testid = "chat-diagram";
          figure.innerHTML = svg;
          pre.replaceWith(figure);
        } catch {
          // Leave the code block as it is.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [markup, final, diagramLabel]);

  return <div ref={ref} className="chat-md-body" dangerouslySetInnerHTML={markup} />;
}
