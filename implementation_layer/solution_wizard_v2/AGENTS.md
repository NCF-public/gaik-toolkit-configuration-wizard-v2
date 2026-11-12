# Solution Wizard v2 web app: agent instructions

The repository's `AGENTS.md` (two levels up) applies here too: checks, who owns a change,
reviews. This file adds the rules for the interface.

## interface (quiet by default)

For any change to what a user sees in this app. An
element is there because it helps the user identify, compare, decide or act; an agent
adding a view tends to add more than that, and the customer reviews have asked for less
each time.

- Say a thing once on a screen. Before adding a line of text, read what the page, the
  steps panel, the tab and the chat already say there; a heading, a hint under it and a
  card that repeat one instruction are one line, not three.
- No filler: no badge, eyebrow label, counter or helper sentence that restates a label
  or explains an obvious button. Keep text that prevents an error, states a real
  constraint or makes an empty state actionable.
- No raw identifiers in the interface (`component_selection`, `knowledge_capture`, a
  JSON key, a step id). Show a plain-language label in Finnish and English; an unknown
  value is shown as readable text, and the technical value stays behind a disclosure.
- No card inside a card and no scroll box inside a scrolling view. Use the tokens and
  classes in `app/globals.css`; do not add a UI or animation library for one effect.
- A legal notice stays where it is required and in view (the AI notices under AI Act
  art. 50); it may be quieter, not removed.
- Motion: an animation starts from one user action or one named change of state (a
  panel opening, the workspace arriving beside the chat), and the pull request names
  that trigger. It moves `transform` and `opacity` only, lasts 150 to 320 ms, eases
  out without bounce, and does not run under `prefers-reduced-motion`. It never starts
  from `router.refresh()`, polling or a re-render: the page reads the session again
  after every chat reply, so anything tied to that plays on every reply. Check it by
  counting `Element.animate` and `document.startViewTransition` calls across a reply.
- Sentence case, the same word for the same thing on every tab, no emoji in the
  interface or in the wizard's replies.
- Look at the changed view in a browser at 1440 px and 390 px with the longest labels
  and an empty state before opening the pull request, and say so in it.
