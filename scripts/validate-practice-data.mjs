import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const data = JSON.parse(readFileSync("public/data/practice-data.json", "utf8"));
const study = JSON.parse(readFileSync("public/data/study-data.json", "utf8"));
const pdfs = new Map(study.pdfs.map((pdf) => [pdf.fileName, pdf]));
const ids = new Set();
const formats = new Set(["five_choice_one", "six_choice_two", "three_choice_multi_select", "two_blanks_three_each", "three_blanks_three_each", "passage_sentence_selection"]);
let aiAnswers = 0;
let pending = 0;
for (const q of data.records) {
  assert(!ids.has(q.id), `Duplicate ${q.id}`);
  ids.add(q.id);
  const pdf = pdfs.get(q.source.file);
  assert(pdf && existsSync(`public/pdfs/${q.source.file}`), `Missing PDF ${q.id}`);
  assert(q.source.page >= 1 && q.source.page <= pdf.pageCount, `Invalid page ${q.id}`);
  if (q.category === "essay") {
    assert(q.promptText.includes("Write a response"), `Missing essay directions ${q.id}`);
    continue;
  }
  const format = q.responseFormat.id;
  assert(formats.has(format), `Unknown format ${format}: ${q.id}`);
  assert(q.questionText.trim(), `Empty prompt ${q.id}`);
  const expected = {five_choice_one:5,six_choice_two:6,three_choice_multi_select:3}[format];
  for(const option of [...q.options,...q.optionGroups.flatMap(g=>g.choices)]) assert(!/^(ENG|Select\b)/.test(option.text),`OCR interface text in option ${q.id}: ${option.text}`);
  if (expected) {
    assert.equal(q.options.length, expected, `Option count ${q.id}`);
    assert.deepEqual(q.options.map(o=>o.label), "ABCDEF".slice(0,expected).split(""), `Option labels ${q.id}`);
  }
  if (format.includes("blanks_three_each")) {
    assert.equal(q.optionGroups.length, format.startsWith("two") ? 2 : 3, `Blank groups ${q.id}`);
    assert.deepEqual(q.optionGroups.map(g=>g.blank), ["(i)","(ii)","(iii)"].slice(0,q.optionGroups.length), `Blank names ${q.id}`);
    for(const g of q.optionGroups) assert.deepEqual(g.choices.map(o=>o.label), ["A","B","C"], `Group choices ${q.id}`);
  }
  if (["text_completion","sentence_equivalence"].includes(q.questionType)) {
    const count = q.responseFormat.blank_count || (format.startsWith("two") ? 2 : format.startsWith("three_blanks") ? 3 : 1);
    assert.equal((q.clozeText?.match(/\[\[BLANK:\d+\]\]/g)||[]).length,count,`Cloze markers ${q.id}`);
  }
  if(q.questionType==="reading_comprehension") assert(q.passage?.text,`Empty passage ${q.id}`);
  for(const text of q.passage?.highlights || []) assert(q.passage.text.includes(text), `Missing highlight ${q.id}`);
  const answer=q.answer;
  if(!answer){pending++;continue;}
  if(format==="five_choice_one") assert(answer.label, `Missing single answer ${q.id}`);
  if(format==="six_choice_two") assert.equal(answer.labels?.length,2,`Missing paired answer ${q.id}`);
  if(format==="three_choice_multi_select") assert(answer.labels?.length >= 1 && answer.labels.length <= 3,`Missing multi-select answer ${q.id}`);
  if(format.includes("blanks_three_each")) assert(answer.selections,`Missing blank answer ${q.id}`);
  if(q.answerProvenance==="ai_inferred") {
    aiAnswers++;
    assert(answer.rationale_zh?.length > 12,`Missing explanation ${q.id}`);
    assert(!["已核对源PDF页面与完整页面OCR；按题干逻辑和选项关系确定。","已核对源PDF各列选项及完整题干，按句法与逻辑确定。","源段落的具体事实/因果关系直接支持该选项。"].includes(answer.rationale_zh),`Placeholder explanation ${q.id}`);
    assert(!/依据题干与对应文章正文的直接语义关系推断|依据对应文章的中心论证、证据次序和题目限定逐题推断|依据共享文章正文逐题推断|依据对应 passage_groups.text 的论证结构|依据对应文章的因果链、明确事实与题目限定逐题推断|句意分别表达清晰的对比、因果或评价关系|句法和上下文分别表达完整意思/.test(answer.rationale_zh), `Template explanation ${q.id}`);
  }
  if(answer.label) assert(q.options.some(o=>o.label===answer.label && (q.answerProvenance!=="ai_inferred" || o.text===answer.text)),`Answer choice ${q.id}`);
  if(answer.labels) for(const [index,label] of answer.labels.entries()) assert(q.options.some(o=>o.label===label && (q.answerProvenance!=="ai_inferred" || o.text===answer.texts[index])),`Answer labels ${q.id}`);
  if(answer.selections) {
    assert.equal(answer.selections.length,q.optionGroups.length,`Answer groups ${q.id}`);
    for(const selection of answer.selections) assert(q.optionGroups.find(g=>g.blank===selection.blank)?.choices.some(o=>o.label===selection.label && o.text===selection.text),`Blank answer ${q.id}`);
  }
  if(format==="passage_sentence_selection") assert(answer.sentence_text && q.passage.text.replace(/\s+/g," ").includes(answer.sentence_text.replace(/\s+/g," ")),`Sentence answer ${q.id}`);
}
assert.equal(data.stats.totalQuestionCount, data.records.length);
assert.equal(data.stats.verbalQuestionCount, data.records.filter(q=>q.category==="verbal").length);
assert.equal(data.stats.issuePromptCount, data.records.filter(q=>q.category==="essay").length);
console.log(JSON.stringify({records:ids.size,pdfs:pdfs.size,aiAnswers,pending}));
