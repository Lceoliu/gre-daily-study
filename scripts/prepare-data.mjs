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

  return readdirSync(pdfRoot)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
    .map((originalName, index) => {
      const sourcePath = path.join(pdfRoot, originalName);
      const fileName = `practice-${String(index + 1).padStart(2, "0")}.pdf`;
      const targetPath = path.join(publicPdfRoot, fileName);
      if (existsSync(targetPath)) {
        chmodSync(targetPath, 0o666);
        rmSync(targetPath, { force: true });
      }
      copyFileSync(sourcePath, targetPath);
      chmodSync(targetPath, 0o666);

      return {
        id: `pdf${String(index + 1).padStart(2, "0")}`,
        title: originalName.replace(/\.pdf$/i, ""),
        originalName,
        fileName,
        pageCount: countPdfPages(sourcePath),
      };
    });
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
