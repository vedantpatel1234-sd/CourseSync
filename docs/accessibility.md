# Accessibility

Status as of 2026-10-28. **Self-assessed against WCAG 2.1 AA and partly tested by machine. Not audited by a person using assistive technology, and not independently certified.** Do not describe CourseSync as "WCAG conformant" to a customer until the manual checks in section 4 have been done and recorded here.

## 1. What is checked automatically (and runs in CI on every change)

| Check | Where | What it catches |
|---|---|---|
| axe-core on every route, as every role | `src/a11y/routes.test.tsx` | Missing names, roles, landmarks, ARIA mistakes, duplicate ids, heading order |
| The same, with every "Add…" and "Edit" form opened | same file | Problems that only exist once a form or an in-place editor is showing |
| Strict label rule | `src/test/axe.ts` (`labelProblems`) | A visible label not connected to its field, or a field named only by its placeholder. axe accepts a placeholder as a name; screen readers then announce the placeholder instead of the field name |
| Text colour contrast | `src/lib/contrast.test.ts` | Reads every inline text colour and its background from the source and fails below 4.5:1. jsdom cannot measure contrast, so axe's own contrast rule is switched off in tests |
| Dialog behaviour | `src/lib/useDialog.test.tsx`, `src/components/dialogs.test.tsx` | Focus moves in, Tab stays inside, Escape works where allowed, focus returns afterwards, dialogs are named |
| Skip link, page titles, focus after navigation | `src/components/layout/AppLayout.test.tsx`, `src/lib/pageTitles.test.ts` | Keyboard and screen-reader orientation in a single-page app |

Each check was proved able to fail by deliberately breaking the code (removing a label link, removing an edit-row label, reintroducing a low-contrast grey) and confirming the test caught it.

## 2. What was fixed in the first pass

- **Labels.** 31 visible labels were not connected to their fields (only 3 of 36 were). All are connected now, and 11 fields with no label at all (filters, edit-in-place rows, the AI chat box) were given `aria-label`s.
- **Keyboard focus** was invisible on every input that set `outline: none` inline. A global `:focus-visible` ring now overrides it (checked in a real browser).
- **Dialogs.** The four modal dialogs had no dialog role, name, focus handling or Escape. They now share one tested hook. The session-timeout warning starts on "Stay signed in", and Escape means stay signed in.
- **Skip link, per-page titles, and focus moved to the content after navigation.** Previously a screen-reader user heard nothing when changing page.
- **Landmarks.** Public pages now have a main landmark; the sidebar navigation is named.
- **Controls.** The password show/hide button, the notification switches (now real switches), the remove and reorder buttons in Preferences, the FAQ accordions (`aria-expanded`) and the filter and tab buttons (`aria-pressed`) now expose their name and state.
- **Tables.** Empty action-column headers now say "Actions" to screen readers.
- **Contrast.** One grey (`#9CA3AF`, 2.5:1) used for real text and icons was replaced with the passing `#6B6B80`.
- **Mobile menu.** Closed off-screen links are no longer reachable by keyboard or screen reader. The sign-out confirmation no longer renders inside the transformed drawer, where it would have been clipped to the drawer's width.
- **Motion.** `prefers-reduced-motion` is honoured.

## 3. Known gaps and things not measured

- **No screen reader has been used on the app** (NVDA, JAWS, VoiceOver). Automated tools find roughly a third of real problems.
- **Contrast is measured only for hex text colours on hex or white backgrounds.** Text over gradients, translucent colours, chart colours and status colours in the calendar grid are not measured. Placeholder colour is the browser default.
- **Charts (Recharts) have no text alternative or data table.** The analytics pages are not usable by a blind user today. This is the largest known gap.
- **Reordering preferences is drag-and-drop.** A keyboard alternative exists through the drag library, but there is no single-click alternative (up/down buttons), which WCAG 2.2 criterion 2.5.7 asks for.
- **Form errors are shown as toast notifications**, not tied to the field with `aria-invalid` and `aria-describedby`. Toasts are announced, but the error is not programmatically associated with its field (WCAG 3.3.1 is only partly met).
- **Calendar grid and availability grid semantics** have not been reviewed for screen readers.
- **Zoom and reflow** at 200% and 400%, **touch-target size**, **high-contrast mode** and **text-spacing overrides** have not been tested.
- **Tables with many rows** are covered only through one sample row per table.
- **Language of the legal documents and AI-generated text** is assumed to be English.
- The mobile drawer's hidden-until-open behaviour is CSS and could not be tested in jsdom; it was not tried while signed in on a real phone.

## 4. Manual checks to do before claiming conformance

Allow about half a day. Record the date, who did it, the browser and screen reader, and what failed.

1. **Keyboard only:** sign in, then do each core task (add a course, add a section, assign an instructor, publish a draft, change availability, sign out) without touching the mouse. Focus must always be visible and never trapped.
2. **NVDA with Firefox or Chrome** (free), and **VoiceOver with Safari**: repeat the same tasks with the screen off. Listen for unnamed controls, missing page changes, and anything announced that makes no sense.
3. **Zoom:** 200% and 400% browser zoom at 1280 px wide. Nothing should need horizontal scrolling or be cut off.
4. **Windows High Contrast / forced colours** and the OS "reduce motion" setting.
5. **Phone:** open the menu, tab or swipe through it, and use the sign-out confirmation on a real device.
6. **Charts:** decide on the text alternative (a data table under each chart is the simplest) and add it.

## 5. What to say to a college

Accurate wording today: "CourseSync has been built and tested against WCAG 2.1 AA with automated checks on every release. A full manual audit with assistive technology is planned and a report will be available on request." Do not say "compliant", "conformant" or "certified". If a college asks for a VPAT, say one will be produced after the manual checks in section 4, and send them this document in the meantime.

## 6. Running the checks

```bash
npx vitest run src/a11y src/lib/contrast.test.ts src/components/dialogs.test.tsx
```

When adding a page, add its path to the route lists in `src/a11y/routes.test.tsx` and to `src/lib/pageTitles.ts`. A new form control needs a real `<label htmlFor>` or an `aria-label`; the tests will fail otherwise.
