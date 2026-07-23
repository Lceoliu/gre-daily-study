import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  List,
  Loader2,
  PencilLine,
  RotateCcw,
  Search,
  Volume2,
} from "lucide-react";

const STORAGE_KEY = "gre-daily-study-state-v1";
const START_DATE_KEY = "gre-daily-study-start-date";
const AUDIO_CACHE_KEY = "gre-daily-study-audio-cache-v1";
const PRACTICE_DRAFTS_KEY = "gre-daily-study-essay-drafts-v1";
const DICTIONARY_API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const BASE_URL = import.meta.env.BASE_URL || "/";

const navItems = [
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "list", label: "List", icon: List },
  { id: "practice", label: "Practice", icon: PencilLine },
  { id: "saved", label: "Saved", icon: Bookmark },
];

function getInitialTab() {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return navItems.some((item) => item.id === tab) ? tab : "today";
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function dateOnly(value) {
  return new Date(`${value}T00:00:00`);
}

function daysBetween(start, end) {
  return Math.floor((dateOnly(end) - dateOnly(start)) / 86400000);
}

function loadJsonStorage(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function getInitialStartDate() {
  const stored = window.localStorage.getItem(START_DATE_KEY);
  if (stored) return stored;
  const value = todayIso();
  window.localStorage.setItem(START_DATE_KEY, value);
  return value;
}

function parsePartOfSpeech(text) {
  const match = text.match(/\b(adj|adv|n|v|phrase)\./i);
  return match ? match[1].toLowerCase() : "word";
}

function compactExplanation(text) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeAudioWord(word) {
  return String(word || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ");
}

function getAudioCandidates(word) {
  const normalized = normalizeAudioWord(word);
  if (!normalized) return [];
  return normalized.includes(" ") ? [normalized, normalized.split(" ")[0]] : [normalized];
}

function pickAudioUrl(entries) {
  if (!Array.isArray(entries)) return null;
  const phonetics = entries.flatMap((entry) => entry.phonetics || []);
  const withAudio = phonetics
    .map((item) => item.audio)
    .filter(Boolean)
    .map((url) => (url.startsWith("//") ? `https:${url}` : url));
  return withAudio.find((url) => /-us\.mp3($|\?)/i.test(url)) || withAudio[0] || null;
}

async function resolveDictionaryAudio(word, cacheRef) {
  for (const candidate of getAudioCandidates(word)) {
    if (Object.prototype.hasOwnProperty.call(cacheRef.current, candidate)) {
      const cached = cacheRef.current[candidate];
      if (cached) return cached;
      continue;
    }

    try {
      const response = await fetch(`${DICTIONARY_API_BASE}${encodeURIComponent(candidate)}`);
      if (!response.ok) throw new Error(`Dictionary lookup failed: ${response.status}`);
      const audioUrl = pickAudioUrl(await response.json());
      cacheRef.current = { ...cacheRef.current, [candidate]: audioUrl };
      window.localStorage.setItem(AUDIO_CACHE_KEY, JSON.stringify(cacheRef.current));
      if (audioUrl) return audioUrl;
    } catch {
      cacheRef.current = { ...cacheRef.current, [candidate]: null };
      window.localStorage.setItem(AUDIO_CACHE_KEY, JSON.stringify(cacheRef.current));
    }
  }

  return null;
}

function getCachedDictionaryAudio(word, cacheRef) {
  for (const candidate of getAudioCandidates(word)) {
    if (!Object.prototype.hasOwnProperty.call(cacheRef.current, candidate)) continue;
    return cacheRef.current[candidate];
  }
  return undefined;
}

function getWordState(progress, id) {
  return progress[id] || { mastered: false, saved: false };
}

function mutateWordState(progress, id, patch) {
  return {
    ...progress,
    [id]: {
      ...getWordState(progress, id),
      ...patch,
    },
  };
}

function useStudyData() {
  const [state, setState] = useState({ data: null, error: null });

  useEffect(() => {
    let mounted = true;
    const fetchJson = (path) =>
      fetch(`${BASE_URL}data/${path}`).then((response) => {
        if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
        return response.json();
      });

    Promise.all([fetchJson("study-data.json"), fetchJson("practice-data.json")])
      .then(([studyData, practiceData]) => {
        if (mounted) setState({ data: { ...studyData, practice: practiceData }, error: null });
      })
      .catch((error) => {
        if (mounted) setState({ data: null, error });
      });

    return () => {
      mounted = false;
    };
  }, []);

  return state;
}

function IconButton({ children, className = "", ...props }) {
  return (
    <button className={`icon-button ${className}`} type="button" {...props}>
      {children}
    </button>
  );
}

function ActionButton({ icon: Icon, children, active = false, tone = "green", ...props }) {
  return (
    <button className={`action-button ${active ? "is-active" : ""} tone-${tone}`} type="button" {...props}>
      <Icon size={19} strokeWidth={2.1} />
      <span>{children}</span>
    </button>
  );
}

function EmptyState({ title, body }) {
  return (
    <section className="empty-state">
      <p>{title}</p>
      <span>{body}</span>
    </section>
  );
}

function LoadingScreen() {
  return (
    <main className="app-shell is-loading">
      <Loader2 className="spin" size={30} />
      <p>Loading GRE study plan</p>
    </main>
  );
}

function ErrorScreen({ error }) {
  return (
    <main className="app-shell is-loading">
      <p>Study data could not load.</p>
      <span>{error?.message || "Unknown error"}</span>
    </main>
  );
}

function TopHeader({ selectedDay, totalDays, progressLabel, dayProgress, onPrev, onNext, onResetStartDate }) {
  return (
    <header className="top-header">
      <div className="title-row">
        <h1>Today</h1>
        <IconButton aria-label="Use today as Day 01" onClick={onResetStartDate}>
          <CalendarDays size={26} />
        </IconButton>
      </div>

      <div className="day-switcher">
        <IconButton aria-label="Previous day" onClick={onPrev}>
          <ChevronLeft size={31} />
        </IconButton>
        <div className="day-title">
          <span className="day-icon">
            <CalendarDays size={25} />
          </span>
          <strong>
            Day <b>{String(selectedDay).padStart(2, "0")}</b> of {totalDays}
          </strong>
        </div>
        <IconButton aria-label="Next day" onClick={onNext}>
          <ChevronRight size={31} />
        </IconButton>
      </div>

      <div className="progress-block">
        <div>
          <span>Your progress</span>
          <strong>{progressLabel}</strong>
        </div>
        <div className="progress-line" aria-label={`Progress ${Math.round(dayProgress * 100)} percent`}>
          <span style={{ width: `${Math.max(2, dayProgress * 100)}%` }} />
        </div>
      </div>
    </header>
  );
}

function TimelineBadge({ icon: Icon, tone = "green" }) {
  return (
    <div className={`timeline-badge tone-${tone}`}>
      <Icon size={25} strokeWidth={2.1} />
    </div>
  );
}

function WordFocusCard({ word, state, reveal, audioStatus, onPronounce, onReveal, onToggleMastered, onToggleSaved }) {
  if (!word) return null;
  const pos = parsePartOfSpeech(word.explanation);
  const explanation = compactExplanation(word.explanation);
  const synonyms = word.synonyms.length ? word.synonyms.join(", ") : "No synonym listed";

  return (
    <section className="focus-card">
      <div className="focus-head">
        <div>
          <div className="focus-word-line">
            <h3>{word.word}</h3>
            <IconButton aria-label={`Pronounce ${word.word}`} onClick={() => onPronounce(word.word)}>
              <Volume2 size={24} />
            </IconButton>
          </div>
          <span className="voice-note">{audioStatus || "dictionary audio"}</span>
        </div>
        <button className="hide-button" type="button" onClick={onReveal}>
          {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
          <span>{reveal ? "Hide" : "Reveal"}</span>
        </button>
      </div>

      <p className="part-of-speech">{pos}</p>

      <div className={`meaning-block ${reveal ? "" : "is-hidden"}`}>
        <p>{explanation}</p>
        <div>
          <span>Synonym</span>
          <strong>{synonyms}</strong>
        </div>
      </div>

      <div className="focus-actions">
        <ActionButton icon={reveal ? EyeOff : Eye} onClick={onReveal}>
          {reveal ? "Hide" : "Reveal"}
        </ActionButton>
        <ActionButton icon={CheckCircle2} active={state.mastered} onClick={onToggleMastered}>
          Mastered
        </ActionButton>
        <ActionButton icon={state.saved ? BookmarkCheck : Bookmark} active={state.saved} tone="lavender" onClick={onToggleSaved}>
          Save
        </ActionButton>
      </div>
    </section>
  );
}

function UpcomingWords({ words, progress, onSpeak, onToggleSaved }) {
  return (
    <div className="upcoming-list">
      {words.map((word, index) => {
        const state = getWordState(progress, word.id);
        return (
          <article className="upcoming-row" key={word.id}>
            <span>{String(index + 2).padStart(2, "0")}</span>
            <strong>{word.word}</strong>
            <IconButton aria-label={`Pronounce ${word.word}`} onClick={() => onSpeak(word.word)}>
              <Volume2 size={19} />
            </IconButton>
            <IconButton
              aria-label={state.saved ? `Unsave ${word.word}` : `Save ${word.word}`}
              className={state.saved ? "is-saved" : ""}
              onClick={() => onToggleSaved(word)}
            >
              {state.saved ? <BookmarkCheck size={19} /> : <Bookmark size={19} />}
            </IconButton>
          </article>
        );
      })}
    </div>
  );
}

function DailyPracticePanel({ question, totalCount, onOpenPractice }) {
  if (!question) return null;
  const preview = question.category === "essay" ? question.promptText : question.questionText || question.passage?.text;

  return (
    <section className="daily-practice-panel">
      <div className="daily-practice-copy">
        <span>{question.typeLabel}</span>
        <h3>{question.id}</h3>
        <p>{preview}</p>
      </div>
      <button className="practice-start-button" type="button" onClick={() => onOpenPractice(question)}>
        Start question
      </button>
      <small>{totalCount} public GRE questions and prompts</small>
    </section>
  );
}

function SectionHeading({ title, body, onClick }) {
  return (
    <button className="section-heading" type="button" onClick={onClick}>
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      <ChevronRight size={28} />
    </button>
  );
}

function TodayView({
  day,
  focusWord,
  focusState,
  focusReveal,
  audioStatus,
  dailyPracticeQuestion,
  practiceTotal,
  masteredCount,
  progress,
  onPronounce,
  onRevealFocus,
  onToggleMastered,
  onToggleSaved,
  onOpenList,
  onOpenSaved,
  onOpenPractice,
}) {
  const upcoming = day.words.filter((word) => word.id !== focusWord?.id).slice(0, 3);

  return (
    <section className="timeline">
      <div className="timeline-row vocabulary-row">
        <time>9 AM</time>
        <TimelineBadge icon={BookOpen} />
        <div className="timeline-content">
          <SectionHeading title="Vocabulary" body={`${masteredCount} / ${day.words.length} words`} onClick={onOpenList} />
          <WordFocusCard
            word={focusWord}
            state={focusState}
            reveal={focusReveal}
            audioStatus={audioStatus}
            onPronounce={onPronounce}
            onReveal={onRevealFocus}
            onToggleMastered={() => onToggleMastered(focusWord)}
            onToggleSaved={() => onToggleSaved(focusWord)}
          />
          <UpcomingWords words={upcoming} progress={progress} onSpeak={onPronounce} onToggleSaved={onToggleSaved} />
        </div>
      </div>

      <div className="timeline-row compact-row">
        <time>11 AM</time>
        <TimelineBadge icon={RotateCcw} tone="lavender" />
        <div className="timeline-content">
          <SectionHeading title="Review" body="Saved words and unfinished items" onClick={onOpenSaved} />
        </div>
      </div>

      <div className="timeline-row practice-row">
        <time>2 PM</time>
        <TimelineBadge icon={PencilLine} />
        <div className="timeline-content">
          <SectionHeading title="Practice" body={`${practiceTotal} real questions and Issue prompts`} onClick={() => onOpenPractice(dailyPracticeQuestion)} />
          <DailyPracticePanel question={dailyPracticeQuestion} totalCount={practiceTotal} onOpenPractice={onOpenPractice} />
        </div>
      </div>
    </section>
  );
}

function WordListView({ days, selectedDay, setSelectedDay, progress, onPronounce, toggleMastered, toggleSaved }) {
  const [query, setQuery] = useState("");
  const activeDay = days[selectedDay - 1];
  const words = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return activeDay.words;
    return days
      .flatMap((day) => day.words.map((word) => ({ ...word, day: day.day })))
      .filter((word) => {
        return (
          word.word.toLowerCase().includes(normalized) ||
          word.explanation.toLowerCase().includes(normalized) ||
          word.synonyms.join(", ").toLowerCase().includes(normalized)
        );
      });
  }, [activeDay.words, days, query]);

  return (
    <section className="panel-view">
      <div className="panel-title">
        <div>
          <h2>Word List</h2>
          <p>Search all 30 days or review the selected day.</p>
        </div>
      </div>

      <div className="search-box">
        <Search size={19} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search word, meaning, synonym" />
      </div>

      <div className="day-pills" aria-label="Day selector">
        {days.map((day) => (
          <button className={day.day === selectedDay ? "is-active" : ""} key={day.day} type="button" onClick={() => setSelectedDay(day.day)}>
            {String(day.day).padStart(2, "0")}
          </button>
        ))}
      </div>

      <div className="word-table">
        {words.map((word) => {
          const state = getWordState(progress, word.id);
          return (
            <article className="word-row" key={`${word.day || selectedDay}-${word.id}`}>
              <div>
                <span>{word.day ? `Day ${String(word.day).padStart(2, "0")}` : `#${word.number}`}</span>
                <strong>{word.word}</strong>
                <p>{compactExplanation(word.explanation)}</p>
                {word.synonyms.length > 0 && <em>{word.synonyms.join(", ")}</em>}
              </div>
              <div className="word-actions">
                <IconButton aria-label={`Pronounce ${word.word}`} onClick={() => onPronounce(word.word)}>
                  <Volume2 size={18} />
                </IconButton>
                <IconButton
                  aria-label={state.mastered ? `Mark ${word.word} unfinished` : `Mark ${word.word} mastered`}
                  className={state.mastered ? "is-mastered" : ""}
                  onClick={() => toggleMastered(word)}
                >
                  <Check size={18} />
                </IconButton>
                <IconButton
                  aria-label={state.saved ? `Unsave ${word.word}` : `Save ${word.word}`}
                  className={state.saved ? "is-saved" : ""}
                  onClick={() => toggleSaved(word)}
                >
                  {state.saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                </IconButton>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const practiceTypeFilters = [
  { id: "all", label: "All" },
  { id: "text_completion", label: "Text Completion" },
  { id: "sentence_equivalence", label: "Sentence Equivalence" },
  { id: "reading_comprehension", label: "Reading" },
  { id: "issue_task", label: "Issue" },
];

function sourceLabel(question) {
  const file = question.source?.file?.replace(/\.pdf$/i, "") || "GRE";
  return `${file} · p. ${question.source?.page || "?"}`;
}

function questionPreview(question) {
  return question.category === "essay" ? question.promptText : question.questionText || question.passage?.text || "Untitled question";
}

function getAnswerLabels(answer) {
  if (answer?.label) return [answer.label];
  return Array.isArray(answer?.labels) ? answer.labels : [];
}

function sameLabels(left, right) {
  return left.length === right.length && left.every((label) => right.includes(label));
}

function splitPassageSentences(text) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  return source.match(/[^.!?]+(?:[.!?]+[”"']?(?=\s|$)|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
}

function buildSentenceChoices(passage, answer) {
  const choices = splitPassageSentences(passage);
  const normalizedAnswer = String(answer || "").replace(/\s+/g, " ").trim();
  if (normalizedAnswer && !choices.some((choice) => choice.replace(/\s+/g, " ").trim() === normalizedAnswer)) {
    choices.push(normalizedAnswer);
  }
  return choices;
}

function QuestionMeta({ question }) {
  return (
    <div className="source-meta">
      <span>{question.typeLabel}</span>
      <span>{sourceLabel(question)}</span>
      {question.topic && <span>{question.topic}</span>}
    </div>
  );
}

function AnswerSummary({ answer }) {
  if (answer?.label) return <>{answer.label}. {answer.text}</>;
  if (Array.isArray(answer?.labels)) return <>{answer.labels.map((label, index) => `${label}. ${answer.texts?.[index] || ""}`).join(" · ")}</>;
  if (Array.isArray(answer?.selections)) return <>{answer.selections.map((selection) => `${selection.blank} ${selection.label}. ${selection.text}`).join(" · ")}</>;
  if (answer?.sentence_text) return <>{answer.sentence_text}</>;
  return <>Answer unavailable.</>;
}

function SolutionPanel({ answer, correct }) {
  return (
    <section className={`solution-panel ${correct ? "is-correct" : "is-incorrect"}`}>
      <strong>{correct ? "Correct" : "Review the answer"}</strong>
      <p><b>Answer:</b> <AnswerSummary answer={answer} /></p>
      {answer?.rationale_zh && <p>{answer.rationale_zh}</p>}
      {answer?.coherence_zh && <p>{answer.coherence_zh}</p>}
      {answer?.pair_relation_zh && <p>{answer.pair_relation_zh}</p>}
    </section>
  );
}

function TranslationBlock({ translation }) {
  if (!translation) return null;
  const hasContent = translation.passage_zh || translation.question_zh || translation.selected_sentence_zh || translation.options_zh?.length || translation.option_groups_zh?.length;
  if (!hasContent) return null;

  return (
    <details className="translation-block">
      <summary>中文翻译</summary>
      {translation.passage_zh && <p><b>语段：</b>{translation.passage_zh}</p>}
      {translation.question_zh && <p><b>题干：</b>{translation.question_zh}</p>}
      {translation.selected_sentence_zh && <p><b>正确句：</b>{translation.selected_sentence_zh}</p>}
      {translation.options_zh?.length > 0 && (
        <ul>
          {translation.options_zh.map((option) => <li key={option.label}><b>{option.label}.</b> {option.text_zh}</li>)}
        </ul>
      )}
      {translation.option_groups_zh?.map((group) => (
        <div className="translation-choice-group" key={group.blank}>
          <b>{group.blank}</b>
          <ul>
            {group.choices.map((option) => <li key={option.label}><b>{option.label}.</b> {option.text_zh}</li>)}
          </ul>
        </div>
      ))}
    </details>
  );
}

function VocabularyCards({ vocabulary }) {
  if (!vocabulary?.length) return null;

  return (
    <details className="vocab-notes">
      <summary>Vocabulary &amp; translations</summary>
      <div>
        {vocabulary.map((item, index) => (
          <article className="vocab-mini-card" key={`${item.blank || ""}-${item.label || index}-${item.term}`}>
            <span>{item.blank ? `${item.blank} · ${item.label}` : item.label}</span>
            <h4>{item.term}</h4>
            <p>{item.translation_zh}</p>
            {item.memory_zh && <small><b>记忆：</b>{item.memory_zh}</small>}
            {item.example_en && <em>{item.example_en}</em>}
            {item.example_zh && <small>{item.example_zh}</small>}
          </article>
        ))}
      </div>
    </details>
  );
}

function BlankGuide({ question }) {
  const explicitBlankCount = Number(question.responseFormat?.blank_count) || 0;
  const blankCount = explicitBlankCount || (question.questionType === "sentence_equivalence" ? 1 : 0);
  if (!blankCount) return null;

  const labels = question.optionGroups?.length
    ? question.optionGroups.map((group) => group.blank)
    : Array.from({ length: blankCount }, (_, index) => (blankCount > 1 ? `(${"i".repeat(index + 1)})` : ""));

  return (
    <div className="blank-guide" aria-label={`Fill ${blankCount} blank${blankCount > 1 ? "s" : ""}`}>
      <span>Fill-in blank{blankCount > 1 ? "s" : ""}</span>
      <div>
        {labels.map((label, index) => (
          <span className="blank-target" key={`${label}-${index}`}>
            {label && <b>{label}</b>}
            <i aria-hidden="true">________</i>
          </span>
        ))}
      </div>
    </div>
  );
}

function OptionButton({ option, selected, correct, incorrect, onClick }) {
  return (
    <button
      className={`choice-option ${selected ? "is-selected" : ""} ${correct ? "is-correct" : ""} ${incorrect ? "is-wrong" : ""}`}
      type="button"
      onClick={onClick}
    >
      <span>{option.label}</span>
      <strong>{option.text}</strong>
    </button>
  );
}

function VerbalQuestion({ question }) {
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [selectedByBlank, setSelectedByBlank] = useState({});
  const [selectedSentence, setSelectedSentence] = useState("");
  const [checked, setChecked] = useState(false);
  const format = question.responseFormat?.id;
  const expectedLabels = getAnswerLabels(question.answer);
  const selectionLimit = Math.max(1, expectedLabels.length);
  const isBlankQuestion = format === "two_blanks_three_each" || format === "three_blanks_three_each";
  const isSentenceQuestion = format === "passage_sentence_selection";
  const sentenceChoices = isSentenceQuestion ? buildSentenceChoices(question.passage?.text, question.answer?.sentence_text) : [];
  const correctByBlank = Object.fromEntries((question.answer?.selections || []).map((selection) => [selection.blank, selection.label]));
  const complete = isBlankQuestion
    ? question.optionGroups.every((group) => selectedByBlank[group.blank])
    : isSentenceQuestion
      ? Boolean(selectedSentence)
      : selectedLabels.length === selectionLimit;
  const correct = isBlankQuestion
    ? question.optionGroups.every((group) => selectedByBlank[group.blank] === correctByBlank[group.blank])
    : isSentenceQuestion
      ? selectedSentence.replace(/\s+/g, " ").trim() === String(question.answer?.sentence_text || "").replace(/\s+/g, " ").trim()
      : sameLabels(selectedLabels, expectedLabels);

  const chooseOption = (label) => {
    setChecked(false);
    if (selectionLimit === 1) {
      setSelectedLabels([label]);
      return;
    }
    setSelectedLabels((current) => {
      if (current.includes(label)) return current.filter((item) => item !== label);
      if (current.length >= selectionLimit) return [...current.slice(1), label];
      return [...current, label];
    });
  };

  return (
    <article className="question-card">
      <QuestionMeta question={question} />
      {question.responseFormat?.selection_rule && <p className="selection-rule">{question.responseFormat.selection_rule}</p>}
      {question.passage?.text && <blockquote className="passage-block">{question.passage.text}</blockquote>}
      <h3 className="question-prompt">{question.questionText}</h3>
      <BlankGuide question={question} />

      {isBlankQuestion && (
        <div className="blank-groups">
          {question.optionGroups.map((group) => (
            <section className="blank-group" key={group.blank}>
              <h4>{group.blank}</h4>
              <div className="choice-list">
                {group.choices.map((option) => (
                  <OptionButton
                    correct={checked && correctByBlank[group.blank] === option.label}
                    incorrect={checked && selectedByBlank[group.blank] === option.label && correctByBlank[group.blank] !== option.label}
                    key={option.label}
                    option={option}
                    selected={selectedByBlank[group.blank] === option.label}
                    onClick={() => {
                      setChecked(false);
                      setSelectedByBlank((current) => ({ ...current, [group.blank]: option.label }));
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {isSentenceQuestion && (
        <div className="sentence-choice-list">
          {sentenceChoices.map((sentence, index) => {
            const isCorrectSentence = sentence.replace(/\s+/g, " ").trim() === String(question.answer?.sentence_text || "").replace(/\s+/g, " ").trim();
            return (
              <button
                className={`sentence-choice ${selectedSentence === sentence ? "is-selected" : ""} ${checked && isCorrectSentence ? "is-correct" : ""} ${checked && selectedSentence === sentence && !isCorrectSentence ? "is-wrong" : ""}`}
                key={`${index}-${sentence}`}
                type="button"
                onClick={() => {
                  setChecked(false);
                  setSelectedSentence(sentence);
                }}
              >
                <span>{index + 1}</span>
                {sentence}
              </button>
            );
          })}
        </div>
      )}

      {!isBlankQuestion && !isSentenceQuestion && (
        <div className="choice-list">
          {question.options.map((option) => (
            <OptionButton
              correct={checked && expectedLabels.includes(option.label)}
              incorrect={checked && selectedLabels.includes(option.label) && !expectedLabels.includes(option.label)}
              key={option.label}
              option={option}
              selected={selectedLabels.includes(option.label)}
              onClick={() => chooseOption(option.label)}
            />
          ))}
        </div>
      )}

      <button className="practice-check-button" disabled={!complete} type="button" onClick={() => setChecked(true)}>
        Check answer
      </button>
      {checked && <SolutionPanel answer={question.answer} correct={correct} />}
      <TranslationBlock translation={question.translation} />
      <VocabularyCards vocabulary={question.vocabulary} />
    </article>
  );
}

function EssayQuestion({ question, draft, onChangeDraft }) {
  return (
    <article className="question-card essay-question">
      <QuestionMeta question={question} />
      <h3 className="essay-prompt">{question.promptText}</h3>
      <label className="essay-draft-label" htmlFor={`draft-${question.id}`}>Your response</label>
      <textarea
        id={`draft-${question.id}`}
        className="essay-draft"
        value={draft || ""}
        onChange={(event) => onChangeDraft(event.target.value)}
        placeholder="Write your Issue response here…"
      />
      <div className="essay-draft-footer">
        <span>Saved in this browser.</span>
        <button type="button" onClick={() => onChangeDraft("")}>Clear draft</button>
      </div>
    </article>
  );
}

function PracticeQuestion({ question, draft, onChangeDraft }) {
  if (question.category === "essay") return <EssayQuestion question={question} draft={draft} onChangeDraft={onChangeDraft} />;
  return <VerbalQuestion question={question} />;
}

function PracticeView({ records, selectedQuestionId, onSelectQuestion, essayDrafts, onChangeEssayDraft }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [query, setQuery] = useState("");
  const sources = useMemo(() => [...new Set(records.map((record) => record.source?.file).filter(Boolean))], [records]);
  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      if (typeFilter !== "all" && record.questionType !== typeFilter) return false;
      if (sourceFilter !== "all" && record.source?.file !== sourceFilter) return false;
      if (!normalizedQuery) return true;
      return `${record.id} ${record.typeLabel} ${questionPreview(record)} ${record.topic || ""}`.toLowerCase().includes(normalizedQuery);
    });
  }, [query, records, sourceFilter, typeFilter]);
  const selectedQuestion = filteredRecords.find((record) => record.id === selectedQuestionId) || filteredRecords[0] || null;
  const selectedIndex = selectedQuestion ? filteredRecords.findIndex((record) => record.id === selectedQuestion.id) : -1;
  const moveQuestion = (offset) => {
    if (!filteredRecords.length) return;
    const nextIndex = (selectedIndex + offset + filteredRecords.length) % filteredRecords.length;
    onSelectQuestion(filteredRecords[nextIndex].id);
  };

  return (
    <section className="panel-view practice-view">
      <div className="panel-title">
        <div>
          <h2>Practice</h2>
          <p>{records.length} public GRE questions and Issue prompts.</p>
        </div>
      </div>

      <div className="practice-type-pills" aria-label="Question type">
        {practiceTypeFilters.map((filter) => (
          <button className={typeFilter === filter.id ? "is-active" : ""} key={filter.id} type="button" onClick={() => setTypeFilter(filter.id)}>
            {filter.label}
          </button>
        ))}
      </div>

      <div className="practice-controls">
        <select aria-label="Practice set" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option value="all">All practice sets</option>
          {sources.map((source) => <option key={source} value={source}>{source.replace(/\.pdf$/i, "")}</option>)}
        </select>
        <div className="search-box">
          <Search size={19} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search question text or ID" />
        </div>
      </div>

      {!selectedQuestion ? (
        <EmptyState title="No matching questions" body="Try another question type, practice set, or search phrase." />
      ) : (
        <>
          <div className="practice-picker">
            <select aria-label="Question selector" value={selectedQuestion.id} onChange={(event) => onSelectQuestion(event.target.value)}>
              {filteredRecords.map((record) => <option key={record.id} value={record.id}>{record.id} · {record.typeLabel}</option>)}
            </select>
            <span>{selectedIndex + 1} / {filteredRecords.length}</span>
          </div>
          <div className="practice-navigation">
            <button type="button" onClick={() => moveQuestion(-1)}>Previous</button>
            <button type="button" onClick={() => onSelectQuestion(filteredRecords[Math.floor(Math.random() * filteredRecords.length)].id)}>Random</button>
            <button type="button" onClick={() => moveQuestion(1)}>Next</button>
          </div>
          <PracticeQuestion
            key={selectedQuestion.id}
            question={selectedQuestion}
            draft={essayDrafts[selectedQuestion.id]}
            onChangeDraft={(value) => onChangeEssayDraft(selectedQuestion.id, value)}
          />
        </>
      )}
    </section>
  );
}

function SavedView({ days, progress, onPronounce, toggleMastered, toggleSaved }) {
  const savedWords = days
    .flatMap((day) => day.words.map((word) => ({ ...word, day: day.day })))
    .filter((word) => getWordState(progress, word.id).saved);
  const unfinishedSaved = savedWords.filter((word) => !getWordState(progress, word.id).mastered);
  const masteredCount = Object.values(progress).filter((state) => state.mastered).length;

  return (
    <section className="panel-view saved-view">
      <div className="panel-title">
        <div>
          <h2>Saved</h2>
          <p>{masteredCount} mastered words across the plan.</p>
        </div>
      </div>

      <div className="review-summary">
        <div>
          <span>Saved</span>
          <strong>{savedWords.length}</strong>
        </div>
        <div>
          <span>Still reviewing</span>
          <strong>{unfinishedSaved.length}</strong>
        </div>
      </div>

      {savedWords.length === 0 ? (
        <EmptyState title="No saved words" body="Tap Save on words you want to review again." />
      ) : (
        <div className="word-table">
          {savedWords.map((word) => {
            const state = getWordState(progress, word.id);
            return (
              <article className="word-row" key={`${word.day}-${word.id}`}>
                <div>
                  <span>Day {String(word.day).padStart(2, "0")}</span>
                  <strong>{word.word}</strong>
                  <p>{compactExplanation(word.explanation)}</p>
                </div>
                <div className="word-actions">
                  <IconButton aria-label={`Pronounce ${word.word}`} onClick={() => onPronounce(word.word)}>
                    <Volume2 size={18} />
                  </IconButton>
                  <IconButton
                    aria-label={state.mastered ? `Mark ${word.word} unfinished` : `Mark ${word.word} mastered`}
                    className={state.mastered ? "is-mastered" : ""}
                    onClick={() => toggleMastered(word)}
                  >
                    <Check size={18} />
                  </IconButton>
                  <IconButton aria-label={`Unsave ${word.word}`} className="is-saved" onClick={() => toggleSaved(word)}>
                    <BookmarkCheck size={18} />
                  </IconButton>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function App() {
  const { data, error } = useStudyData();
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [startDate, setStartDate] = useState(getInitialStartDate);
  const [selectedDay, setSelectedDay] = useState(1);
  const [progress, setProgress] = useState(() => loadJsonStorage(STORAGE_KEY, {}));
  const [focusReveal, setFocusReveal] = useState(true);
  const [practiceQuestionId, setPracticeQuestionId] = useState("");
  const [essayDrafts, setEssayDrafts] = useState(() => loadJsonStorage(PRACTICE_DRAFTS_KEY, {}));
  const [audioStatus, setAudioStatus] = useState("");
  const audioCacheRef = useRef(loadJsonStorage(AUDIO_CACHE_KEY, {}));
  const audioRef = useRef(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress]);

  useEffect(() => {
    window.localStorage.setItem(PRACTICE_DRAFTS_KEY, JSON.stringify(essayDrafts));
  }, [essayDrafts]);

  useEffect(() => {
    if (!data) return;
    const elapsed = Math.max(0, daysBetween(startDate, todayIso()));
    const currentDay = (elapsed % data.days.length) + 1;
    setSelectedDay(currentDay);
  }, [data, startDate]);

  useEffect(() => {
    if (!data) return;
    const activeDay = data.days[selectedDay - 1];
    if (!activeDay) return;

    activeDay.words.slice(0, 4).forEach((word) => {
      resolveDictionaryAudio(word.word, audioCacheRef);
    });
  }, [data, selectedDay]);

  if (error) return <ErrorScreen error={error} />;
  if (!data) return <LoadingScreen />;

  const day = data.days[selectedDay - 1] || data.days[0];
  const masteredCount = day.words.filter((word) => getWordState(progress, word.id).mastered).length;
  const dayProgress = day.words.length ? masteredCount / day.words.length : 0;
  const focusWord = day.words.find((word) => !getWordState(progress, word.id).mastered) || day.words[0];
  const focusState = focusWord ? getWordState(progress, focusWord.id) : { mastered: false, saved: false };
  const practiceRecords = data.practice?.records || [];
  const dailyPracticeQuestion = practiceRecords.length ? practiceRecords[(selectedDay - 1) % practiceRecords.length] : null;

  const toggleMastered = (word) => {
    if (!word) return;
    const current = getWordState(progress, word.id);
    setProgress(mutateWordState(progress, word.id, { mastered: !current.mastered }));
  };

  const toggleSaved = (word) => {
    if (!word) return;
    const current = getWordState(progress, word.id);
    setProgress(mutateWordState(progress, word.id, { saved: !current.saved }));
  };

  const resetStartDate = () => {
    const value = todayIso();
    window.localStorage.setItem(START_DATE_KEY, value);
    setStartDate(value);
    setFocusReveal(true);
  };

  const changeDay = (direction) => {
    setFocusReveal(true);
    setSelectedDay((current) => {
      const next = current + direction;
      if (next < 1) return data.days.length;
      if (next > data.days.length) return 1;
      return next;
    });
  };

  const openPractice = (question) => {
    if (question?.id) setPracticeQuestionId(question.id);
    setActiveTab("practice");
  };

  const changeEssayDraft = (questionId, value) => {
    setEssayDrafts((current) => ({ ...current, [questionId]: value }));
  };

  const playAudioUrl = (audioUrl) => {
    try {
      audioRef.current?.pause();
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onplaying = () => setAudioStatus("playing dictionary audio");
      audio.onended = () => setAudioStatus("dictionary audio");
      audio.onerror = () => setAudioStatus("audio failed");
      audio.play().catch(() => setAudioStatus("tap again to play"));
    } catch {
      setAudioStatus("tap again to play");
    }
  };

  const playPronunciation = async (word) => {
    if (!word) return;
    const cachedAudio = getCachedDictionaryAudio(word, audioCacheRef);
    if (cachedAudio) {
      playAudioUrl(cachedAudio);
      return;
    }
    if (cachedAudio === null) {
      setAudioStatus("no dictionary audio");
      return;
    }

    setAudioStatus("loading audio");
    const audioUrl = await resolveDictionaryAudio(word, audioCacheRef);
    if (!audioUrl) {
      setAudioStatus("no dictionary audio");
      return;
    }
    setAudioStatus("audio ready, tap again");
  };

  return (
    <main className="app-shell">
      <TopHeader
        selectedDay={selectedDay}
        totalDays={data.days.length}
        progressLabel={`${masteredCount} of ${day.words.length} words`}
        dayProgress={dayProgress}
        onPrev={() => changeDay(-1)}
        onNext={() => changeDay(1)}
        onResetStartDate={resetStartDate}
      />

      <div className="content-area">
        {activeTab === "today" && (
          <TodayView
            day={day}
            focusWord={focusWord}
            focusState={focusState}
            focusReveal={focusReveal}
            audioStatus={audioStatus}
            dailyPracticeQuestion={dailyPracticeQuestion}
            practiceTotal={practiceRecords.length}
            masteredCount={masteredCount}
            progress={progress}
            onPronounce={playPronunciation}
            onRevealFocus={() => setFocusReveal((value) => !value)}
            onToggleMastered={toggleMastered}
            onToggleSaved={toggleSaved}
            onOpenList={() => setActiveTab("list")}
            onOpenSaved={() => setActiveTab("saved")}
            onOpenPractice={openPractice}
          />
        )}

        {activeTab === "list" && (
          <WordListView
            days={data.days}
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            progress={progress}
            onPronounce={playPronunciation}
            toggleMastered={toggleMastered}
            toggleSaved={toggleSaved}
          />
        )}

        {activeTab === "practice" && (
          <PracticeView
            records={practiceRecords}
            selectedQuestionId={practiceQuestionId}
            onSelectQuestion={setPracticeQuestionId}
            essayDrafts={essayDrafts}
            onChangeEssayDraft={changeEssayDraft}
          />
        )}

        {activeTab === "saved" && (
          <SavedView days={data.days} progress={progress} onPronounce={playPronunciation} toggleMastered={toggleMastered} toggleSaved={toggleSaved} />
        )}
      </div>

      <nav className="bottom-nav" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button className={activeTab === item.id ? "is-active" : ""} key={item.id} type="button" onClick={() => setActiveTab(item.id)}>
              <Icon size={24} strokeWidth={2.1} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </main>
  );
}
