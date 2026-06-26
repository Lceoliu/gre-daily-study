source visual truth path: D:\SKD\2026 spring\GRE\gre-daily-study\design-reference\study-desk-timeline.png
implementation screenshot path: D:\SKD\2026 spring\GRE\gre-daily-study\screenshots\today-cdp-final2.png
reader screenshot path: D:\SKD\2026 spring\GRE\gre-daily-study\screenshots\reader-cdp-after-base.png
viewport: 500 x 844 headless Edge, app body max width 430px
state: Today tab, Day 01, no mastered words; Reader tab, 2025.1.14 page 1
full-view comparison evidence: D:\SKD\2026 spring\GRE\gre-daily-study\screenshots\qa-concept-vs-today-same-width.png
focused region comparison evidence: Today focus word card and Reader PDF canvas screenshots inspected directly with view_image.

**Findings**
- No P0/P1/P2 findings remain.

**Checked Fidelity Surfaces**
- Fonts and typography: serif display treatment is preserved for Today, Day label, and vocabulary words; sans-serif UI labels are readable. The implementation uses smaller focus-word sizing than the mock so real words, audio, and hide controls fit on mobile.
- Spacing and layout rhythm: the timeline rail, circular section markers, progress block, focus word panel, and fixed bottom navigation match the selected Study Desk Timeline structure. Header and focus card spacing were compacted so Reveal/Mastered/Save are visible in the first viewport.
- Colors and visual tokens: white base, parchment focus area, forest green primary, lavender saved state, thin gray separators, and low-saturation palette match the intended direction.
- Image quality and asset fidelity: PDF questions are rendered from the actual PDF with PDF.js canvas in Reader. The Today practice thumbnail is simplified compared with the generated concept; the real PDF view is available from Reader and Open PDF.
- Copy and content: app uses real source fields only: word, explanation, synonyms, PDF titles, and page counts. IPA and detailed dictionary prose from the generated concept were intentionally not invented.

**Patches Made Since Previous QA Pass**
- Fixed Windows read-only PDF overwrite in `scripts/prepare-data.mjs`.
- Switched Reader from iframe-only fallback to PDF.js page rendering plus Open PDF fallback.
- Fixed PDF.js `getDocument({ url })` parameter shape.
- Added CDP-based screenshot helper to wait for asynchronous PDF canvas rendering.
- Compressed header and focus card vertical spacing so primary word actions are visible on first load.
- Changed Vite `base` to `./` for GitHub Pages-style static deployment.

**Open Questions**
- None blocking. If richer definitions or IPA are desired later, they need an additional dictionary/enrichment source.

**Implementation Checklist**
- Build passes with `npm run build`.
- Static data endpoint verified with HTTP 200.
- Practice PDF endpoint verified with HTTP 200 and `application/pdf`.
- Reader PDF canvas verified as `is-ready` after real browser wait.
- Local production preview remains available at `http://127.0.0.1:4173/`.

**Follow-up Polish**
- Code-split PDF.js so the initial Today tab downloads less JavaScript.
- Generate or render a true PDF thumbnail for the Today practice section.
- Add a start-date/settings drawer if the study calendar needs manual control beyond the reset button.

final result: passed
