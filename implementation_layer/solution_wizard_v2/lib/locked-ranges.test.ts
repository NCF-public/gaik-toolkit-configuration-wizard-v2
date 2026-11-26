import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { lockedRanges, lockedRangesField } from "@/lib/locked-ranges";

const doc = '{\n  "a": 1,\n  "locked": 2\n}';
const from = doc.indexOf('"locked"');
const to = doc.indexOf("2\n}") + 1;

function state() {
  return EditorState.create({ doc, extensions: lockedRanges([{ from, to }]) });
}

describe("locked ranges", () => {
  it("refuses a change inside a locked range", () => {
    const s = state().update({ changes: { from: from + 2, to: from + 3, insert: "X" } }).state;
    expect(s.doc.toString()).toBe(doc);
  });

  it("lets a change outside the locked ranges through", () => {
    const at = doc.indexOf("1");
    const s = state().update({ changes: { from: at, to: at + 1, insert: "42" } }).state;
    expect(s.doc.toString()).toBe(doc.replace("1", "42"));
  });

  it("keeps the range on its text after an edit before it", () => {
    let s = state().update({ changes: { from: 1, insert: "\n" } }).state;
    const ranges: [number, number][] = [];
    s.field(lockedRangesField).between(0, s.doc.length, (f, t) => {
      ranges.push([f, t]);
    });
    expect(ranges).toEqual([[from + 1, to + 1]]);
    s = s.update({ changes: { from: from + 3, insert: "X" } }).state;
    expect(s.doc.toString()).toBe(doc.slice(0, 1) + "\n" + doc.slice(1));
  });

  it("is nothing without ranges", () => {
    const s = EditorState.create({ doc, extensions: lockedRanges([]) });
    expect(s.update({ changes: { from: from + 2, insert: "X" } }).state.doc.length).toBe(doc.length + 1);
  });

  it("tells onBlocked when a change touches a locked range, whole or in part", () => {
    const onBlocked = vi.fn();
    const s = EditorState.create({ doc, extensions: lockedRanges([{ from, to }], onBlocked) });
    s.update({ changes: { from: from + 2, to: from + 3, insert: "X" } });
    expect(onBlocked).toHaveBeenCalledTimes(1);
    // A paste across the range's start: cut, and told.
    s.update({ changes: { from: from - 3, to: from + 4, insert: "pasted" } });
    expect(onBlocked).toHaveBeenCalledTimes(2);
  });

  it("does not tell onBlocked of a change elsewhere or of a selection", () => {
    const onBlocked = vi.fn();
    const s = EditorState.create({ doc, extensions: lockedRanges([{ from, to }], onBlocked) });
    const at = doc.indexOf("1");
    const next = s.update({ changes: { from: at, to: at + 1, insert: "42" } }).state;
    expect(next.doc.toString()).toBe(doc.replace("1", "42"));
    s.update({ selection: { anchor: from + 2 } });
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
