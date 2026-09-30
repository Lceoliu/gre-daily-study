# GRE Daily Study

Mobile-first GRE study web app for the 30-day vocabulary list and public practice PDFs in the parent folder.

## Local Run

```bash
npm install
npm run prepare:data
npm run dev
```

The app serves at `http://127.0.0.1:5173/` in development.

## Build

```bash
npm run build
```

The build output is `dist/`. Use `npm run build:fresh` locally when the source vocabulary/PDF folders changed and `public/data` plus `public/pdfs` need to be regenerated first.

## Deploy

Vercel:

- Import this folder as a Vite project.
- Build command: `npm run build`
- Output directory: `dist`

GitHub Pages:

- Commit this folder to a repository.
- Build with `npm run build`.
- Publish the generated `dist/` directory.

## Notes

### Practice bank — September 2026 import

- 43 source PDFs, 1,138 Verbal questions, and 30 Issue prompts. The latest 22 PDFs add 573 Verbal questions and 12 Issue prompts; mathematics remains in the original PDFs.
- New answer keys and Chinese explanations are AI inferences, not official answers. The practice screen labels them accordingly; unavailable answers are not scored.
- Source links open the original PDF at the question's page. New sets can be filtered by month and set number.
- Phone practice has fixed previous/random/next controls, larger touch targets, and automatic scrolling to the next question. Existing local progress and essay drafts remain on the device; materially corrected questions invalidate only their own previous response.
- Reviewed import data lives in `data/imports/`; stable PDF names are registered in `data/pdf-sources.json`. Source PDFs can contain missing question pages; missing questions are not invented.

Run `node scripts/validate-practice-data.mjs` before publishing. GitHub Pages also runs this validation before building.

- Word progress, saved words, and the study start date are stored in browser `localStorage`.
- Pronunciation uses dictionary audio from `dictionaryapi.dev` when available and caches lookup results in `localStorage`. It does not fall back to browser SpeechSynthesis, because synthetic voices can mispronounce GRE vocabulary.
- Detailed dictionary entries are not invented. The app displays the existing explanation and synonym fields from the source word list.
- Practice PDFs are rendered in-app with PDF.js when possible, with an `Open PDF` fallback for the original file.
