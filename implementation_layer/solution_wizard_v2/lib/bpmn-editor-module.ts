/**
 * The Workflow tab's editing tools, as a bpmn-js module.
 *
 * A save regenerates the diagram from the blueprint (see lib/bpmn-edit-state),
 * so the canvas offers only the edits a save keeps: adding a task and
 * connecting steps from the palette, renaming and deleting from the context
 * pad. bpmn-js's full set (events, gateways, pools, lanes, groups, type
 * changes) let a business user draw things that vanished on the next save.
 *
 * Labels come in through the modeler's `gaikEditor` config, in the UI language.
 */
import CommandInterceptor from "diagram-js/lib/command/CommandInterceptor";
import type DiagramEventBus from "diagram-js/lib/core/EventBus";
import RuleProvider from "diagram-js/lib/features/rules/RuleProvider";
import {
  BPMN_TASK_TYPES,
  isDeletableBpmnType,
  isRenamableBpmnType,
} from "@/lib/bpmn-edit-state";

export type BpmnEditorLabels = {
  addTask: string;
  connect: string;
  rename: string;
  remove: string;
};

type Shape = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  labelTarget?: Shape;
  incoming: Connection[];
  outgoing: Connection[];
};
type Connection = { id: string; type: string; source: Shape; target: Shape };
type Entry = Record<string, unknown>;
type Entries = Record<string, Entry>;

type Palette = { registerProvider: (priority: number, provider: unknown) => void };
type ContextPad = { registerProvider: (priority: number, provider: unknown) => void };
type DirectEditing = { activate: (element: Shape) => boolean };
type Modeling = {
  removeElements: (elements: Shape[]) => void;
  reconnectEnd: (connection: Connection, target: Shape, point: { x: number; y: number }) => void;
};

/** The element a label belongs to: renaming a data object's label renames the data object. */
const owner = (el: Shape) => el.labelTarget ?? el;

// Lucide "pencil" (ISC), the same icon set as components/icons.tsx.
const PENCIL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22242a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
  );

/** Only "Lisää tehtävä" and "Yhdistä" stay in the palette. */
class GaikPalette {
  static $inject = ["palette", "config.gaikEditor"];
  constructor(
    palette: Palette,
    private config: { labels: BpmnEditorLabels },
  ) {
    // After bpmn-js's own provider (priority 1000), so its entries are there to pick from.
    palette.registerProvider(500, this);
  }
  getPaletteEntries() {
    const { labels } = this.config;
    return (entries: Entries): Entries => {
      const out: Entries = {};
      if (entries["create.task"]) out["create.task"] = { ...entries["create.task"], title: labels.addTask };
      if (entries["global-connect-tool"]) {
        out["global-connect-tool"] = { ...entries["global-connect-tool"], title: labels.connect };
      }
      return out;
    };
  }
}

/** Rename for what keeps its name, delete for tasks and flows; nothing else. */
class GaikContextPad {
  static $inject = ["contextPad", "directEditing", "modeling", "config.gaikEditor"];
  constructor(
    contextPad: ContextPad,
    private directEditing: DirectEditing,
    private modeling: Modeling,
    private config: { labels: BpmnEditorLabels },
  ) {
    contextPad.registerProvider(500, this);
  }
  getContextPadEntries(element: Shape) {
    const { labels } = this.config;
    const target = owner(element);
    return (entries: Entries): Entries => {
      const out: Entries = {};
      if (isRenamableBpmnType(target.type)) {
        out.rename = {
          group: "edit",
          imageUrl: PENCIL,
          title: labels.rename,
          action: { click: () => this.directEditing.activate(element) },
        };
      }
      if (isDeletableBpmnType(target.type) && target === element) {
        out.delete = {
          ...(entries.delete ?? { group: "edit", className: "bpmn-icon-trash" }),
          title: labels.remove,
          action: { click: () => this.modeling.removeElements([element]) },
        };
      }
      return out;
    };
  }
  getMultiElementContextPadEntries(elements: Shape[]) {
    const { labels } = this.config;
    return (entries: Entries): Entries =>
      entries.delete && elements.every((el) => isDeletableBpmnType(el.type))
        ? { delete: { ...entries.delete, title: labels.remove } }
        : {};
  }
}

/**
 * What the keyboard and the mouse may still do: Delete removes only tasks and
 * flows, shapes do not resize (sizes come from the generator), and copying
 * is for tasks.
 */
class GaikRules extends RuleProvider {
  static $inject = ["eventBus"];
  init() {
    this.addRule("elements.delete", 2000, (context: { elements: Shape[] }) => {
      const allowed = context.elements.filter((el) => isDeletableBpmnType(el.type));
      return allowed.length ? allowed : false;
    });
    this.addRule("shape.resize", 2000, () => false);
    this.addRule("element.copy", 2000, (context: { element: Shape }) =>
      BPMN_TASK_TYPES.has(context.element.type) ? undefined : false,
    );
  }
}

/**
 * Deleting a step keeps the process in one piece: the flow into it goes on to
 * the step after it. bpmn-js does this only for a shape with exactly one
 * connection on each side, and the generator's tasks also carry data
 * associations, so it never applied; this counts sequence flows only.
 * Without it every step after a deleted one was unreachable from the start,
 * and the sync dropped them all.
 */
class GaikDeleteBehavior extends CommandInterceptor {
  static $inject = ["eventBus", "modeling"];
  constructor(eventBus: DiagramEventBus, modeling: Modeling) {
    super(eventBus);
    this.preExecute("shape.delete", (event: { context: { shape: Shape } }) => {
      const shape = event.context.shape;
      if (!BPMN_TASK_TYPES.has(shape.type)) return;
      const into = shape.incoming.filter((c) => c.type === "bpmn:SequenceFlow");
      const out = shape.outgoing.filter((c) => c.type === "bpmn:SequenceFlow");
      if (into.length !== 1 || out.length !== 1) return;
      const next = out[0].target;
      modeling.reconnectEnd(into[0], next, { x: next.x + next.width / 2, y: next.y + next.height / 2 });
    });

    // Double-click and the E key rename in place; only what a save keeps.
    eventBus.on("directEditing.activate.allowed", 2000, (e: { element: Shape }) =>
      isRenamableBpmnType(owner(e.element).type) ? undefined : false,
    );
  }
}

export const gaikEditorModule = {
  __init__: ["gaikPalette", "gaikContextPad", "gaikRules", "gaikDeleteBehavior"],
  gaikPalette: ["type", GaikPalette],
  gaikContextPad: ["type", GaikContextPad],
  gaikRules: ["type", GaikRules],
  gaikDeleteBehavior: ["type", GaikDeleteBehavior],
};
