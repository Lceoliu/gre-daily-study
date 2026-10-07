// Applies the committed review data to the published JSON without the original local
// source folders: question corrections -> practice-data.json, memory aids -> study-data.json.
// Idempotent. Run: node scripts/apply-review-data.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const CORRECTIONS = "data/imports/2026-10-07-review-corrections.json";
const WORD_MEMORY = "data/word-memory.json";

if (existsSync(CORRECTIONS)) {
  const practice = readJson("public/data/practice-data.json");
  const changes = new Map(readJson(CORRECTIONS).records.map((item) => [item.id, item.changes]));
  let touched = 0;
  practice.records = practice.records.map((record) => {
    if (!changes.has(record.id)) return record;
    touched += 1;
    return { ...record, ...changes.get(record.id) };
  });
  if (touched !== changes.size) throw new Error(`Corrections reference ${changes.size - touched} unknown question IDs.`);
  writeFileSync("public/data/practice-data.json", JSON.stringify(practice), "utf8");
  console.log(`practice-data.json: applied corrections to ${touched} questions.`);
}

if (existsSync(WORD_MEMORY)) {
  const study = readJson("public/data/study-data.json");
  const memory = readJson(WORD_MEMORY).words;
  let attached = 0;
  for (const day of study.days) {
    day.words = day.words.map((word) => {
      const entry = memory[word.id];
      const { memory: _previous, ...rest } = word;
      if (entry?.word !== word.word) return rest;
      attached += 1;
      return { ...rest, memory: { method: entry.method, text: entry.text } };
    });
  }
  writeFileSync("public/data/study-data.json", `${JSON.stringify(study, null, 2)}\n`, "utf8");
  console.log(`study-data.json: attached memory aids to ${attached} of ${study.stats.words} words.`);
}
