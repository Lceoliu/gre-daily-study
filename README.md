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

- Word progress, saved words, and the study start date are stored in browser `localStorage`.
- Pronunciation uses the device/browser SpeechSynthesis voice; no audio files are required.
- Detailed dictionary entries are not invented. The app displays the existing explanation and synonym fields from the source word list.
- Practice PDFs are rendered in-app with PDF.js when possible, with an `Open PDF` fallback for the original file.
