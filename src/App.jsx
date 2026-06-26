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
  FileText,
  List,
  Loader2,
  PencilLine,
  RotateCcw,
  Search,
  Volume2,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

const STORAGE_KEY = "gre-daily-study-state-v1";
const START_DATE_KEY = "gre-daily-study-start-date";
const BASE_URL = import.meta.env.BASE_URL || "/";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const navItems = [
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "list", label: "List", icon: List },
  { id: "reader", label: "Reader", icon: FileText },
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

function buildPageChips(pageCount) {
  if (!pageCount || pageCount < 5) return [1, 2, 3].filter((page) => !pageCount || page <= pageCount);
  return [1, 2, 3, 4, pageCount];
}

function speakWord(word) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
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
    fetch(`${BASE_URL}data/study-data.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (mounted) setState({ data, error: null });
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

function WordFocusCard({ word, state, reveal, onReveal, onToggleMastered, onToggleSaved }) {
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
            <IconButton aria-label={`Pronounce ${word.word}`} onClick={() => speakWord(word.word)}>
              <Volume2 size={24} />
            </IconButton>
          </div>
          <span className="voice-note">device voice</span>
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
        <ActionButton icon={Eye} onClick={onReveal}>
          Reveal
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

function PracticePanel({ pdf, selectedPage, onSelectPage, onOpenReader }) {
  if (!pdf) return null;
  const pageChips = buildPageChips(pdf.pageCount);

  return (
    <section className="practice-panel">
      <div className="pdf-thumb">
        <div className="pdf-mark">GRE</div>
        <div className="pdf-lines">
          <span />
          <span />
          <span />
          <span />
        </div>
        <b>PDF</b>
      </div>

      <div className="practice-meta">
        <h3>{pdf.title}</h3>
        <p>GRE Practice PDF</p>
        <span>{pdf.pageCount ? `${pdf.pageCount} pages` : "PDF reader"}</span>
        <label>Pages</label>
        <div className="page-chips">
          {pageChips.slice(0, 4).map((page) => (
            <button className={selectedPage === page ? "is-active" : ""} key={page} type="button" onClick={() => onSelectPage(page)}>
              {page}
            </button>
          ))}
          {pageChips.length > 4 && <span>...</span>}
          {pageChips.length > 4 && (
            <button className={selectedPage === pageChips.at(-1) ? "is-active" : ""} type="button" onClick={() => onSelectPage(pageChips.at(-1))}>
              {pageChips.at(-1)}
            </button>
          )}
        </div>
      </div>

      <button className="reader-button" type="button" onClick={onOpenReader}>
        <BookOpen size={22} />
        <span>Open Reader</span>
      </button>
    </section>
  );
}

function TodayView({
  day,
  focusWord,
  focusState,
  focusReveal,
  selectedPdf,
  selectedPage,
  masteredCount,
  progress,
  onRevealFocus,
  onToggleMastered,
  onToggleSaved,
  onSelectPage,
  onOpenReader,
}) {
  const upcoming = day.words.filter((word) => word.id !== focusWord?.id).slice(0, 3);

  return (
    <section className="timeline">
      <div className="timeline-row vocabulary-row">
        <time>9:00 AM</time>
        <TimelineBadge icon={BookOpen} />
        <div className="timeline-content">
          <div className="section-heading">
            <div>
              <h2>Vocabulary</h2>
              <p>
                {masteredCount} / {day.words.length} words
              </p>
            </div>
            <ChevronRight size={28} />
          </div>
          <WordFocusCard
            word={focusWord}
            state={focusState}
            reveal={focusReveal}
            onReveal={onRevealFocus}
            onToggleMastered={() => onToggleMastered(focusWord)}
            onToggleSaved={() => onToggleSaved(focusWord)}
          />
          <UpcomingWords words={upcoming} progress={progress} onSpeak={speakWord} onToggleSaved={onToggleSaved} />
        </div>
      </div>

      <div className="timeline-row compact-row">
        <time>11:00 AM</time>
        <TimelineBadge icon={RotateCcw} tone="lavender" />
        <div className="timeline-content">
          <div className="section-heading">
            <div>
              <h2>Review</h2>
              <p>Saved words and unfinished items</p>
            </div>
            <ChevronRight size={28} />
          </div>
        </div>
      </div>

      <div className="timeline-row practice-row">
        <time>2:00 PM</time>
        <TimelineBadge icon={PencilLine} />
        <div className="timeline-content">
          <div className="section-heading">
            <div>
              <h2>Practice</h2>
              <p>GRE Practice PDFs</p>
            </div>
            <ChevronRight size={28} />
          </div>
          <PracticePanel pdf={selectedPdf} selectedPage={selectedPage} onSelectPage={onSelectPage} onOpenReader={onOpenReader} />
        </div>
      </div>
    </section>
  );
}

function WordListView({ days, selectedDay, setSelectedDay, progress, toggleMastered, toggleSaved }) {
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
                <IconButton aria-label={`Pronounce ${word.word}`} onClick={() => speakWord(word.word)}>
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

function ReaderView({ pdfs, selectedPdfId, setSelectedPdfId, selectedPage, setSelectedPage }) {
  const activePdf = pdfs.find((pdf) => pdf.id === selectedPdfId) || pdfs[0];
  if (!activePdf) {
    return <EmptyState title="No PDFs yet" body="Practice PDFs will appear here after data preparation." />;
  }

  const fileUrl = `${BASE_URL}pdfs/${activePdf.fileName}`;
  const openUrl = `${fileUrl}#page=${selectedPage}`;

  return (
    <section className="reader-view">
      <div className="reader-toolbar">
        <div>
          <h2>Reader</h2>
          <p>{activePdf.title}</p>
        </div>
        <a href={openUrl} target="_blank" rel="noreferrer">
          Open PDF
        </a>
      </div>

      <div className="reader-controls">
        <select value={activePdf.id} onChange={(event) => setSelectedPdfId(event.target.value)}>
          {pdfs.map((pdf) => (
            <option key={pdf.id} value={pdf.id}>
              {pdf.title}
            </option>
          ))}
        </select>
        <input
          min="1"
          max={activePdf.pageCount || undefined}
          type="number"
          value={selectedPage}
          onChange={(event) => setSelectedPage(Math.max(1, Number(event.target.value) || 1))}
        />
      </div>

      <PdfPagePreview page={selectedPage} url={fileUrl} />
    </section>
  );
}

function SavedView({ days, progress, toggleMastered, toggleSaved }) {
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
                  <IconButton aria-label={`Pronounce ${word.word}`} onClick={() => speakWord(word.word)}>
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

function PdfPagePreview({ page, url }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;
    let renderTask = null;

    async function renderPage() {
      try {
        setStatus("loading");
        setErrorMessage("");
        loadingTask = pdfjsLib.getDocument({ url, disableWorker: true });
        const pdf = await loadingTask.promise;
        const safePage = Math.min(Math.max(1, page), pdf.numPages);
        const pdfPage = await pdf.getPage(safePage);
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const availableWidth = Math.max(280, frameRef.current?.clientWidth || 360);
        const scale = Math.min(1.6, availableWidth / baseViewport.width);
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);
        renderTask = pdfPage.render({ canvasContext: context, viewport });
        await renderTask.promise;
        if (!cancelled) setStatus("ready");
      } catch (error) {
        if (!cancelled && error?.name !== "RenderingCancelledException") {
          setErrorMessage(error?.message || error?.name || "Unknown PDF preview error");
          setStatus("error");
        }
      }
    }

    renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
      loadingTask?.destroy?.();
    };
  }, [page, url]);

  return (
    <div className="pdf-preview" ref={frameRef}>
      {status === "loading" && (
        <div className="pdf-status">
          <Loader2 className="spin" size={24} />
          <span>Rendering page</span>
        </div>
      )}
      {status === "error" && (
        <div className="pdf-status">
          <span>Preview unavailable. Open the PDF file instead.</span>
          <small>{errorMessage}</small>
        </div>
      )}
      <canvas className={status === "ready" ? "is-ready" : ""} ref={canvasRef} />
    </div>
  );
}

export function App() {
  const { data, error } = useStudyData();
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [startDate, setStartDate] = useState(getInitialStartDate);
  const [selectedDay, setSelectedDay] = useState(1);
  const [progress, setProgress] = useState(() => loadJsonStorage(STORAGE_KEY, {}));
  const [focusReveal, setFocusReveal] = useState(true);
  const [selectedPdfId, setSelectedPdfId] = useState("");
  const [selectedPage, setSelectedPage] = useState(1);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress]);

  useEffect(() => {
    if (!data) return;
    const elapsed = Math.max(0, daysBetween(startDate, todayIso()));
    const currentDay = (elapsed % data.days.length) + 1;
    setSelectedDay(currentDay);
  }, [data, startDate]);

  useEffect(() => {
    if (!data || selectedPdfId) return;
    const pdf = data.pdfs[(selectedDay - 1) % Math.max(1, data.pdfs.length)];
    if (pdf) setSelectedPdfId(pdf.id);
  }, [data, selectedDay, selectedPdfId]);

  if (error) return <ErrorScreen error={error} />;
  if (!data) return <LoadingScreen />;

  const day = data.days[selectedDay - 1] || data.days[0];
  const masteredCount = day.words.filter((word) => getWordState(progress, word.id).mastered).length;
  const dayProgress = day.words.length ? masteredCount / day.words.length : 0;
  const focusWord = day.words.find((word) => !getWordState(progress, word.id).mastered) || day.words[0];
  const focusState = focusWord ? getWordState(progress, focusWord.id) : { mastered: false, saved: false };
  const selectedPdf = data.pdfs.find((pdf) => pdf.id === selectedPdfId) || data.pdfs[(selectedDay - 1) % data.pdfs.length];

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

  const openReader = () => {
    if (selectedPdf) setSelectedPdfId(selectedPdf.id);
    setActiveTab("reader");
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
            selectedPdf={selectedPdf}
            selectedPage={selectedPage}
            masteredCount={masteredCount}
            progress={progress}
            onRevealFocus={() => setFocusReveal((value) => !value)}
            onToggleMastered={toggleMastered}
            onToggleSaved={toggleSaved}
            onSelectPage={setSelectedPage}
            onOpenReader={openReader}
          />
        )}

        {activeTab === "list" && (
          <WordListView
            days={data.days}
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            progress={progress}
            toggleMastered={toggleMastered}
            toggleSaved={toggleSaved}
          />
        )}

        {activeTab === "reader" && (
          <ReaderView
            pdfs={data.pdfs}
            selectedPdfId={selectedPdfId}
            setSelectedPdfId={setSelectedPdfId}
            selectedPage={selectedPage}
            setSelectedPage={setSelectedPage}
          />
        )}

        {activeTab === "saved" && <SavedView days={data.days} progress={progress} toggleMastered={toggleMastered} toggleSaved={toggleSaved} />}
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
