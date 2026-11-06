# Quiz App

Local quiz app that reads questions from this vault and tracks what you know.

## Windows (with Gemini)

In PowerShell: `irm https://raw.githubusercontent.com/Matan-Morduch/learning-quiz/main/install-windows.ps1 | iex`. It installs Node.js and the Gemini CLI, downloads the app into `%USERPROFILE%\LearningQuiz`, adds a desktop shortcut, walks through the Google sign-in and opens the app. Run it again to update. With Claude Code instead of Gemini: `$env:LQ_AI='claude'; irm … | iex` (same URL). [SETUP-WINDOWS-GEMINI.md](SETUP-WINDOWS-GEMINI.md) and [SETUP-WINDOWS-CLAUDE.md](SETUP-WINDOWS-CLAUDE.md) are step-by-step guides written for a non-technical person to paste into an AI chat. Without Claude Code the app uses Gemini by default. On Windows, Labs, running code in interviews and dictation don't work.

`deploy/publish-github.sh` publishes the committed code to the public GitHub repo the installer downloads from (one commit per publish, no history; `export-ignore` files in `.gitattributes` are left out).

## Run

```bash
node Learning/_quiz/server.js   # from your vault folder
```

Open http://localhost:4747

It's also part of **LifeOS** (`node LifeOS/server.js` → http://localhost:4700/quiz/). `server.js` exports `handle()` for that, so keep the page's URLs relative (`api/...`, `views/...`).

### Running on Linux / env vars

The app also runs on Linux (Node 22, e.g. as a systemd user service on a home server; see `docs/HOME-SERVER.md`). The code checkout doesn't have to sit inside the vault: point it at the Learning folder with `QUIZ_LEARNING_DIR`. All variables are optional; unset, it behaves as on the Mac.

| Variable | Default | What |
|---|---|---|
| `PORT` | `4747` | Port of the standalone server |
| `QUIZ_HOST` | `127.0.0.1` | Address it binds (keep localhost behind `tailscale serve`; `0.0.0.0` = whole LAN) |
| `QUIZ_LEARNING_DIR` | the folder above `_quiz` | The vault's Learning folder (`~/` is expanded), e.g. `~/vault/Learning`. `Quiz Progress.md`, new notes and question files are written here |
| `QUIZ_CLAUDE_BIN` | `claude` on PATH, else `~/.local/bin/claude` (and other usual spots) | Claude Code CLI used for grading, Teach, MCQ, map. It must be logged in as the service's user |
| `QUIZ_WHISPER_BIN` | `whisper-cli` in Homebrew, `/usr/local/bin`, `/usr/bin`, `~/.local/bin`, `~/whisper.cpp/build/bin`, PATH | Dictation (models stay in `~/.cache/quiz-whisper`) |
| `QUIZ_VAULT` | name of the folder above the Learning folder | Obsidian vault name in `obsidian://` links |
| `QUIZ_LAB_MODE` | `local` on Linux, `ssh` on a Mac | Where lab terminals run: `local` = a shell on this machine, `ssh` = the lab VM below. Teach → Labs → Change overrides it |
| `QUIZ_LAB_HOST` | `rocky` | ssh host alias of the lab VM in `ssh` mode (needs an `~/.ssh/config` entry + key for the service user) |
| `QUIZ_PUBLIC_URL`, `QUIZ_LAB_HOSTS` | | The app's public address (set by `deploy/install.sh`, e.g. the Tailscale name) and any extra host names: lab requests are only accepted from these and localhost |
| `QUIZ_TZ` | the browser's | Time zone for the daily goal and Quiz Progress dates until a browser has reported its own (the server may run on UTC) |
| `QUIZ_GEMINI_BIN` | `~/.local/share/gemini-cli/node_modules/.bin/gemini` (from `tools/gemini/install.sh`), else `gemini` on PATH | Gemini CLI, for the AI engine "Gemini" (Settings → AI). Signed in once with `tools/gemini/install.sh --login` |
| `QUIZ_GEMINI_API_KEY`, `QUIZ_GEMINI_MODEL_PRO` / `_FLASH` / `_FLASH_LITE` | | Gemini API key (instead of saving it in Settings → AI) and model ids (default: the newest the key can use) |
| `QUIZ_AI_ENGINE` | `claude`, or `gemini-cli` when Claude Code isn't installed | The AI engine before one is picked in Settings → AI |
| `QUIZ_OPEN_BROWSER` | | `1`: open the app in the browser once it starts (the Windows start file sets it) |
| `QUIZ_AI_MODEL`, `QUIZ_AI_EFFORT`, `QUIZ_WHISPER_MODEL`, `QUIZ_TTS_*` | | See the sections below |

`data/` always lives next to the code. `GET /api/health` → `{ ok, questions, uptime, claude, learningDir }` (no Claude call) for a service check.

## How it works

- Questions live in `Learning/<Subject>/Questions/<Topic>.md`. Every file there is picked up automatically, and edits show up without restarting.
- You write your answer, reveal the reference answer, then rate yourself:
  - **Again**: didn't know it → back to box 0, asked often
  - **Hard**: partially → stays in its box
  - **Good**: got it → up 1 box
  - **Easy**: instant → up 2 boxes
- Boxes 0–5 (Leitner). Lower box = asked much more often. A question isn't "due" again until its wait passes: 0, 10 min, 1 day, 3 days, 7 days, 21 days.
- Every answer you type is saved in `data/history.jsonl`, and the last 5 show up after you reveal, so you can see how your explanation improves.
- [[Quiz Progress]] is regenerated after every answer: mastery per topic plus your weakest questions.

## Modes

- **🏠 Home:** where the app opens (unless the link names a tab or a lesson; `?tab=home`). Top to bottom: a greeting and today's goal, **Continue** (the last 2 lessons still going, with Resume), **Quick review**, **Up next to learn** (the next 3 To Learn items, each with Teach), **Study next** (the top 3 open gaps, each with Teach) and a box to **start a lesson** (⌘↩, mic). Browser: `ui/home.js`.
- **🧠 Review (spaced repetition) now runs from Home.** The Quick review card counts questions you've seen that are due again (and how many are weak), from every topic, and **Start review** asks up to your Review session size (10 when that's "No limit"), about 30 s each. No new questions. **Customize** opens the old review setup (`?tab=review`): pick topics, and Smart / Due / Weak / New, where weak and due questions come up most. The Review tab is gone from the sidebar.
- **📝 Test:** pick a subject and 5/10/15/20/all random questions. It's timed from the first question to the last, then graded:
  - Points: a written answer is worth 2, a multiple-choice pick 1 (written answers show more control). Written: the AI score, or Again 0 · Hard ½ · Good/Easy full. Pick: right or wrong. → % → letter (A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F)
  - The results screen shows your time per question, a review list, and your previous best
  - Saved in `data/tests.jsonl` and listed under **Recent tests** in [[Quiz Progress]]
  - Quitting early means no grade
- **📚 Free practice:** every question in one subject, shuffled, with no grade and no timer. Every run is saved after each answer (`data/practice-runs.json`, up to 20) until it's finished or discarded, so **Stop**, leaving the page or starting another practice never loses it: the Practice tab lists **Unfinished practice** with Continue / Discard, on any device.
- **📴 Offline practice** (sidebar, or More on the phone): multiple choice with no AI, which also works with **no connection at all**. See below.

- **🎯 Picked set (from another app):** `/quiz/?ids=a,b,c&label=...&back=/nvidia/` starts exactly those questions right away, untimed and ungraded, with Stop / Continue. LifeOS → Goal to NVIDIA uses it for the daily quiz set.

In every mode, your ratings also update spaced repetition. A right multiple-choice pick can lift a question to box 2 at most; box 3+ (and "mastered", box 4+) takes written answers.

## 📴 Offline practice (no AI, no connection needed)

For bad signal, a plane, or when Claude is down.
- **Download** once (Offline practice → Download): every question that has multiple choice is saved on the device, with the misconception behind each wrong option, why the right one is right, and the reference answer, plus your current boxes. It refreshes by itself when it's older than 6 hours and the server answers.
- **Practice:** pick subjects and 10 / 20 / All. Due and weak questions come first. Tap an option (or A–F, ? for "I don't know", Enter for Next) and see at once: the right answer, **why your pick is wrong** (the mix-up behind it), why the right one is right, the other options' mix-ups, and the reference answer. Right = Good, wrong or "I don't know" = Again; a miss comes back once at the end of the run.
- **Works offline:** the app itself is kept on the device by a service worker (`ui/sw.js`). It's network-first, so with a connection you always get the current code; the copy is only used when the network fails or takes over 4 s. Opened with no connection, the app goes straight to Offline practice.
- **Sync:** answers wait on the device (IndexedDB) and are sent when the server answers again: on load, after each answer, when the phone comes back online, and every minute. Each answer has an id, so a retried sync never counts twice, and it's recorded with the time you gave it. They update spaced repetition like any other answer (history rows carry `extra.offline`).
- **Prepare the rest:** only questions with options can be practiced offline. **Prepare the rest** has Claude write options for all the others on the server, in the background, 2 at a time, always behind a quiz that needs options right now. It survives a server restart (`data/offline.json`) and skips what's ready; **Stop** any time.
- Server: `offline.js` (`GET api/offline/pack`, `POST api/offline/sync`, `GET/POST api/offline/prepare`); browser: `ui/offline.js`. iPhone note: Safari can clear a home-screen app's stored data after weeks without use; opening it once while connected downloads everything again.

## 🧠 AI engine: Claude or Gemini

Every AI feature (grading, hints, Teach, Interview, multiple choice, gaps, To Learn, the map) runs on one of three engines, picked in **Settings → AI**, for the whole app or per area (Teach, Interview, Grading and background jobs):

| Engine | Pays with | Setup |
|---|---|---|
| **Claude** (default) | your Claude subscription | the `claude` CLI, logged in |
| **Gemini** | your Google account: Google AI Pro / Ultra, or the free tier | `tools/gemini/install.sh --login` once on the server |
| **Gemini API** | pay per use with an AI Studio key | paste the key in Settings → AI; monthly cap there (estimated cost) |

- **Models by tier:** the Opus / Sonnet / Haiku choice in Settings → Teacher means Pro / Flash / Flash-Lite on Gemini. The interviewer picker shows Flash / Pro when Interview runs on Gemini.
- **Switching is live:** a lesson or interview switches at its next reply (the lesson is replayed into the new engine, materials included); a quiz run keeps its engine until it ends.
- **Comparing:** each grade (`ai-feedback.jsonl`), teacher reply and interview records which engine and model answered, so the interview home compares interviewers across engines too.
- **How:** `llm.js` is the one AI layer. Claude: `claude -p --input-format stream-json` per conversation, as before. Gemini: one `gemini --acp` process per conversation (JSON-RPC over stdio, streamed), with its own settings: no tools, MCP servers, extensions, skills or GEMINI.md, and the feature's system prompt swapped in (`GEMINI_SYSTEM_MD`). The Google sign-in is shared with your normal `gemini` (`~/.gemini`). Gemini API: `streamGenerateContent` over HTTPS, the conversation kept on the server. Images and PDF pages go to every engine.
- **Caveat:** the prompts were written and tuned on Claude. Gemini follows them, but if a Teach board or an interview turn looks off on Gemini, that's the place to look.

## 🤖 AI grading

When you press **Show answer**, Claude grades what you wrote, using your Claude subscription through the local `claude` CLI. No API key is needed.
- **The feedback card:**
  - a **score 0–100** and a one-line verdict
  - ✅ what you got right, ❌ what's missing (key vs minor)
  - 🧠 **what went wrong and probably why**
  - 💡 an explanation built on *your* words
- **One Claude session per run:** each test, practice run or smart-review run gets one `claude -p` conversation, and every question goes into it. Claude remembers your earlier answers in that run, notices recurring mix-ups, and gets each study note only once. The session closes when the run ends, or after 30 idle minutes.
- **What Claude sees:** the question, the reference answer, the topic's study note (with visuals stripped), and your last few attempts plus earlier AI feedback on that question.
- **Rating is automatic:** Claude's grade (or the multiple-choice pick) sets Again/Hard/Good/Easy for spaced repetition; press Enter or Next to accept, or Change to pick yourself. Without Claude the four buttons show as before.
- **Tests are graded by the AI score.** If grading fails for a question, its self-rating counts instead, and the results show whether the grade came from the AI, your self-ratings, or both. The results table shows both the AI score and how it felt to you.
- Every grade is saved to `data/ai-feedback.jsonl`.
- **Optional:** set `QUIZ_AI_MODEL=sonnet` (or any model alias) and/or `QUIZ_AI_EFFORT=low|medium|high` before starting the server to trade quality for speed. By default it uses your Claude Code default model.

## 💬 Side chat

A chat panel sits next to the question (below it on narrow windows). It unlocks after **Show answer**, so you can't peek first.
- Ask anything about the answer, or tap a suggestion: *Explain simpler*, *Another example*, *Why?*, *Common mistakes*.
- It runs in the same Claude session as the grading, so Claude already knows your answer, its feedback, the study note, and your earlier mix-ups in this run.
- Each new question starts a fresh chat thread. The conversation behind it continues.
- **Enter** sends, **Shift+Enter** adds a new line. Number keys don't rate while you're typing.
- Every exchange is saved in `data/chats.jsonl`.
- If the session closed after 30 idle minutes, a new one opens on its own.
- **📖 Still fuzzy: add to Study next** under each reply turns that exchange into a gap (see below). Claude reads both your chat question and its reply to find the missing concept.

## ⚖️ Appeal a grade

- **Graded against the question.** "Name three" + three correct items = full marks, even if the reference lists more ("any three of" is a menu). Extras the question didn't ask for show as **Good to know**, never as Missing.
- **Disagree? Say so in the chat** (or tap **Grade seems wrong?**). Claude re-checks honestly; it can say the grade stands. If you're right, the grade card updates in place (tagged *Re-graded after your appeal*), the rating follows, and any smaller questions written because of the wrong grade are removed.
- **It learns from it:** the ruling is remembered for that question (`data/grade-rulings.json`); a mistake that would repeat elsewhere becomes a **grading rule** every future grade follows (`data/grader-lessons.json`, listed on the Review setup page (Home → Customize) under *Grading rules you've taught Claude*, deletable, Undo right in the chat).
- **Reference answer unclear?** Claude can suggest a fix; **Update my notes** rewrites that answer in the vault (interactive views kept).

## 🧱 Building blocks → 📖 Study next

When an AI-graded answer scores under 70, Claude writes **1–3 smaller, precise questions** aimed at exactly what you missed or got wrong (e.g. "Where does a local variable like `x` live while its function runs: in the PCB or on the stack?").

- They're saved **in the vault**, at the end of the same `Questions/<Topic>.md`, under `# Building blocks`, each with `%% parent: <big question id> %%`. Edit or delete them in Obsidian like any question.
- The feedback lists them under **Smaller questions first**, each with **Remove** (deletes it from the file).
- This opens a gap on the big question: the blocks come up often, the big question rarely. Answer enough blocks well (2 of 3) and the gap closes, and the big question comes back with a boost. Blocks you know drop to normal spaced repetition, so they appear less and less.
- At most 3 unanswered blocks wait per big question; blocks never get blocks of their own.

Gaps can also come from the side chat:

- **Claude turns it into a gap.** In the background, it finds the underlying concept you're missing (often a building block, not the question itself), the 3–8 questions that build it, and the study-note section to read.
- **📖 Study next** on the Review setup page (the top 3 also on Home) lists open gaps by subject: the concept, your words, why it didn't land, what to read, and:
  - 📓 a link that opens the note in Obsidian at the right heading
  - 🎯 **Practice these**: the related questions, then the original one
  - ✓ **I get it now**: close it by hand
- **Question picking follows your gaps** (Smart review and Free practice; tests stay random):
  - the related questions come up about 3× more than an average question (practice puts them first)
  - the question you flagged comes up 10× less, but stays in rotation
  - only the 3 oldest open gaps per subject steer picking; newer ones are queued
- **Gaps close on their own** once you answer about half of the related questions well (up to 3). "Well" means an AI score of 75+, or Good/Easy when there's no AI score. Nailing the original question (Easy, or AI 85+) also closes it.
- **The original question comes back** after its gap closes: it's boosted until you answer it again.
- Open gaps are also listed under **Study next** in [[Quiz Progress]] with `[[note#heading]]` links.
- Stored in `data/gaps.json`. Without the `claude` CLI, a gap links to the question's own note and you close it by hand.
- The Obsidian vault name is taken from the vault folder name; set `QUIZ_VAULT=<name>` if it differs.

## 🧠 Think out loud + 🎙 voice

Ideas borrowed from [LearnHarness](https://github.com/amosblomqvist/learnharness): your *reasoning* tells the AI far more than the final answer does.
- **🧠 Think out loud**: one text box per question or lesson card. Write (or dictate) your reasoning and your answer together; the grader and the teacher pick out your final answer. Multiple choice has no answer box, so it gets an optional **Why?** box for your reasoning.
- **How sure are you?** 0 / 30 / 50 / 70 / 90 / 100 %. Unset is fine. Being sure *and* wrong flags a misconception worth fixing; being right but unsure gets one extra reinforcing touch.
- **🎙 Mic** next to the answer box, the thinking box and the chat. Click to talk, click again to stop (or **⌥/Alt + M**). Your voice is transcribed **on this Mac** with Whisper (`whisper-cli` + `~/.cache/quiz-whisper/ggml-small.en.bin`). No audio leaves the machine. The question's topic and key terms are passed as hints, so words like SIGKILL come out right. Override paths with `QUIZ_WHISPER_BIN` / `QUIZ_WHISPER_MODEL`.

## 🔘 Multiple choice

- **Answer style** (Smart review, Test and Practice): ✍️ Write · 🔘 Multiple choice · 🔀 Auto. Auto uses multiple choice for new and weak questions (box 0–1) and writing once a question starts to stick.
- Claude writes the options the first time a question is asked, then they're cached in `data/mcq-cache.json` (instant next time). If you edit the question or answer, its options are regenerated. Wrong options are each built from one specific misconception, so a wrong pick shows *which* wrong idea you hold.
- "I don't know" is always offered. Keys: **A–E / 1–5** pick, **⌘/Ctrl + Enter** reveals.
- The suggested rating tops out at **Good**: recognising the answer is easier than recalling it, so write it to earn Easy. The pick alone is the grade: right or wrong (100 or 0 in Test). If you also thought out loud, Claude comments on your reasoning (for example, a right pick that looks like a guess) but gives no score.
- Optional: write your own options in the question file (see Question format). They win over generated ones.

## 💡 Hints, smarter grading, and what Claude learns about you

- **💡 Hint** (before revealing): up to 4 rungs, each a little stronger, none giving the answer away: redirect your attention → re-describe the pattern → name the kind of idea → name the concept. Using 2+ hints caps the suggested rating at Hard.
- The AI feedback adds **what kind of miss** it was (cue: didn't think of it · discrimination: confused two similar things · execution: right idea, slip in the steps · careless · structural: a real gap in the underlying idea), a **suggested rating** (outlined; the choice is still yours), and a calibration note when you gave a confidence. A structural miss offers **📖 Add to Study next**.
- **🧠 What Claude has learned about you** (Review setup: Home → Customize): per subject, whether you're over- or under-confident, plus your recurring misconceptions per topic. It's kept in `data/learner-model.json` and refreshed in the background every few answers. Grading, hints and Teach mode all use it.

## 🗺 Map

- One node per study note, arrows = "understand this first". The arrows come from your notes' Study Path order plus prerequisites Claude reads from the notes (cached in `data/topic-map.json`; **↻ Rebuild** after adding notes). Foundations are at the bottom.
- Node colour = mastery. Badges: ⏰ due, 📖 open gaps, 🌱 **ready to learn** (under 40% mastery while everything it depends on is at least 40%).
- Hover a node to see what it needs and what it unlocks. Click it to **🧠 quiz the topic**, **🎓 Teach it**, or open the note in Obsidian.

## 🎓 Teach me

A tutor session in LearnHarness's style, on your Claude subscription:
1. **Probe:** it pins down your goal, then asks quick multiple-choice questions (with confidence + thinking) to find where your understanding ends.
2. **Plan:** a small map from what you know to the goal. Approve it or ask for changes.
3. **Teach:** step by step. You **predict** first, it explains (starting from your prediction), then a **check** applies the idea to a new case. Wrong options show their misconception. Ask the teacher anything at any time.

**Two teachers** (Settings → Teacher → Approach):
- **Fast (AI era)**, the default: AI writes most code, so the goal is to understand the subject, know what to ask an AI for, and read and judge its output. Lessons of about 20–30 min (10–15 cards, 3–5 ideas); syntax and flags only to recognise ("ask the AI for the exact form"); checks like "an AI wrote this script: what's wrong with it?"; terminal tasks only when seeing it break teaches more than words. Big goals are split, the rest goes to To Learn.
- **Classic**: the original teacher (git tag `teacher-classic`): thorough and hands-on, every step practised in the terminal and checked. A lesson switches at its next reply.
4. **Save to vault:** turns the lesson (and where you struggled) into a study note + 6–12 review questions in this format. It never overwrites a note, and new questions get a fresh id prefix.
   - **Nearly automatic:** when the done card arrives, the app prepares the note and questions in the background (same teacher, no click needed; a question you ask meanwhile waits for it). A banner above the composer says "Preparing your study note and review questions…", then "Note + N review questions ready" with **Save**, **Questions only** and **Preview** (the full preview), and afterwards "Saved to <note> · N questions in review" (the note opens in Obsidian). **Not now** hides it for that lesson; **Save to vault…** on the done card or in the ••• menu still works and reuses the prepared preview. Nothing is written until you press Save.
   - **Questions only** writes just the questions. Their "Source note" points to the lesson's own note when it has one, else to the preview's note if it already exists, else there's no source-note link (grading then works without a note).
   - **Hands-on lessons** (lab tasks or terminal commands) get a practical cheat-sheet note when using the tool was the point: commands/keys grouped by purpose, examples from what you actually ran, your mistakes and the fix, a short "why it works". Their questions ask for commands in context, predicting what a command does, and why.
   - Only once per lesson: it isn't started again when something is already saved or prepared, when it's already running, or after a rewrite of the last reply that reuses the preview. A server restart mid-way restarts it the next time you open the lesson. State: `autoSave` in the lesson file; server: `maybeAutoSave` in `teach.js`.

Start one from the 🎓 tab (type or say a goal, optionally pick a note), from a map node, or from **🎓 Teach me** on a Study next gap. Sessions are saved in `data/teach/` and can be resumed.

**Save for later (select → To Learn).** Select text in a teacher reply (or its card) and a small toolbar appears above it: **To Learn** (or press **L**), **Ask about this** (quotes it in the composer) and **Explain on the board** (a live board on just that part). Boards, fields and the terminal are left alone; Esc or a click elsewhere hides it. To Learn opens a small popover: the title starts as your selection and becomes Claude's topic name a few seconds later (grader model, `askOnce`), unless you've typed. Pick the list (default: the list the lesson came from, else a **From lessons** list, made on the first save) and press Enter. Saving before Claude answers is fine: the server names it afterwards. A toast says where it went (**Open** jumps to it), and the passage gets an underline and an **In To Learn** tag (saved in the lesson as `captures`, so they survive a reload). The teacher also flags what it deliberately skips (`later` in its reply, 0–2 topics); each shows under the reply as **Save “…” for later**, one click to save it to the default list. A lesson started from a saved item tells the teacher where it came from (the lesson, the quote or what was skipped). Server: `capture` in `tolearn.js`; browser: the "save for later" part of `ui/teach.js`.

**Board answers (on request).** Under any teacher reply, **Explain on the board** has the teacher redraw it as a whiteboard lesson; the board button in the composer does the same for whatever you ask next. The teacher places boxes, arrows, code (with a moving line highlight), tables and notes on a 12-unit grid, one idea per step, each with a spoken sentence. The app checks the layout (overlaps, overflow, unknown ids: the teacher gets one chance to fix them, then the board is repaired rather than failing the reply) and draws it step by step while your Mac's voice narrates. Play / pause, step back and forward, speed, voice on/off and voice choice (download a Premium English voice in System Settings → Accessibility → Spoken Content for a better one), plus a transcript. **Read aloud** under a reply speaks it. Server: `board.js`; player: `ui/board.js`.

**Hand-drawn canvas (Excalidraw).** On wide screens a board plays on a real Excalidraw canvas (vendored in `ui/vendor/excalidraw/`, loaded only when a board first shows; `ui/canvas.js`), with the same narration, captions and controls; phones get the simple drawing. Switch either way in the board's ••• menu or Settings → Boards. ⤢ opens it full screen. You can draw on it: a chip above the composer says your drawing will be sent (× to skip), and your next message or card answer carries it to the teacher (the scene as JSON, plus a PNG when you drew freehand, saved as `data/teach/<lesson>-<n>.png` and attached as an image). Drawings stay on the board while you're in the lesson (not across page reloads).

**Live board answers (the teacher draws while it talks).** Asking for a board (the composer's board button, or **Explain on the board** under a reply) now gets a live answer: within a few seconds the teacher starts speaking, sentence by sentence, and each drawing appears on the Excalidraw canvas as the voice reaches it (captions underneath, a red LIVE pill, **Stop** to cut it short; typing in the composer stops it too). The lesson's own teacher process writes it, so it knows the whole lesson: a `<title>`, spoken sentences with `<draw>{op}</draw>` tags between them (the same ops and grid as board answers), then the usual JSON reply, so cards and grading work as before (the card and the written recap show up as soon as the turn is stored, while the voice finishes). The server reads the reply as it streams (`--include-partial-messages`), splits it into sentences and ops, checks each op against what's already drawn (`board.liveBoard()`: an overlapping element is moved down, an op it can't repair is dropped) and sends them over Server-Sent Events (`GET api/teach/<id>/live`: `title`, `say {seq, text}`, `draw {op, afterSeq}`, `done {turn, board}`, `error`; a late or reconnecting browser gets the events it missed). The browser speaks in order and draws by the voice, not by the stream (text arrives ~40× faster than speech). Voice: the server's live voice (`POST api/voice/tts {purpose: 'live'}`, the free local engine, ~0.5 s to first audio) when it is installed, otherwise the browser's voice; the next sentence's audio is fetched while one plays. When it ends, the answer is stored as a normal board (one step per drawn sentence) and replays in the usual player. Typical timing: first words and first drawing ~6.5 s after you ask when the lesson's teacher is warm, 10–14 s right after a server restart (it re-reads the lesson first); most of that is the model thinking before it talks. Server: `LiveRun` in `teach.js`; browser: `ui/live.js`.

**Talking back (computer).** Two ways to cut in on the teacher by voice, both in a lesson:
- **Hold Space** (outside a text field): the teacher stops (live answer, board or read-aloud), you talk, and letting go transcribes and sends.
- **Hands-free** (the headphones button in the composer): the mic stays open; just start talking and the teacher stops, pause and it's sent. Best with headphones; with speakers the bar to start is higher while the teacher talks, and a take that only repeats the teacher's own words is dropped as echo. `ui/handsfree.js` (raw mic audio, a simple voice detector, 16 kHz WAV to the server's Whisper).

Cutting in while the teacher is still writing its live answer is fine: your question waits ("Asked: …") and goes out the moment that turn is stored. The message carries what you actually heard (`interrupted {heard, unheard}`), so "wait, what does that mean?" points at the right sentence and the teacher re-covers the part you never heard.

**🔊 Natural voice: free local by default, ElevenLabs on request.** Board narration, Read aloud and live answers use a server voice from `voice.js`, with three engines, cheapest first:
- **Local (free, default):** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) on Apple MLX (Metal), via `mlx-audio`. Install once (≈ 0.9 GB in `~/.local/share/quiz-tts`: a uv-managed Python 3.12 venv with pinned packages + the model): `tools/tts-server/install.sh`. The app starts the sidecar (`tools/tts-server/server.py`, 127.0.0.1:8737 only) on the first request (~3 s cold), keeps it running across app restarts, and it exits by itself after 20 idle minutes (≈ 0.6 GB RAM while running, brief peaks ~3 GB on long texts). About 20× faster than real time on an M3 Pro: a sentence in ~0.3 s, a 600-character paragraph in ~2 s. Default voice `bm_george` (British male, close to ElevenLabs' George); also Fable, Lewis, Michael, Fenrir, Heart, Bella, Emma. A board's narration is made right after the teacher draws it, so Play starts at once. Costs nothing and isn't counted in usage.
- **ElevenLabs Flash v2.5** ($0.04 per 1K characters) or **v3** ($0.08, most expressive): opt-in, needs a key in Settings (or `data/voice.json` `apiKey`, or `ELEVENLABS_API_KEY`). **Never made ahead:** pressing Play makes the step being played and the next one only; the cover shows the estimate first ("Premium voice · ~0.4k chars"). Read aloud goes chunk by chunk (each chunk made while the one before plays), so stopping early stops paying. With the local voice as default, the board's ••• menu offers **Play with premium voice (ElevenLabs)** for one board.
- **Browser voice:** when neither can speak (not installed, no key, an error).

Live answers (`purpose: 'live'`) always use the local voice, never ElevenLabs, unless `data/voice.json` says `"liveEngine": "elevenlabs"`. Config in `data/voice.json` (gitignored): `engine` (`local` | `elevenlabs`), `elevenModel` (`eleven_flash_v2_5` | `eleven_v3`), `localVoice`, `voiceId` (ElevenLabs), `monthlyCapUsd`. Audio is cached in `data/tts/` (the engine is part of the key; replays are free). Every paid call is logged in `data/voice-usage.json`; the ••• menu shows "This month: chars · ~$ of cap", and at `monthlyCapUsd` new audio falls back to the free voice (cached audio still plays). ElevenLabs audio tags like `[short pause]` become punctuation for Kokoro; other tags are dropped. The teacher keeps a board's narration to about 500–600 characters (strict check: at most 800), so the drawing carries the detail. Server: `voice.js` (prices in `PRICE_PER_1K`); sidecar: `tools/tts-server/` (see its README).

**⚙️ Settings** (gear in the sidebar header): sections on the left, every control saves at once and the app reacts live.
- **Look:** theme (system / light / dark), accent colour, text size (scales the window), density, animations, sidebar on open.
- **Teacher:** teacher and grader models (Opus / Sonnet / Haiku, all on the Claude subscription), approach (Fast (AI era) / Classic), style (mixed / Socratic / direct), reply length, how many quiz cards, whiteboard answers (when I ask / teacher decides / always).
- **Voice:** speed (playback rate, so cached audio is reused), read teacher replies aloud (free local voice), captions, an ElevenLabs spend warning; then the **voice engine** (Local (free) · ElevenLabs Flash · v3), local voices with previews, ElevenLabs voices (George, Pastor Paul, library search), the API key (hidden, with a show button; checked before it's saved), usage and the monthly cap. Free ElevenLabs plans can only use default voices through the API.
- **Boards:** canvas or simple drawing, hand-drawn or clean look, start at once or wait for Play, drawing pace (with the voice / fast / instant).
- **Mic:** Whisper model and language (Hebrew needs a multilingual model; the popup shows the download command), push to talk (hold ⌥ or `), stop after N seconds of silence (in lessons the message is then sent).
- **Quiz:** Review session size, new questions per session, grading strictness, hints in Practice, Test timer, daily goal (with a streak in the sidebar).
- **Shortcuts:** rebind the rating keys; a list of the others.
- **Data:** download a backup / restore one (progress, history, gaps, lessons, lists, settings; never the ElevenLabs key; the current files are copied to `data/backups/` first), clear the voice audio cache, delete lessons, reset all settings.

Preferences live in `data/prefs.json` (only what differs from the defaults). Server: `prefs.js` (schema, defaults, `GET/POST /api/prefs`), `data.js` (backup, restore, cache); browser: `ui/prefs.js` (`Quiz.prefs`, applied before the first paint), `ui/settings.js`. Routes that change settings, export data or reveal the key need an `x-quiz-settings` header so other websites can't read or change them.

### 📎 Materials: teach from your own pages

The Teach page has a **Materials** list: your course material, grouped by subject. **Add files** (or drop them on the list): a PDF (book, slides, homework sheet), photos of pages (several photos picked together become one set; paste a screenshot straight into the goal or the lesson's message box), or a text file (notes, code).

Attach pages to a lesson with **Add material** next to the goal (or **Teach me** on a material, or the 📎 in a lesson's message box), then say what they are:
- **Covered today:** these pages are the syllabus. The teacher probes, plans and teaches what they cover, in their order, with their terms and examples.
- **Practice from:** your exercises come from here. The teacher teaches what the exercises need and checks you with variations, never the exercises themselves. When you work through one of them together, it gives hints and questions, not the solution.
- **Reference:** background it can use.

Type pages as printed in the book (`40-55, 60`). When the PDF has a cover or preface first, use **Numbers off?** (or **Page numbers…** in the material's menu) to say which PDF page is the book's page 1. Writing "pages 40–55" or "homework" in the goal fills the sheet in for you, and a goal can be left empty: it is then made from the pages and their role. Thumbnails show which pages you picked. Up to 40 pages per attachment and 80 per lesson.

The teacher gets a PDF's pages as a real PDF, so it reads the text and sees the figures; heavy scans go as page images. The pages are sent again when a lesson resumes in a fresh process, and the note saved to the vault names the source pages. Files live in `data/materials/<id>/`. PDFs and photos need PyMuPDF in its own small venv: `tools/pdf/install.sh` (≈ 60 MB in `~/.local/share/quiz-pdf`, no sudo). Server: `materials.js` (+ `tools/pdf/pdftool.py`); browser: `ui/materials.js`.

## 📚 To Learn

Lists of things you want to learn, each item one click from a lesson.
- **New list:** paste anything (an agent's "what do I need to know to explain X?", a syllabus, notes). Claude splits it into lesson-sized items, keeps the sections and the suggested order, and merges duplicates.
- **What you already have:** each item is checked against your study notes and finished lessons. A chip shows the note it's covered or partly covered by, with that note's quiz mastery. An item only counts as known on its own when the note is covered *and* mastered (40%+); otherwise it stays to learn.
- **Teach / Teach next:** starts a lesson on that item. The teacher gets the list's end goal and where the item sits in it, plus your note when there is one. The item shows **Continue** while the lesson runs and ticks itself off when the lesson finishes.
- **Saved from lessons:** items you saved in a lesson (selected text or the teacher's "Save for later" chips, see Teach me) show **From lesson: <goal>**, which opens that lesson. Their lesson gets the quote and where it came from.
- Mark items learned, already known or skipped; add, rename or delete them. Lists live in `data/tolearn.json`.

## 💼 Interview: live mock coding interviews (computer only)

A 45-minute LeetCode interview in Python with an AI interviewer, over a voice call. Plan and design: `docs/INTERVIEW-PLAN.md`.
- **Problems:** NVIDIA's most asked LeetCode problems (`interview/catalog.json`, from liquidslr/leetcode-company-wise-problems, 131 problems, each hand-tagged with the patterns it needs). Only problems you can solve with the **patterns you know** come up: Arrays & strings, Hash map, Two pointers, Sliding window, Stack, Binary search to start. Click a pattern to add or remove it. When a finished Teach lesson or a DSA quiz topic (40%+) matches a new pattern (heap, linked list, graphs…), the tab offers to add it. "Learn next" shows which pattern unlocks the most problems.
- **Order:** never-done problems by NVIDIA frequency (pulled up by the 30-day / 3-month lists), Hard only after 3 passed Mediums, then repeats after 14 days, weakest pattern first.
- **Preparing a problem** (in the background, 6 kept ready ahead, 2 at a time, Opus): Claude writes the statement, starter code, examples, a reference solution, a brute force and a test generator. The server checks it: the reference must pass LeetCode's examples, the generator makes 30–80 cases (edge cases, random, a few near the max constraints), the reference's answers become the expected ones, and the brute force must agree on every small case. One repair round, then "Couldn't prepare" (Try again). The time limit is 25× the reference's slowest case (300 ms–4 s), so an O(n²) answer to an O(n) problem times out on the large cases. Stored in `data/interview/problems/`; a readable copy (solution folded) goes to `Learning/DSA/Interview/Problems/`.
- **The call:** pick Sonnet or Opus, check the mic, Join. The problem is on the left, a Python editor (CodeMirror 6: highlighting, auto-indent, no autocomplete, no run) in the middle, the Excalidraw board on the right. The mic is always open (hands-free, Whisper on the server); talking over the interviewer cuts it off, and it knows what you heard. It mostly listens (it can answer with silence), answers clarifying questions, pushes on complexity and edge cases, checks in after ~100 s of silence, and gives hints from a 4-rung ladder when you ask (Hint button or just ask) or are stuck. Code snapshots go to it when you pause typing; the board when it changes (a PNG too for freehand). Time warnings at 10 and 5 minutes; at 45 it closes the interview.
- **"I'm done"** (say it, or the button): the server runs your code against the hidden tests (`interview-runner.js` + `interview/harness.py`: a fresh temp folder, `python3 -I`, prlimit CPU and 768 MB, a per-test time limit, no network isolation). The results go to the interviewer only: on a bug it asks you to walk through a small input that shows it; too slow → "what's the complexity, can you do better?"; all pass → complexity and a follow-up.
- **Voice and mic (before joining):** pick the interviewer's voice: ElevenLabs (the most human; uses the account's credits, about 2–4k characters per interview, the free local voice takes over when they run out or the cap is hit) or any free local Kokoro voice, with Preview. The choice is remembered and replays use the same voice (`POST api/voice/tts {purpose: 'interview', engine, voice}`). **Headphones** on: normal speech cuts the interviewer off; off (speakers): you have to talk louder so it doesn't hear itself. **Esc** always cuts it off.
- **In the call:** drag the dividers between problem, editor and board (double-click resets; widths are remembered); hide the problem or the board from the bar. **Pause** stops the clock and the interviewer (the recording pauses too, so the replay stays in sync); after a pause of 20 s+ it welcomes you back.
- **Reloaded the page mid-call?** Home shows "An interview is still running: Rejoin" (your code is kept; a rejoined call isn't recorded further).
- **Debrief** (Opus, about a minute after the call): Strong hire / Hire / Lean no / No hire, scores 1–4 for Communication, Problem solving, Coding, Verification with timestamped evidence, key moments, a code review with the hidden-test result of your final code (failing inputs shown) and the reference solution, and **3 things to work on**. Concept gaps go to **Study next** (with Teach me); your last 3 sessions' "work on" items are given to the next interviewer to watch for. A note goes to `Learning/DSA/Interview/Sessions/`.
- **Replay:** your recorded voice (WebM, re-indexed with ffmpeg after the call) plus the interviewer's sentences (re-spoken from the voice cache), the code and the board as they were at each moment, a transcript you can click, and markers for hints, "done" and silences. Timestamps in the debrief jump there.
- **Sonnet vs Opus:** each session stores the model, its time to first words per turn and your 1–5 rating of the interviewer; Home compares them. Measured: Sonnet ~1.5 s to first words (median), Opus ~3 s.
- Files: `data/interview/sessions/<id>/` (`session.json`, `events.jsonl`, `mic.webm`, `board-<n>.png`), `data/interview/patterns.json`, `data/interview/prep.json`. Server: `interview.js`, `interview-problems.js`, `interview-runner.js`, `interview/`; browser: `ui/interview.js`, `ui/editor.js`. Env: `QUIZ_INTERVIEW_PREP_MODEL`, `QUIZ_INTERVIEW_DEBRIEF_MODEL` (both `opus`), `QUIZ_INTERVIEW_NO_AUTOPREP=1` (test copies).

## 🧪 Labs: a real terminal next to the teacher

Hands-on labs run in Teach, with a live terminal: on the home server itself (the default on Linux) or on a lab VM over ssh. You type every command yourself. The teacher sees each command and its output, gives you **lab tasks**, and grades you on the actual output.

**Prepared files:** when a task needs a helper program, sample data or a config file that isn't the point of the lesson, the teacher attaches it to the task as `setup`. The app writes it into the lesson's own folder (`<lessons folder>/<goal>-<id>/`, default `~/lessons/…`) before you see the task, and the card lists the files (click one to read it) with a "Copy cd" button. The part you're meant to learn you still do yourself.

- **Where it runs (Teach → Labs → Change):**
  - **This server** (default on Linux): a bash on homebox, started through util-linux `script` for a real terminal. It runs as your own user, so it can reach your files; the teacher keeps tasks inside the lesson folder, prefers things that need no sudo, and says clearly before anything that changes the system. The shell gets a clean environment (none of the app's settings).
  - **SSH machine:** a lab VM with your own SSH setup (`ssh rocky` by default). Key login is required, because the app can't type a password.
  - **Lessons folder:** where each lesson's folder goes (default `~/lessons`). `~/…` or an absolute path; hidden folders (like `~/.ssh`) and top-level system folders are refused.
- **Safety:** lab requests are accepted only from the app's own address (localhost or `QUIZ_PUBLIC_URL`, the Tailscale name), never cross-site, and POSTs need the `X-Quiz-Lab` header. The app is only on the tailnet.
  - `sudo` still works: it asks for your password in the terminal, and you type it there.
  - Keystrokes are never logged, so your password never reaches the log or the teacher.
- **What the teacher sees:** commands you ran since its last turn are attached to your next answer or message. **Show the teacher** asks it to look right away.
  - Each command carries its exit code (130 means Ctrl-C), its folder and its output. Long output is cut in the middle.
  - A "You ran N commands" marker shows where that happened in the lesson.
  - **Commands** in the terminal bar lists everything you ran, expands any output, and has **Ask about this**.
- **Lab tasks:** a task card says what to do and what to look for. The exact command is behind **Show hint**.
  - When you're done, answer its question and press **Done**, or press **I'm stuck**.
  - The teacher grades from your real output, then asks *why* the output looks like that.
- **Starting a lab:**
  - from **Teach → Labs** (lab files, with step progress);
  - from **🧪 Do it in the lab** on a lab task in the NVIDIA plan. This uses the matching lab file, or an improvised lab the teacher designs from the task text;
  - from the terminal button in any lesson's toolbar.
- **In ordinary lessons:** while the lab machine answers, every lesson has it available (turning it off in a lesson keeps it off). The teacher decides when trying something teaches better than a question. It sends a task, and your terminal opens on its own. It's most useful for Bash and Linux topics.
- **Saving:** **Save to vault** includes the lab tasks you missed or got stuck on, so they come back as quiz questions.

A lab file is `Learning/<Subject>/Labs/<Name>.md`:

```markdown
---
subject: Operating Systems
task: "strace ls and explain 5 syscalls …"   # optional: the NVIDIA plan task it belongs to
tags: [operating-systems, lab]
---

# 🧪 Syscalls, Sockets and Open Files

Goal: one sentence the lesson aims at.
Source note: [[fork, exec and wait - Creating and Controlling Processes]]

## Get the tools
%% step: tools %%
What to do, what to look for, and the questions to answer from the output.

> [!hint]-
> `sudo dnf install -y lsof`

> [!check]-
> ```bash
> command -v strace && command -v lsof
> ```
```

- Each `## ` is a step, and `%% step: id %%` is its stable id. Steps are done when their task is graded correct.
- `[!hint]` is shown only on request.
- `[!check]` is optional. It's one command the app runs on the lab machine when you press Done, and the teacher gets its real result. The command comes from your file, never from the model.
- The terminal lives in the server process. If the server restarts, the terminal shows *disconnected*; press **Reconnect**, and the command log is kept.

## Question format

```markdown
## What is a dynamic array?
%% id: da-002 %%
> [!answer]-
> The reference answer. Markdown works: **bold**, `code`, lists, code blocks.
```

Optional hand-written multiple-choice options go before the answer, with a blank line between the two callouts (otherwise Obsidian merges them):

```markdown
## Why does a zombie process exist?
%% id: zo-003 %%
> [!choices]-
> - [x] The kernel keeps the child's exit status until the parent collects it with wait()
> - [ ] The child still holds its memory until the parent frees it :: thinks a zombie keeps its resources
> - [ ] The child is paused until the parent resumes it :: thinks the child isn't dead yet

> [!answer]-
> ...
```

- `## ` heading = the question
- `%% id: ... %%` = stable ID (hidden in Obsidian's reading view). **Never change an ID** or the question loses its history. You can reword the question freely.
- `> [!answer]-` = a folded callout, so you can also self-test inside Obsidian by clicking to expand.
- Optional: text or code between the id line and the answer is shown as part of the question (e.g. "what does this code print?").

## Data

- `data/progress.json`: current box/attempts per question ID
- `data/prefs.json`: Settings preferences (only the ones you changed)
- `data/backups/<time>/`: what was there before a backup was restored
- `data/history.jsonl`: every answer, one JSON object per line
- `data/ai-feedback.jsonl`: every AI grade (score, correct/missing/misconceptions, explanation)
- `data/tests.jsonl`: every graded test (subject, score, grade, time, each question's rating and time)
- History lines can carry `extra`: thinking, confidence, answer format (write/mcq), the pick, hints used
- `data/mcq-cache.json`: generated multiple-choice options · `data/topic-map.json`: the map's arrows
- `data/learner-model.json`: what Claude has learned about you · `data/teach/*.json`: Teach sessions
- `data/materials/<id>/`: Teach materials (the file, `meta.json`, page thumbnails, page slices sent to the teacher)
- `data/lab/<lesson id>.jsonl`: commands run in a lesson's lab terminal (command, exit code, folder, output) · `data/lab.json`: lab mode (local / ssh), ssh host, lessons folder
- `data/tolearn.json`: To Learn lists (items, status, linked lesson, `origin` for items saved from a lesson)
- `data/ai.json`: Gemini API key, monthly cap, chosen model ids and usage per month (the engine choice itself is in `prefs.json`)
- `data/voice.json`: voice engine, local + ElevenLabs voice, ElevenLabs key, monthly cap · `data/tts/`: cached narration MP3s (local and ElevenLabs) · `data/voice-usage.json`: characters and estimated $ per call and month

- `data/offline.json`: whether preparing the offline pack is running · `data/offline-synced.json`: ids of synced offline answers · `data/client.json`: the learner's time zone
- Files are saved atomically (`store.js`: write a temp file, then rename). A data file that can't be parsed is kept as `<file>.corrupt-<time>` before the app falls back to empty, and unreadable lines in a `.jsonl` log are skipped instead of breaking the app.

## For developers: feature modules

Each feature is its own file and is skipped if missing: server modules `llm.js` (the AI engine layer every AI call goes through), `dictation.js, mcq.js, offline.js, topicmap.js, lab.js, teach.js (+ board.js), tolearn.js, practice.js, learner.js, interview.js (+ interview-problems.js, interview-runner.js), materials.js` (loaded by `server.js`, which passes them a small `ctx`), and front-end modules `ui/think.js, mcq.js, practice.js, map.js, lab.js, board.js, live.js, handsfree.js, materials.js, teach.js, tolearn.js, home.js, offline.js, editor.js, interview.js` (plus the service worker `ui/sw.js`, served as `sw.js`) (`ui/xterm*.js` is xterm.js 5.5, vendored) that plug into `window.Quiz` hooks defined in `index.html` (`showQuestion`, `beforeReveal`, `afterReveal`, `payload`, `resultItem`, `afterRate`, `tab`, `runStart`). The comments at the top of the hooks block in `index.html` describe the contract. A full backup from before these features is in `~/quiz-backups/`, and this folder is a local git repo.

Plain files, so they're easy to migrate to a real database later.

## Interactive answers (views)

Answers can end with an interactive visual or animation:

```markdown
> ```dataviewjs
> await dv.view("Learning/_quiz/views/front-removal", {n: 6})
> ```
```

- The same file (`views/<name>.js`) runs in **Obsidian** (through Dataview's `dv.view`) and in the **quiz app**, where it appears after you reveal the answer.
- `views/README.md` has the rules for writing a view and the catalog of existing ones.
- Test all views with `node Learning/_quiz/check-views.js --questions`.
- New questions and visuals are written by the **question-writer** agent (`.claude/agents/question-writer.md`).
