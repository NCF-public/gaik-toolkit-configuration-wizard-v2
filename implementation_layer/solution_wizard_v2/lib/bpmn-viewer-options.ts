/** Shared bpmn-js constructor options — native labels hidden via markers, not zero font. */
export const BPMN_VIEWER_OPTIONS = {
  textRenderer: {
    defaultStyle: {
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: "12px",
      fontWeight: "500",
      lineHeight: 1.3,
    },
    externalStyle: {
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: "11px",
      fontWeight: "500",
      lineHeight: 1.3,
    },
  },
  bpmnRenderer: {
    defaultFillColor: "#dbeafe",
    defaultStrokeColor: "#3b82f6",
  },
} as const;
