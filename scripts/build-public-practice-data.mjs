import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "public", "data", "practice-data.json");

const QUESTION_TYPE_LABELS = {
  text_completion: "Text Completion",
  sentence_equivalence: "Sentence Equivalence",
  reading_comprehension: "Reading Comprehension",
  issue_task: "Issue Essay",
};

const EXPECTED_RESPONSE_FORMAT_COUNTS = {
  five_choice_one: 277,
  six_choice_two: 147,
  two_blanks_three_each: 42,
  three_blanks_three_each: 56,
  three_choice_multi_select: 36,
  passage_sentence_selection: 7,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8"));
}

function normalizeText(value) {
  return repairPublicText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .trim();
}

function repairPublicText(value) {
  return String(value || "")
    .replace(/([A-Za-z])'\s+s\b/g, "$1's")
    .replace(/1971-1990/g, "1971–1990")
    .replace(/food poisoning[-—]\s+primarily bacterial—affected/g, "food poisoning—primarily bacterial—affected")
    .replace(
      /use aqg ddds sse s s sty Nielsen\)/g,
      "use aggregate data (usually secondary analyses supplied by Nielsen)",
    );
}

function repairPublicValue(value) {
  if (typeof value === "string") return repairPublicText(value);
  if (Array.isArray(value)) return value.map(repairPublicValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, repairPublicValue(item)]));
  }
  return value;
}

function countBy(items, keyFor) {
  return Object.fromEntries(
    [...items.reduce((counts, item) => {
      const key = keyFor(item);
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function compactSource(source) {
  return {
    file: source.pdf_file,
    page: source.page,
    section: source.section,
    questionNumber: source.question_number,
  };
}

async function main() {
  const [questionBank, answerBank, essayBank] = await Promise.all([
    readJson("local-data/verbal-question-bank/verbal-question-bank.json"),
    readJson("local-data/verbal-answer-bank-all/verbal-answer-bank-all-565.json"),
    readJson("local-data/essay-prompts/essay-prompts.json"),
  ]);

  const passagesById = new Map(questionBank.passage_groups.map((passage) => [passage.id, passage]));
  const answersById = new Map(answerBank.records.map((record) => [record.id, record]));
  const responseFormatCounts = countBy(questionBank.records, (record) => record.response_format?.id || "unknown");

  assert(questionBank.records.length === 565, `Expected 565 verbal records, found ${questionBank.records.length}.`);
  assert(answerBank.records.length === questionBank.records.length, "Every verbal question must have exactly one answer record.");
  assert(essayBank.prompts.length === 18, `Expected 18 Issue prompts, found ${essayBank.prompts.length}.`);

  for (const [format, expectedCount] of Object.entries(EXPECTED_RESPONSE_FORMAT_COUNTS)) {
    assert(responseFormatCounts[format] === expectedCount, `Unexpected ${format} count: ${responseFormatCounts[format] || 0}.`);
  }

  const verbalRecords = questionBank.records.map((question) => {
    const answerRecord = answersById.get(question.id);
    assert(answerRecord, `Missing answer record for ${question.id}.`);
    const passage = question.passage_group_id ? passagesById.get(question.passage_group_id) : null;
    assert(!question.passage_group_id || passage, `Missing passage group ${question.passage_group_id} for ${question.id}.`);

    if (question.response_format?.id === "passage_sentence_selection") {
      const sentenceText = answerRecord.answer?.sentence_text;
      assert(
        normalizeText(passage?.text).includes(normalizeText(sentenceText)),
        `Sentence-selection answer does not occur in its passage: ${question.id}.`,
      );
    }

    return {
      id: question.id,
      category: "verbal",
      source: compactSource(question.source),
      questionType: question.question_type,
      typeLabel: QUESTION_TYPE_LABELS[question.question_type] || question.question_type_label,
      responseFormat: question.response_format,
      directions: question.directions,
      topic: question.topic,
      topicTags: question.topic_tags,
      passage: passage ? { id: passage.id, text: repairPublicText(passage.text) } : null,
      questionText: repairPublicText(question.question_text),
      options: repairPublicValue(question.options),
      optionGroups: repairPublicValue(question.option_groups),
      answer: repairPublicValue(answerRecord.answer),
      translation: repairPublicValue(answerRecord.translation),
      vocabulary: repairPublicValue(answerRecord.vocabulary),
    };
  });

  const essayRecords = essayBank.prompts.map((prompt) => ({
    id: prompt.id,
    category: "essay",
    source: {
      file: prompt.pdf_file,
      page: prompt.page,
      section: 1,
      questionNumber: 1,
    },
    questionType: "issue_task",
    typeLabel: QUESTION_TYPE_LABELS.issue_task,
    promptText: repairPublicText(prompt.prompt_text),
  }));

  const records = [...verbalRecords, ...essayRecords];
  const ids = new Set(records.map((record) => record.id));
  assert(ids.size === records.length, "Public practice records contain duplicate IDs.");

  const payload = {
    schemaVersion: 1,
    scope: "Public GRE verbal practice questions and Issue essay prompts",
    stats: {
      totalQuestionCount: records.length,
      verbalQuestionCount: verbalRecords.length,
      issuePromptCount: essayRecords.length,
      questionTypeCounts: countBy(records, (record) => record.questionType),
      responseFormatCounts,
    },
    records,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(payload), "utf8");
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)} (${records.length} records, ${bytes.toLocaleString("en-US")} bytes).`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
