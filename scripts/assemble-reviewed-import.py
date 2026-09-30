"""Assemble the September 2026 review files; never infer answers here."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / "temp/import-20260930"


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def clean_text(text):
    text = text.translate(str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'}))
    # These exact desktop UI fragments were observed in the source screenshots.
    text = re.sub(r"^IP\s*:\s*[\d.]+\s*\([^)]*\)\s*bps:[^ ]+\s*fps:[^ ]+\s*frame\s*size\s*:?[^ ]+\s*(?:ser\s+)?", "", text)
    text = re.sub(r"\bC-client(?:\.?rar)?\b|\bToDesk\b", "", text)
    text = re.sub(r"^(?:M\s+)?\d{2}:\d{2}:\d{2}\s*[Θ⊖]?\s*Hide Time\s*", "", text)
    text = re.sub(r"^Section \d+ of \d+\s*\|\s*Ques(?:tion|lion) \d+ of \d+\s*", "", text)
    text = re.sub(r"\b([A-Za-z]+)'\s+(s|t|d|ll|ve|re|m)\b", r"\1'\2", text)
    text = re.sub(r"(?<=\w)-\s+(?=\w)", "-", text)
    return re.sub(r"\s+", " ", text).strip()


records = []
issues = []
titles = {r["fileName"]: r["title"] for r in read(ROOT / "data/pdf-sources.json")["pdfs"]}
types = {"text_completion": "Text Completion", "sentence_equivalence": "Sentence Equivalence", "reading_comprehension": "Reading Comprehension"}
for batch, bank_file, layout_file, answer_files in [
    ("april-may", "cloze-round2-question-bank.json", "cloze-round2-output/cloze-layouts.json", ["answers.json", "answers-final.json"]),
    ("june", "verbal-question-bank.curated.json", "cloze-layouts.json", ["answers-24-30.json", "answers-24-25-reviewed.json", "answers-26-27-reviewed.json", "answers-28-30-reviewed.json", "answers-31-38.json", "answers-31-38-reviewed.json", "answers-sentence-repair.json", "answers-28-final.json", "answers-29-30-final.json", "answers-root-final.json"]),
    ("july", "cloze-round2-question-bank.json", "cloze-round2-output/cloze-layouts.json", ["answers.json", "answers-39-40-reviewed.json", "answers-41-43-reviewed.json", "answers-39-40-final.json", "answers-41-43-final.json"]),
]:
    folder = REVIEW / batch
    bank = read(folder / bank_file)
    original = read(folder / "verbal/verbal-question-bank.json")
    passages = {p["id"]: p for p in original["passage_groups"]}
    if batch == "april-may":
        passages.update({p["id"]: p for p in read(folder / "recovered-verbal.json")["passage_groups"]})
    passages.update({p["id"]: p for p in bank.get("passage_groups", [])})
    layouts = {r["id"]: r for r in read(folder / layout_file)["records"]}
    answers = {}
    for filename in answer_files:
        if (folder / filename).exists():
            for item in read(folder / filename)["records"]:
                # Later reviews are authoritative, including withdrawal of a bad answer.
                answers[item["id"]] = item
    main_changes = {}
    if (folder / "main-text-corrections.json").exists():
        main_changes = {r["id"]: r for r in read(folder / "main-text-corrections.json")}
    text_changes = {}
    for filename in sorted(folder.glob("text-corrections*.json"), key=lambda p: (p.stem.endswith("final"), p.name)):
        payload = read(filename)
        for change in payload["records" if "records" in payload else "corrections"] if isinstance(payload, dict) else payload:
            if "passage_group_id" in change:
                passage = passages[change["passage_group_id"]]
                assert change["old"] in passage["text"] or change["new"] in passage["text"], change
                passage["text"] = passage["text"].replace(change["old"], change["new"])
                continue
            item = {**change, "id": change["id"] if "id" in change else change["question_id"], "new": change["new"] if "new" in change else change["corrected"]}
            text_changes.setdefault(item["id"], []).append(item)
    highlights = {}
    for filename in sorted(folder.glob("highlights*.json"), key=lambda p: (p.stem.endswith("final"), p.name)):
        payload = read(filename)
        for change in payload["records"] if isinstance(payload, dict) else payload:
            highlights[change["id"]] = change["highlights"]
    for q in bank["records"]:
        for change in text_changes.get(q["id"], []):
            assert change["field"] in q, (q["id"], change["field"])
            q[change["field"]] = change["new"]
        source = q["source"]
        passage = passages.get(q["passage_group_id"])
        layout = layouts.get(q["id"])
        cloze = clean_text(layout["cloze_text"]) if layout else None
        if q["id"] in text_changes and q["question_type"] in ["text_completion", "sentence_equivalence"] and re.search(r"_{3,}", q["question_text"]):
            count = {"five_choice_one": 1, "six_choice_two": 1, "two_blanks_three_each": 2, "three_blanks_three_each": 3}[q["response_format"]["id"]]
            assert len(re.findall(r"_{3,}", q["question_text"])) == count, q["id"]
            parts = re.split(r"_{3,}", clean_text(q["question_text"]))
            cloze = parts[0] + "".join(f"[[BLANK:{index}]]" + part for index, part in enumerate(parts[1:], 1))
        if q["question_type"] == "text_completion" and not cloze and re.search(r"_{3,}", q["question_text"]):
            # The reviewed reclassified single-blank records preserve their underline.
            assert q["response_format"]["id"] == "five_choice_one", q["id"]
            q["response_format"]["blank_count"] = 1
            cloze = re.sub(r"_{3,}", "[[BLANK:1]]", clean_text(q["question_text"]))
        inferred = answers.get(q["id"], {})
        answer = inferred.get("answer")
        options = [{**o, "text": clean_text(o["text"])} for o in q["options"]]
        groups = [{**g, "choices": [{**o, "text": clean_text(o["text"])} for o in g["choices"]]} for g in q["option_groups"]]
        # The extraction script incremented the letter i into j/k instead of Roman ii/iii.
        blank_names = {"(j)": "(ii)", "(k)": "(iii)"}
        for group in groups:
            group["blank"] = blank_names.get(group["blank"], group["blank"])
        if answer and "selections" in answer:
            for selection in answer["selections"]:
                selection["blank"] = blank_names.get(selection["blank"], selection["blank"])
        r = dict(id=q["id"], category="verbal", source=dict(file=source["pdf_file"], page=source["page"], section=source["section"], questionNumber=source["question_number"], title=titles[source["pdf_file"]]), questionType=q["question_type"], typeLabel=types[q["question_type"]], responseFormat=q["response_format"], directions=q["directions"], topic=q["topic"], topicTags=q["topic_tags"], passage={"id": passage["id"], "text": clean_text(passage["text"])} if passage else None, questionText=clean_text(q["question_text"]), clozeText=cloze, options=options, optionGroups=groups, answer=answer, answerProvenance="ai_inferred", answerModel=inferred.get("model"), translation=None, vocabulary=[])
        if q["id"] in main_changes:
            r.update({k: v for k, v in main_changes[q["id"]].items() if k in ["questionText", "clozeText", "options", "optionGroups", "passage"]})
        if r["passage"]:
            r["passage"]["text"] = re.sub(r"\bENG\b", "", r["passage"]["text"]).strip()
            r["passage"]["text"] = re.sub(r"\s+", " ", r["passage"]["text"])
            selected = highlights.get(r["id"], [])
            if not selected and "highlight" in r["questionText"].lower():
                quoted = re.findall(r'["“]([^"”]+)["”]', r["questionText"])
                selected = [word for word in quoted if r["passage"]["text"].count(word) == 1]
            selected = [clean_text(text) for text in selected]
            for text in selected:
                if text not in r["passage"]["text"]:
                    issues.append({"id": r["id"], "issue": "highlight_not_in_passage", "text": text})
            r["passage"]["highlights"] = [text for text in selected if text in r["passage"]["text"]]
        if answer:
            if "sentence_text" in answer:
                answer["sentence_text"] = clean_text(answer["sentence_text"])
            by_label = {o["label"]: o["text"] for o in options}
            if "label" in answer:
                assert answer["label"] in by_label, (q["id"], answer, options)
                answer["text"] = by_label[answer["label"]]
            if "labels" in answer:
                answer["texts"] = [by_label[label] for label in answer["labels"]]
            if "selections" in answer:
                by_blank = {g["blank"]: {o["label"]: o["text"] for o in g["choices"]} for g in groups}
                for selection in answer["selections"]:
                    assert selection["blank"] in by_blank, (q["id"], selection, list(by_blank))
                    selection["text"] = by_blank[selection["blank"]][selection["label"]]
        if not r["questionText"]:
            issues.append({"id": r["id"], "issue": "missing_question_text"})
        expected = {"five_choice_one": 5, "six_choice_two": 6, "three_choice_multi_select": 3}.get(r["responseFormat"]["id"])
        if expected and len(options) != expected:
            issues.append({"id": r["id"], "issue": "option_count", "actual": len(options), "expected": expected})
        if "blanks_three_each" in r["responseFormat"]["id"] and any(len(g["choices"]) != 3 for g in groups):
            issues.append({"id": r["id"], "issue": "group_option_count"})
        if r["questionType"] in ["text_completion", "sentence_equivalence"] and len(re.findall(r"\[\[BLANK:\d+\]\]", r["clozeText"] or "")) != r["responseFormat"].get("blank_count", 1):
            issues.append({"id": r["id"], "issue": "blank_count"})
        records.append(r)

assert len({r["id"] for r in records}) == len(records)
output = ROOT / "data/imports/2026-09-30-verbal.json"
output.write_text(json.dumps({"records": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(REVIEW / "assembly-issues.json").write_text(json.dumps(issues, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"records": len(records), "answered": sum(r["answer"] is not None for r in records), "structural_issues": issues}, ensure_ascii=False))
