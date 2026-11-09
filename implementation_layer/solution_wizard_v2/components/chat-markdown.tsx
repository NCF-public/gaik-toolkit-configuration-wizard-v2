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
      // Natural size: scaled to the chat's width, a wide flowchart's labels
      // shrank to 9 px. The figure scrolls sideways instead.
      flowchart: { useMaxWidth: false },
      sequence: { useMaxWidth: false },
      class: { useMaxWidth: false },
      state: { useMaxWidth: false },
      er: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      journey: { useMaxWidth: false },
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
  sourceLabel,
}: {
  content: string;
  /** False while the message is still streaming: a half diagram does not parse. */
  final: boolean;
  diagramLabel: string;
  sourceLabel: string;
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
          // The picture, and under it the text it was drawn from: a screen
          // reader cannot read the picture's boxes and arrows.
          const figure = document.createElement("figure");
          figure.className = "chat-diagram";
          figure.dataset.testid = "chat-diagram";
          const picture = document.createElement("div");
          picture.className = "chat-diagram-picture";
          picture.setAttribute("role", "img");
          if (diagramLabel) picture.setAttribute("aria-label", diagramLabel);
          picture.innerHTML = svg;
          // One image with one name; the source below carries the content.
          picture.querySelector("svg")?.setAttribute("aria-hidden", "true");
          const details = document.createElement("details");
          details.className = "chat-diagram-source";
          const summary = document.createElement("summary");
          summary.textContent = sourceLabel;
          const sourcePre = document.createElement("pre");
          const sourceCode = document.createElement("code");
          sourceCode.textContent = source;
          sourcePre.append(sourceCode);
          details.append(summary, sourcePre);
          figure.append(picture, details);
          pre.replaceWith(figure);
        } catch {
          // Leave the code block as it is.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [markup, final, diagramLabel, sourceLabel]);

  return <div ref={ref} className="chat-md-body" dangerouslySetInnerHTML={markup} />;
}
