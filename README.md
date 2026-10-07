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

## Accounts and multi-device sync (Supabase)

Signed-in learners get their word progress (mastered/saved), practice answers and wrong-question book, marked questions, Issue essay drafts and study start date synced across devices. Without Supabase settings the app stays device-only, exactly as before.

How it works: every learner edit is one row in `public.study_items` (row-level security: each account can only read and write its own rows). Devices push changes in the background and pull others' changes on open, on focus, every minute, and through Supabase Realtime. Conflicts resolve per item by last edit time. The first time a device signs in, existing local progress is merged with the account copy, so neither side is lost. Offline edits wait in local storage and upload later.

One-time setup (about 10 minutes):

1. Create a free project at [supabase.com](https://supabase.com). Before relying on it, check that `https://<project-ref>.supabase.co` loads on every network you study from: some ISPs have blocked `*.supabase.co` (India did in February 2026). Supabase custom domains (a paid add-on) avoid that domain.
2. Open **SQL Editor**, paste [`supabase/migrations/20261007000000_study_sync.sql`](supabase/migrations/20261007000000_study_sync.sql) and run it. It is safe to re-run.
3. **Authentication → URL Configuration**: set **Site URL** to the deployed app URL (for example `https://<user>.github.io/gre-daily-study/`) and add `http://127.0.0.1:5173/` under **Redirect URLs** for local development.
4. Optional, under **Authentication → Providers → Email**: turn off **Confirm email** to sign in right after registering.
5. **Project Settings → API**: copy the Project URL and the `anon` (publishable) key. In GitHub, go to **Settings → Secrets and variables → Actions → Variables** and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Push to `main` (or rerun the Pages workflow) to redeploy. For local development, copy `.env.example` to `.env.local`.
6. Open the app, tap **账户** in the header, and register with email and password. To make the deployment a single fixed account, turn off **Allow new users to sign up** under **Authentication → Providers → Email** once your account exists.

The anon key is designed to be public; access control comes from the RLS policies in the migration. Free Supabase projects pause after a week without traffic. If sync stops, open the Supabase dashboard and resume the project.

`node scripts/test-sync-engine.mjs` simulates several devices (offline edits, conflicts, deletions, first-login merge) against an in-memory server that follows the same rules as the SQL function. CI runs it before every Pages build.

### October 2026 content review

- Proofreading agents compared every question with its source PDF screenshot. Their fixes (OCR typos, UI text that leaked into questions, option text merged into the stem, options restored to PDF order) are stored in `data/imports/2026-10-07-review-corrections.json`, with a per-fix audit trail in `data/imports/2026-10-07-review-log.json`.
- Answer keys were re-solved independently. A key changed only when the disagreement held up on a second review against the question text. Changed keys are labelled `ai_inferred` and bump `responseRevision`, which resets only that question's saved response.
- Every vocabulary word now has a memory aid (word roots/affixes, origin, sound-alike or association) in `data/word-memory.json`. These are AI-written. Roots and origins aim to be real etymology; 联想 and 谐音 entries are mnemonics only.
- `node scripts/apply-review-data.mjs` re-applies both files to `public/data` without the original source folders. `scripts/prepare-data.mjs` and `scripts/build-public-practice-data.mjs` also pick them up.

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
