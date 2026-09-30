import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(projectRoot, "..");
const wordRoot = path.join(sourceRoot, "结构化词表", "乱序30份");
const pdfRoot = path.join(sourceRoot, "真题");
const publicRoot = path.join(projectRoot, "public");
const dataRoot = path.join(publicRoot, "data");
const publicPdfRoot = path.join(publicRoot, "pdfs");

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function countPdfPages(filePath) {
  const buffer = readFileSync(filePath);
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : null;
}

function normalizeWord(raw) {
  const synonyms = String(raw["同义词"] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    id: `w${raw["编号"]}`,
    number: raw["编号"],
    word: String(raw["单词"] || "").trim(),
    explanation: String(raw["解释"] || "").trim(),
    synonyms,
  };
}

function loadDays() {
  if (!existsSync(wordRoot)) {
    throw new Error(`Word source folder not found: ${wordRoot}`);
  }

  return readdirSync(wordRoot)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
    .map((fileName, index) => {
      const words = readJson(path.join(wordRoot, fileName)).map(normalizeWord);
      return {
        day: index + 1,
        sourceFile: fileName,
        words,
      };
    });
}

function loadPdfs() {
  if (!existsSync(pdfRoot)) {
    return [];
  }

  ensureDir(publicPdfRoot);
  const previous = existsSync(path.join(dataRoot, "study-data.json"))
    ? readJson(path.join(dataRoot, "study-data.json")).pdfs : [];
  const registered = readJson(path.join(projectRoot, "data", "pdf-sources.json")).pdfs;
  const known = new Map([...previous, ...registered].map((pdf) => [pdf.originalName, pdf]));
  let nextNumber = Math.max(0, ...[...known.values()].map((pdf) => Number(pdf.fileName.match(/practice-(\d+)/)[1]))) + 1;

  return readdirSync(pdfRoot, { recursive: true })
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => name.replaceAll("\\", "/"))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }))
    .map((originalName) => {
      const sourcePath = path.join(pdfRoot, originalName);
      const existing = known.get(originalName);
      const number = existing ? Number(existing.fileName.match(/practice-(\d+)/)[1]) : nextNumber++;
      const fileName = `practice-${String(number).padStart(2, "0")}.pdf`;
      const targetPath = path.join(publicPdfRoot, fileName);
      if (existsSync(targetPath)) {
        chmodSync(targetPath, 0o666);
        rmSync(targetPath, { force: true });
      }
      copyFileSync(sourcePath, targetPath);
      chmodSync(targetPath, 0o666);

      return {
        id: `pdf${String(number).padStart(2, "0")}`,
        title: existing?.title || originalName.replace(/\.pdf$/i, ""),
        originalName,
        fileName,
        pageCount: countPdfPages(sourcePath),
      };
    }).sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
}

ensureDir(dataRoot);

const days = loadDays();
const pdfs = loadPdfs();
const payload = {
  generatedAt: new Date().toISOString(),
  days,
  pdfs,
  stats: {
    days: days.length,
    words: days.reduce((total, day) => total + day.words.length, 0),
    pdfs: pdfs.length,
  },
};

writeFileSync(path.join(dataRoot, "study-data.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Prepared ${payload.stats.words} words across ${payload.stats.days} days.`);
console.log(`Prepared ${payload.stats.pdfs} practice PDFs.`);
