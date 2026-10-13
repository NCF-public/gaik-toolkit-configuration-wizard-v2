import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

/**
 * The agent's reply is model output, and `chat-panel.tsx` hands the result of
 * renderMarkdown() straight to `dangerouslySetInnerHTML`. That makes this the
 * one path from generated text into the DOM, so the escaping and the link
 * allowlist are pinned down here first, formatting second.
 */
describe("renderMarkdown — safety", () => {
  it("escapes HTML instead of emitting it", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML inside a fenced code block", () => {
    const html = renderMarkdown("```\n<img src=x onerror=alert(1)>\n```");
    expect(html).toContain("<pre><code>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it.each([
    ["javascript:", "[click](javascript:alert(1))"],
    ["mixed-case javascript:", "[click](JaVaScRiPt:alert(1))"],
    ["data:", "[click](data:text/html,<script>alert(1)</script>)"],
    ["vbscript:", "[click](vbscript:msgbox(1))"],
    ["protocol-relative", "[click](//evil.example/x)"],
  ])("does not linkify a %s URL — the label is kept as text", (_name, src) => {
    const html = renderMarkdown(src);
    expect(html).not.toContain("<a ");
    expect(html).toContain("click");
  });

  it("keeps a quote in a URL escaped, so it cannot break out of href", () => {
    // No space, so the link regex still matches — the escape pass is what
    // stops `onmouseover=` from becoming its own attribute.
    const html = renderMarkdown('[x](https://example.com"onmouseover=alert(1))');
    expect(html).toContain("&quot;");
    expect(html).not.toContain('"onmouseover');
  });

  it("escapes the link label", () => {
    const html = renderMarkdown("[<b>bold</b>](https://example.com)");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it.each([
    ["https", "https://example.com"],
    ["http", "http://example.com"],
    ["mailto", "mailto:someone@example.com"],
    ["root-relative", "/sessions/abc"],
    ["anchor", "#section"],
  ])("allows a %s link", (_name, url) => {
    const html = renderMarkdown(`[label](${url})`);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("label</a>");
  });

  it("opens external links without leaking the referrer or the opener", () => {
    const html = renderMarkdown("[label](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });
});

describe("renderMarkdown — formatting", () => {
  it("renders headings two levels down, capped at h6", () => {
    expect(renderMarkdown("# Title")).toBe("<h3>Title</h3>");
    expect(renderMarkdown("#### Deep")).toBe("<h6>Deep</h6>");
    expect(renderMarkdown("###### Deepest")).toBe("<h6>Deepest</h6>");
  });

  it("renders bold, italic and inline code", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
    expect(renderMarkdown("*italic*")).toContain("<em>italic</em>");
    expect(renderMarkdown("`code`")).toContain("<code>code</code>");
  });

  it("renders an unordered and an ordered list", () => {
    expect(renderMarkdown("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
    expect(renderMarkdown("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
  });

  it("renders a table inside its scroll wrapper", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain('<div class="md-table-wrap">');
    expect(html).toContain("<th>a</th><th>b</th>");
    expect(html).toContain("<tr><td>1</td><td>2</td></tr>");
  });

  it("renders a horizontal rule", () => {
    expect(renderMarkdown("---")).toBe("<hr>");
  });

  it("joins the lines of one paragraph with a line break", () => {
    expect(renderMarkdown("first\nsecond")).toBe("<p>first<br>second</p>");
  });

  it("starts a new paragraph after a blank line", () => {
    expect(renderMarkdown("first\n\nsecond")).toBe("<p>first</p><p>second</p>");
  });

  it("normalises CRLF input", () => {
    expect(renderMarkdown("first\r\n\r\nsecond")).toBe("<p>first</p><p>second</p>");
  });

  it("returns an empty string for empty or blank input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("\n\n")).toBe("");
  });
});
