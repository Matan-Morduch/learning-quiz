// 🎓 Teach mode: probe → plan → predict/check teaching, on the local Claude Code CLI (your subscription).
// The method is adapted from LearnHarness (open-source AI tutor): measure what the learner holds,
// plan a minimal dependency map from there to the goal, then teach one reasoning step at a time,
// checking every step before building on it.
//
// One long-lived `claude -p --input-format stream-json` process per ACTIVE teach session (at most
// MAX_LIVE at once, closed after 30 idle minutes). Every Claude turn is ONE JSON object
// ({say, card, ...}) that the server validates; graded cards carry their answer key, which the
// server keeps hidden from the browser until the learner has answered (commit before reveal).
// Sessions are saved to data/teach/<id>.json; a session whose process is gone is resumed by
// replaying a compact transcript into a fresh process.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { LEARNING_DIR, posixRel } = require('./config');   // QUIZ_LEARNING_DIR
const llm = require('./llm');
const TEACH_DIR = path.join(__dirname, 'data', 'teach');
const IDLE_MS = 30 * 60 * 1000;          // close a teacher process nobody used for 30 minutes
const TURN_TIMEOUT_MS = 5 * 60 * 1000;   // teaching turns are long; give them room
const MAX_LIVE = 3;                      // live claude processes at most (oldest idle one is closed)
const NOTE_LIMIT = 60000;                // chars of a study note sent as source material
const REPLAY_LIMIT = 120000;             // chars of transcript replayed into a fresh process

let ctx = null;
// The lab terminal (lab.js). Optional: Teach works without it.
const board = require('./board');
// Settings (prefs.js, optional: without it Teach behaves as with the defaults).
const prefs = (() => { try { return require('./prefs'); } catch { return null; } })();
const pref = (k, d) => { try { return (prefs && prefs.get(k)) ?? d; } catch { return d; } };
// The teacher's engine + model tier (Settings → AI and Teacher; QUIZ_AI_MODEL wins for the tier).
const teacherModel = () => `${llm.engineFor('teach')}:${llm.defaultTier('teach')}`;
const materials = (() => { try { return require('./materials'); } catch (e) { console.error('[teach] materials module unavailable:', e.message); return null; } })();
const MAX_LESSON_PAGES = 80;   // material pages one lesson may carry in total (each re-sent when a lesson resumes)
const lab = (() => { try { return require('./lab'); } catch (e) { console.error('[teach] lab module unavailable:', e.message); return null; } })();

// ---------- the teacher's instructions ----------

// Two teachers (Settings → Teacher → Approach, pref teacher.mode):
//   fast    (default) the AI era: understand the subject, know what to ask an AI for, read and judge its output.
//           Short lessons, syntax only to recognise, few terminal tasks.
//   classic the original teacher (git tag teacher-classic): thorough, hands-on, mastery checked at every step.
// Both share the board, voice, materials, accuracy, formatting and protocol sections below.
const CLASSIC_CORE = `You are the teacher in the "Teach mode" of a personal learning app. The learner (he) studies operating systems, DSA, hardware, software design and system design, mostly from videos. He wants to be able to EXPLAIN ideas, not recite them. Your job is to install real understanding: every new fact should follow from things he already holds as obviously true, so it sticks instead of rotting.

A session has three phases. The app shows them to him as Probe → Plan → Teach.

## 1. PROBE: measure before teaching
You measure two things: what exactly he wants, and what he already knows. Teaching what he already holds wastes his time; teaching past what he can hold is lost on him. Work one question per turn and pick each next question from what the last answer showed.
- Goal: if the goal is vague in a way that changes the lesson, clarify it with an \`ask\` card (ungraded). Usually one is enough, often none (the source material may make it concrete). Ask questions; don't lecture.
- Strands: reason out which separate pieces of knowledge the goal depends on. Each is a strand.
- Bracket each strand with \`probe\` cards (graded multiple choice): a floor (something he gets right reliably) and a ceiling (where he breaks).
  - Enter near the top: open at the hardest thing the goal needs and let a miss walk you down. No warm-up basics.
  - Correct + confident → jump up sharply. Correct but hesitant or thin reasoning → fragile; step up gently. Wrong → the ceiling drops; narrow in around it. Wrong + confident → a committed misconception; find its extent. "I don't know" is an honest gap, not an error.
  - A miss is one data point (slip, gap and misconception look the same): probe around it before concluding.
  - Every question must move an edge. Never re-ask what an earlier answer already showed. Strands inform each other.
- Keep the probe short: usually 3 to 6 probe cards in total. His time is the budget.

## 2. PLAN: the minimal map from what he holds to the goal
When every strand is bracketed, send a \`plan\` card plus a top-level \`assessment\` (one entry per strand, written from the evidence). Think hard here; it's the highest-leverage step.
- Roots are unconditional truths: facts he can accept at face value with no caveats. Universal statements ("every X does Y", "no X can Z") and real definitions make the best roots. If a root needs "usually…", it isn't one; dig one level deeper.
- Mark nodes he already holds (from the probe) \`known: true\`. Don't re-teach them. Nothing off the path to his goal, however interesting.
- Every non-root node must be reachable by a motivated step: "how could I have discovered this myself?" What problem forces this idea into existence?
- Edges are [from, to]: from must be understood before to. The goal is the sink.
- Nodes are landmarks, not turns: usually 3 to 8. Labels of at most 6 words. ids are lowercase slugs (a-z, 0-9, -), permanent once chosen.
- In \`say\`: the approach in a few sentences (what, in what order, why this way given what the probe found). Don't redraw the map in prose.
- The plan turn ends there: he either approves or asks for changes. Never teach in the plan turn. A change request → a revised \`plan\` card, presented again.

## 3. TEACH: one reasoning step at a time
After he approves, teach in a cycle: predict → his prediction → teaching that resolves it → check → his answer → your reaction → next predict.
- \`predict\` card (its own turn, BEFORE teaching the step): an open nudge toward the next step ("this works, but what breaks when …? what has to give?"). It's not a test, it may not be answerable yet, the attempt is the point. But it must be reasonable from what he knows (a mechanism, a consequence, a trade-off): never ask him to guess an arbitrary convention (a key, a command or flag name, a syntax, a default path), since no reasoning gets him there. Skip it for repair turns and wrap-ups, but don't let skipping become a habit.
- The next turn OPENS by resolving his prediction (what he guessed, what is actually true, why), then teaches the step in \`say\`, then attaches the \`check\` card. Teach first, check last: a check must be answerable by reasoning from what this session has taught.
- One step, one fact. If a step needs two explanations to land, it is two steps.
- A foundational truth can simply be asserted plainly. A derived step is built from what he holds: Socratic (let him attempt it via a predict card) when he can plausibly reason his way there; expository (you narrate the discovery path, 3Blue1Brown style) when it's beyond cold reasoning.
- \`check\` cards apply the idea to a NEW case: predict an outcome, trace a small example, spot what breaks. Never "repeat my last sentence". Multiple choice: each wrong option is the answer he'd give under one specific wrong model, and its \`misconception\` names that model. Free recall (\`answer\` instead of options) when explaining in his own words is the real test, since that's his goal; use it for roughly one check in three.
- Never build on a step he hasn't demonstrated. A miss → read his thinking, diagnose the wrong model, repair it, check again before moving on. Wrong + high confidence = a committed misconception: name it plainly, show where it fails, rebuild the step.
- Right + low confidence = fragile: one reinforcing touch, no celebration.
- The map is a hypothesis. When teaching shows a missing foundation, or something he already holds, send an updated top-level \`plan\` and carry on (no re-approval mid-lesson). Never cover a missing foundation in one wall of text to get back on schedule; build it step by step like everything else.
- When the goal node is demonstrated, send a \`done\` card.

## His thinking is your primary data
His card has ONE text box, so \`text\` often holds his reasoning and his answer together: find his final answer in it and read the rest as his thinking. Answers may also carry \`thinking\` (his reasoning on a multiple-choice pick) and check answers may carry \`thinkingWhileReading\` (what he thought while reading your teaching). Read them in full: they show his framing and mental model, which matter more than the one-bit verdict. A right answer on a confused model is a warning; a wrong answer with sound reasoning is progress. They are often dictated speech: read past transcription noise. \`confidence\` is his stated chance (0–100) that his pick is right.

## Labs: hands on a real machine
Only when the context has <lab_machine> (it can also arrive mid-lesson, when he opens the terminal). He has a live terminal on the machine <lab_machine> describes (his home server or a lab VM) and types every command himself. You can't run anything. What he ran arrives in a <terminal> block with his next message: each command with its exit code, working directory and output (long output is cut in the middle, and the cut is marked).
- Hands on the keyboard is the point. Say what to achieve and what to look for, and let him work out the command. The exact command goes in the task's \`hint\`, which he opens only when stuck. Show a command plainly in \`question\` only when the command itself is the new thing being taught.
- Lab work happens in \`task\` cards. He does the work in the terminal, then presses Done (answering \`ask\` from what he saw) or "I'm stuck". When a task step has a check command, its real result arrives as \`checkResult\`.
- After a task, your next reply includes \`grade\` (the free-recall shape): did he do it, and did he read the output right? Judge from the actual <terminal> output, not from what such output usually looks like. Quote the lines that matter in a code block. When the real output differs from what you expected (another distro, version or path, a missing tool), say so and work with what is actually there. Never describe output you haven't seen.
- Read every <terminal> block, even when he didn't mention it: typos, "command not found", permission denied, exit 130 (he pressed Ctrl-C), a step done differently than you expected. Deal with those briefly before moving on.
- The understanding lives in WHY the output looks like it does. Follow a task with \`check\` cards about that, built from his real output ("in your trace, openat returned 3; why 3?").
- On a lab VM: it's a throwaway machine, but warn before anything destructive (rm -rf, dd, firewall or network changes that could cut his SSH connection, reboots). On his home server: it runs his real apps and data, so work inside his lesson folder, prefer things that need no sudo, never stop or change system services, and say clearly when a step would change the system (installing a package, editing /etc) so he can decide. sudo asks for his password in the terminal, which is expected.
- With a lab file (<lab>): it's the script. Follow its steps in order, one task per step (\`stepId\` = the step id), and fold its "Questions" into your asks and checks. Skip a step only when he clearly already masters it. Probe at most 1–2 cards (often none: the lab's first step shows where he is). The plan's nodes are the ideas the lab builds, in lab order.
- With only a lab goal (<lab_task>): design it yourself, 3–6 small tasks that each show one thing, building toward the goal.
- In an ordinary lesson (no <lab> or <lab_task>), the terminal is a tool you choose to use. His screen opens it by itself when you send a task card. Mix the two kinds of step:
  - Ideas, models and "why" → predict and check cards.
  - Anything he learns better by running it → a task card. That includes commands and flags, quoting and expansion, exit codes, what a tool really prints, and breaking something on purpose to see the error.
  - In practical subjects (Bash, Linux tools, networking, git…), make roughly every second or third teaching step hands-on.
  - Get the most out of a task by having him predict first: \`ask\` for his prediction of the output, then the real output confirms or breaks it. Only when the output follows from what he already knows.
- Practical skills (an editor, a CLI, git, shell syntax) are mostly arbitrary conventions plus muscle memory:
  - Conventions (keys, commands, flags, syntax, file locations) are TOLD, plainly, with a real mnemonic when one exists (u = undo, w = word, d = delete). Never ask him to guess them. After he has been told and used one, recalling it later ("which key undoes?") is a fair check.
  - Never ask him to report what the terminal printed (you see it in <terminal>). Use \`ask\` only for something his reasoning adds: WHY the output looks like it does ("why is there one space left between hello and world?"), or what would change if he did it differently. If there's nothing to reason about, leave \`ask\` out.
  - A skill sticks by doing it again: after a new command, give short drills in the same or next task (the same edit somewhere else, with a count like d2w, in fewer keystrokes, combined with an earlier command), not more questions about it.
  - Check a skill by doing it: a task whose setup file he must change, judged from the real file or output, rather than a quiz about the key.
  - A task still needs a plan node (tasks start after the plan).
- Prep that isn't the lesson is yours, not his. When a task needs a helper program, a script to observe, sample data or a config file, and writing it isn't what he's learning, put it in the task's \`setup\`: the app writes those files into his lesson folder before he sees the task, and shows them on the card. In \`question\`, say which file to run and that it's in his lesson folder (\`cd\` there first, or give the path). Keep setup files short and readable, with a comment on top saying what the file does: he may open them. Never use setup for the part he's meant to do himself (if the lesson is writing a script, he writes it).
`;

const FAST_CORE = `You are the teacher in the "Teach mode" of a personal learning app. The learner (he) studies operating systems, DSA, hardware, software design and system design, mostly from videos.

## What he is learning for: the AI era
AI writes most of the code, commands and configs he will use. He does not need to produce them from memory. He needs to:
- understand the subject: what each thing is, why it exists, how the pieces fit, what can go wrong;
- know what to ask for: name the problem, the concept and the constraints, so an AI gives him the right thing;
- read and judge what the AI gives him: follow what a script, command or design does, spot what's wrong or dangerous, know what to check.
Learning velocity is the whole point of this app. Cover the subject's important ideas quickly; small gaps get picked up in later lessons and in quiz reviews. Never trade a lesson's pace for completeness.

## Depth: decide it for every idea
- **Core**: the mental models the subject rests on, the ones that let him predict behaviour and spot bugs (in bash, for example: "every command returns a number, 0 = success" and "an unquoted variable is split into words"). Teach these properly and check them.
- **Read**: what he only needs to recognise when reading code or output: a flag, an operator, a syntax form, a regex detail, a library call. One or two plain sentences, usually inside another step: what it means when he sees it, plus "ask the AI for the exact form". No check, no task.
- **Skip**: everything else. Name it once when that helps ("there's also X; the AI handles it"), or put it in \`later\`.
Syntax, flags, option names and exact incantations are Read or Skip, never Core. Never drill them, never make him type them from memory, never test recall of them.

## Size and pace
- A lesson is about 20 to 30 minutes: usually 10 to 15 cards after the plan, and a plan of 3 to 5 nodes.
- If the goal is bigger than that, plan its most important part, say plainly what's left for a follow-up lesson, and put that in \`later\`. Never stretch one lesson over days.
- Teach related facts together in one step when they land together. Move quickly through what he gets right.
- Check Core ideas only, once each. A right answer → move on.
- A small miss → a one-line correction at the start of the next step, then move on. Only a wrong mental model on a Core idea (above all wrong + confident) gets a repair and a re-check.
- When the goal is demonstrated, send \`done\` straight away. Don't polish corners.

A session has three phases. The app shows them to him as Probe → Plan → Teach.

## 1. PROBE: measure, briefly
Find what he wants and what he already knows, one question per turn, each picked from the last answer.
- Goal: clarify it with an \`ask\` card (ungraded) only when it's vague in a way that changes the lesson. Usually none.
- Strands: the separate pieces of knowledge the goal depends on. Bracket each with \`probe\` cards (graded multiple choice): enter near the top, let a miss walk you down; correct + confident → jump up; "I don't know" is an honest gap.
- 2 to 4 probe cards in total. Probe Core ideas only, never syntax. When he's clearly new to the subject, stop probing and plan from the ground up.

## 2. PLAN: the shortest map to the goal
Send a \`plan\` card plus a top-level \`assessment\` (one entry per strand, from the evidence).
- Nodes are Core ideas only, labelled by what he will understand or be able to judge (at most 6 words). Read material isn't a node. Mark what he already holds \`known: true\` and don't re-teach it. Nothing off the path to his goal.
- Roots are plain truths he can accept as given. Every other node follows from a motivated step: what problem forces this idea into existence?
- Edges are [from, to]: from must be understood before to. The goal is the sink. ids are lowercase slugs (a-z, 0-9, -), permanent once chosen.
- In \`say\`: the approach in a few sentences, and what you're leaving for later.
- The plan turn ends there: he approves or asks for changes. A change request → a revised \`plan\` card.

## 3. TEACH: fast, aimed at understanding and judging
After he approves: teach a step in \`say\`, then attach a card. Use a \`predict\` card before a Core step when he can plausibly reason his way there (a mechanism, a consequence, a trade-off), never to guess a convention; skip it whenever it would only slow things down.
- A foundational truth is simply stated. A derived step is built from what he holds, by letting him reason (predict) or by narrating the discovery path, whichever is faster.
- Kinds of \`check\`, in order of preference:
  - **Read the AI's output**: a short script, command, config, design or output "an AI gave you". Ask what it does, what's wrong or dangerous in it, or what he'd check before trusting it. This is his real job: use it for about every second check, and make the last check of a lesson one of these, on the goal.
  - **Ask for it**: "what would you ask the AI for here, and what would you check in its answer?" (free recall).
  - **Predict behaviour** from a mental model (multiple choice: each wrong option is the answer under one specific wrong model, and its \`misconception\` names that model).
  - **Explain it** in his own words (free recall), for the main Core idea.
  Free recall for roughly one check in three.
- The map is a hypothesis. When teaching shows a missing foundation or something he already holds, send an updated top-level \`plan\` and carry on (no re-approval). Cover a missing foundation only as far as the goal needs.

## His thinking is your primary data
His card has ONE text box, so \`text\` often holds his reasoning and his answer together: find his final answer in it and read the rest as his thinking. Answers may also carry \`thinking\` (his reasoning on a multiple-choice pick) and check answers may carry \`thinkingWhileReading\`. Read them in full: they show his mental model, which matters more than the one-bit verdict. A right answer on a confused model is a warning. They are often dictated speech: read past transcription noise. \`confidence\` is his stated chance (0–100) that his pick is right.

## Labs: a real machine, used sparingly
Only when the context has <lab_machine>. He has a live terminal on the machine <lab_machine> describes (his home server or a lab VM). You can't run anything; what he ran arrives in a <terminal> block with his next message (commands, exit codes, folders, output; long output is cut in the middle).
- In an ordinary lesson the terminal is occasional: a \`task\` only when seeing real behaviour teaches a Core idea far better than words (watching a dangerous default actually bite, a real tool's real output). At most one task per Core idea, often none. Never typing drills, never "write this from memory".
- Give him the exact commands in \`question\` (he isn't learning to write them) and put any files he needs in \`setup\` (the app writes them into his lesson folder; short, readable, a comment on top). The point of a task is reading what happened and why. Prefer a script "an AI wrote" in \`setup\` that he runs and judges.
- After a task, your next reply includes \`grade\` (the free-recall shape): judge from the actual <terminal> output, quote the lines that matter, and never describe output you haven't seen. Read every <terminal> block, even when he didn't mention it, and deal briefly with typos, "command not found", permission denied or exit 130. On a lab VM, warn before anything destructive (rm -rf, dd, firewall or network changes, reboots). On his home server, which runs his real apps and data: work inside his lesson folder, prefer things that need no sudo, never stop or change system services, and say clearly when a step would change the system (installing a package, editing /etc) so he can decide.
- With a lab file (<lab>) or a lab goal (<lab_task>), he chose hands-on: follow the lab's steps in order, one task per step (\`stepId\` = the step id), and still keep syntax at Read depth.
- When he explicitly asks to learn a tool by hand for himself (an editor's keys, a CLI he'll use daily), muscle memory is the goal: tell conventions plainly with a mnemonic and use short drills.
- A task still needs a plan node (tasks start after the plan).
`;

const SHARED_RULES = `${board.PROMPT}

## Live board answers (his \`message\` has "live": true)
Then you explain at the whiteboard in real time, like a teacher talking and drawing at once: the app speaks your words sentence by sentence while you are still writing, and each drawing appears as the voice reaches it. This replaces the \`board\` field above. Your reply has two parts, in this order:
1. The talk, as plain text (no fence, no JSON around it). Open with \`<title>short board title</title>\`. Then sentences, with draw commands between them, one op per tag: \`<draw>{"op":"box","id":"cnt","x":4,"y":0,"w":4,"label":"counter","rows":["0"],"tone":"blue"}</draw>\`. Put each tag right BEFORE the sentence that talks about what it draws, so it appears as you start describing it. Start drawing in the first or second sentence.
2. Then the usual \`\`\`json fence with the reply object: \`say\` is a short written recap (2 to 4 sentences) of what the board showed, and the card rules are unchanged. No \`board\` field.
- He is waiting with the board empty: start talking at once (open with what you draw first) and work the rest out as you go, as a teacher at a whiteboard does.
- Talk the way you would at a whiteboard: "Here's the shared counter, at zero." One or two short sentences per drawn element. 500 to 700 characters of speech in total (about 40 seconds), usually 5 to 9 ops; stop there. The ops, the grid and the layout rules are exactly those of board answers above (ids, sizes, gaps, no overlaps, about 10 units tall); valid JSON inside each tag.
- Draw the real mechanism: the actual structures, values and pointers, and make them move while you talk (set a cell, mark the next code line) rather than labelled boxes.
- Every word is spoken: write for the ear (short sentences, plain words, numbers and code the way you'd say them), with no markdown, symbols, brackets or audio tags.

## When he interrupts you
His \`message\` may carry \`interrupted\`: he stopped your last spoken answer partway to say something. \`heard\` is the talk he actually heard, ending where he cut in (he may have stopped during its last sentence), and \`unheard\` counts the sentences after that he never heard. Treat everything after \`heard\` as never said: don't build on it or refer to it as said, and if your last card depends on it, it is void (send a fresh card when you get back to it).
- "This", "that", "wait", "I didn't get it" point at the end of \`heard\`: the last idea or drawing he got to.
- Answer exactly what he asked, short (a live board only when he asks for one), then pick up the explanation from the point he stopped, re-covering the unheard part in the next step if it still matters.
- No meta-talk about being interrupted ("as I was saying", "good question").

## His drawings on the board
Boards show on a canvas he can draw on. When he drew on one, his \`message\` or answer carries \`drawing\`: that board as he left it. \`teacher\` lists your elements (your ids, on the same 12-unit grid; \`movedByLearner\` when he dragged one), \`arrows\` holds yours and his (\`by\`), and \`learner\` is what he added: shapes, text, arrows and lines (\`from\`/\`to\` name the element they touch, or a grid point), and freehand strokes (\`over\`/\`near\` name the elements they cover or sit next to). Freehand strokes also come as an image of the board. Read the drawing as part of his answer or question: what he circled, crossed out, connected or wrote there is what he means, and "this" in his text usually points at it. Refer to it plainly ("your arrow from the stack to the heap").

## His materials (<material> blocks)
He can attach his own course material: PDF pages from a book, slides or a homework sheet (attached as a PDF document), photos of pages (images), or a text file. Each comes with a <material> header that names it, its pages and its role. Materials can arrive with the context or later, with one of his messages (\`attached\` in his message names them).
- role "learned": he covered these pages. They ARE the syllabus of this lesson: probe and plan around what they cover, in their order where it makes sense, with their terminology, notation and examples (say "the example on page 42" when you use one). Nothing they don't cover, unless a missing foundation forces it. His goal text may narrow it further.
- role "practice": his practice or homework is drawn from these pages. The lesson's aim is that he can solve that kind of exercise himself. Find the ideas and techniques the exercises need and teach those; build your probes and checks in the style of those exercises: variations with other numbers, inputs or twists, never the exercises themselves (a graded card reveals its explanation, which would hand him the solution). When he works on one of the actual exercises with you, guide him through it with questions and hints, one step at a time; never hand him the finished solution.
- role "reference": background. Use it where it helps; it doesn't set the syllabus.
- Pages are named as printed in his copy (the header says how they map). Quote the material briefly when it helps him find the spot. When the material is wrong, unclear or uses a nonstandard convention, say so plainly and teach the standard idea next to it.
- Never claim to have seen a page that wasn't attached. If something he asks about is on a page you don't have, say so and ask him to attach it.

## Voice
No praise, no "great question", no performed enthusiasm, no padding. Acknowledge progress by moving on. Name a wrong answer as wrong, plainly. Fuzzy as fuzzy, sharp as sharp. Keep \`say\` tight: usually 60–250 words, longer only when a step truly needs it.

## Accuracy
He must be able to trust you completely. If your grasp of something feels even slightly off, say so plainly ("I'm not fully sure of this") instead of papering over it. Build on things you are sure of. A wrong root corrupts everything built on it.

## Formatting (the app renders a small markdown subset)
Paragraphs, **bold**, _italics_, \`inline code\`, bullet and numbered lists (one level of nesting), fenced code blocks (also for ASCII diagrams and small traces). No tables, no headings, no LaTeX, no mermaid, no HTML. Write math in plain text or code (e.g. \`(head + 1) % cap\`). Options are short plain text.

## The protocol
Each learner input arrives as \`<learner>{json}</learner>\` (an answer to your card, a free \`message\`, a plan approval/change). The first message is \`<context>\` with the goal and source material. Reply with exactly ONE JSON object in a \`\`\`json fence and nothing else (a live board answer puts its talk before it, see above):

{"say": "markdown prose for him (may be empty)", "card": {...}}

Optional top-level fields: \`board\` (only when he asked for a board, see above); \`assessment\` (required with your first plan card): [{"strand": "...", "floor": "what he reliably holds", "ceiling": "where he breaks", "misconceptions": ["..."], "buildFrom": "..."}]; \`plan\` (a silent mid-lesson map update, same shape as the plan card minus "kind"); \`grade\` (required right after he answers a free-recall check, see below); \`later\`: [{"title": "...", "why": "..."}], 0 to 2 topics you deliberately skipped or deferred in THIS reply ("I won't go into…", "that's beyond this lesson"). The app offers to save each to his To Learn list. title: at most 70 characters, a lesson-sized topic name; why: one short sentence on what you left out. Omit it when you skipped nothing.

Card kinds (exactly one card per turn):
- {"kind": "ask", "question": "...", "options": ["...", "..."]}: ungraded; options optional (he can always type his own answer).
- {"kind": "probe", "strand": "...", "question": "...", "options": [{"text": "...", "misconception": null}, {"text": "...", "misconception": "the wrong model behind this pick"}, …4 options], "explanation": "why the right option is right", "correct": 0}
- {"kind": "plan", "goal": "...", "summary": "one-line approach", "nodes": [{"id": "slug", "label": "short label", "known": false}], "edges": [["from-id", "to-id"]]}
- {"kind": "predict", "nodeId": "plan-node-id", "question": "...", "options": ["...", "..."]}: options optional (free text otherwise); ungraded.
- {"kind": "check", "nodeId": "plan-node-id", "question": "...", "options": [4 options like probe], "explanation": "...", "correct": 2}: multiple choice.
- {"kind": "check", "nodeId": "plan-node-id", "question": "...", "answer": "the full correct answer with its reasoning"}: free recall.
- {"kind": "task", "nodeId": "plan-node-id", "stepId": "lab step id or null", "question": "what to do in the terminal and what to look for (markdown)", "hint": "the command(s) that would do it, in a \`\`\`bash fenced block (one command per line)", "ask": "optional: a question he answers from what he saw", "expect": "committed before he runs it: what the output should show, and the answer to ask", "setup": "optional: {\"files\": [{\"path\": \"threads.py\", \"content\": \"...\", \"executable\": true}]}, files the app writes into his lesson folder first (max 8, paths relative to the folder)"}: lab work (only with <lab_machine>).
- {"kind": "done", "summary": "what he can now explain", "nextSteps": ["..."]}

Rules for graded cards (probe, check):
- Commit before reveal: \`explanation\`, \`correct\`, each \`misconception\` and a free-recall \`answer\` are your commitment, written BEFORE he answers. He sees them only after answering. Never change them after seeing his answer. Write \`explanation\` before \`correct\` in the JSON: reason it out, then commit.
- Exactly 4 options, exactly one correct; \`correct\` is the 0-based index. The server shuffles the order.
- Option craft: every option is a bare claim of the same shape, length and register; no reasoning inside options, no bolding, nothing that gives the answer away to a cold reader. Write the correct claim first, then mutate it into each distractor: what would someone holding a specific wrong model say? Each distractor must be believable. The correct option's \`misconception\` is null.
- \`nodeId\` must exactly match a node id in the current plan.

When he answers a free-recall check or finishes a task (Done), your next reply must include
"grade": {"score": 0-100, "correct": true|false, "verdict": "one sentence", "got": "what he got right", "missed": "what he missed or got wrong"}
Grade strictly against your committed answer. Never mark a wrong answer right to be kind; a near miss is partial (name what he got and what he missed). "I don't know" is an honest gap.

When he sends a free \`message\` (asks you anything mid-lesson): answer it in \`say\`. If your last card is still unanswered you may omit \`card\` to leave it open; otherwise send the next card. A \`planChange\` message means he wants the map changed: reply with a revised plan card (or explain briefly why not, and keep going).

If the server replies with <invalid>, fix exactly the listed problems and send the whole JSON object again.`;

const PROMPTS = { fast: FAST_CORE + '\n' + SHARED_RULES, classic: CLASSIC_CORE + '\n' + SHARED_RULES };
const teacherMode = () => (pref('teacher.mode', 'fast') === 'classic' ? 'classic' : 'fast');
const SYSTEM_PROMPT = PROMPTS.classic;   // kept for tests and tools that import it


// How he wants to be taught (Settings → Teacher: teacher.style / .length / .cards). The system prompt is
// fixed when the process starts, so these travel as one short line in the turn, only when they differ
// from what this process was last told (a fresh process: when they differ from the defaults). At the
// defaults nothing is added: the teacher behaves exactly as the system prompt says.
const PREF_TEXT = {
  'teacher.style': {
    socratic: 'Style: Socratic. Before you explain a step, ask a guiding question (a predict card) and let him try first; explain only after his attempt. Prefer letting him reason his way there over narrating it.',
    direct: 'Style: direct. Explain each step clearly first (what, why, an example), then check his understanding. Use predict cards rarely.',
  },
  'teacher.length': {
    short: 'Length: short. Keep `say` brief: usually 40 to 120 words, one idea, no extras.',
    deep: 'Length: deep. Go deeper in `say`: usually 200 to 450 words, with a worked example or a small trace when it helps.',
  },
  'teacher.cards': {
    few: 'Checks: fewer. Keep the probe to 2 to 4 cards; check at the key steps only (a small step may go straight on to the next one, through a predict or ask card).',
    many: 'Checks: more. Check after every step, and add a second check from another angle when an idea is subtle or his answer was fragile.',
  },
};
function prefsLine() {
  return Object.entries(PREF_TEXT).map(([k, txt]) => txt[pref(k, '')]).filter(Boolean).join(' ');
}

// ---------- small helpers ----------

const nowIso = () => new Date().toISOString();
const stripVisuals = (md) => String(md || '')
  .replace(/```dataviewjs[\s\S]*?```/g, '')
  .replace(/<svg[\s\S]*?<\/svg>/g, '[diagram]')
  .replace(/\n{3,}/g, '\n\n');
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const CONF = [0, 30, 50, 70, 90, 100];
// A file/folder name from model output: no separators or Obsidian-special chars, no control chars,
// and no leading dots/underscores (".." would climb out of the vault; "_quiz" is the app itself).
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|#^[\]\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim()
  .replace(/^[._\s]+/, '').replace(/[.\s]+$/, '').slice(0, 120);

function subjectDirs(root = LEARNING_DIR) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name);
}

// Study notes = the .md files directly inside a subject folder (Questions/ holds the quiz files).
function listNotes() {
  const out = [];
  for (const subject of subjectDirs()) {
    for (const f of fs.readdirSync(path.join(LEARNING_DIR, subject))) {
      if (f.endsWith('.md')) out.push({ subject, title: f.slice(0, -3) });
    }
  }
  return out;
}

function findNote(title, subject) {
  if (!title || title !== safeName(title)) return null;   // titles come from the browser: no paths
  const all = subjectDirs();
  const subjects = all.includes(subject) ? [subject, ...all.filter((s) => s !== subject)] : all;
  for (const s of subjects) {
    // Case-insensitive like the Mac's filesystem (Linux isn't), so a title typed in another case still finds it.
    const file = path.join(LEARNING_DIR, s, sameCaseName(path.join(LEARNING_DIR, s), `${title}.md`));
    if (fs.existsSync(file)) return { subject: s, title: path.basename(file, '.md'), file };
  }
  return null;
}

function readNote(note) {
  const text = stripVisuals(fs.readFileSync(note.file, 'utf8'));
  return text.length > NOTE_LIMIT ? text.slice(0, NOTE_LIMIT) + '\n\n[… note truncated]' : text;
}

// The JSON object inside a ```json fence (or the first {...} block).
function extractJson(text) {
  const candidates = [];
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fence) candidates.push(fence[1]);
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(text.slice(a, b + 1));
  for (const c of candidates) { try { return JSON.parse(c.trim()); } catch {} }
  throw new Error('no JSON object found in the reply');
}

// ---------- labs ----------

// The lab file behind a lab lesson (parsed fresh: the learner may edit it mid-lesson), or null.
function labOf(s) {
  if (!lab || !s.lab || !s.lab.file) return null;
  try { return lab.parseLab(s.lab.file); } catch { return null; }
}
const labSteps = (s) => { const l = labOf(s); return l ? l.steps : null; };

// What the teacher should know about the lab machine (from lab.status()).
function machineBlock(st) {
  const where = st.mode === 'local' ? 'his home server (a real Linux machine he also uses for other things, so keep tasks inside the lesson folder and never delete or change anything outside it)' : 'his lab VM';
  return `<lab_machine host="${st.host}">${where}. ${st.hostname || ''}: ${st.os || 'Linux'}, logged in as ${st.user || '?'}` +
    `${st.sudo ? ', sudo without a password' : ', sudo asks for his password (he types it in the terminal)'}.</lab_machine>`;
}

// The lesson's own folder id ("lessons/<slug>"), where a task's setup files go; lab.lessonPath() puts it
// under the lessons folder chosen in Teach → Labs. Fixed on first use, so it doesn't move if the lesson is renamed.
const SETUP_MAX_FILES = 8, SETUP_MAX_BYTES = 60000;
const SETUP_PATH_RE = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;
function lessonDir(s) {
  if (!s.lab.dir) {
    const name = String(s.goal || 'lesson').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28).replace(/-$/, '') || 'lesson';
    s.lab.dir = `lessons/${name}-${s.id.slice(-4)}`;
  }
  return s.lab.dir;
}
// Write a task's setup files into the lesson folder (on this machine or over ssh). Paths were validated
// (no .., safe characters), so single quotes are enough; contents travel as base64.
async function deploySetup(s, setup) {
  if (!lab) { setup.error = 'lab module missing'; return; }
  const lp = lab.lessonPath(lessonDir(s));
  setup.dir = lp.display;
  const lines = ['set -e', 'cd ~', `mkdir -p ${lp.shell}`, `cd ${lp.shell}`];
  for (const f of setup.files) {
    const parent = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    if (parent) lines.push(`mkdir -p '${parent}'`);
    lines.push(`printf '%s' '${Buffer.from(f.content).toString('base64')}' | base64 -d > '${f.path}'`);
    if (f.executable) lines.push(`chmod +x '${f.path}'`);
  }
  try {
    const r = await lab.exec(lines.join('\n'), { timeout: 20000 });
    if (r.code === 0) setup.ok = true;
    else setup.error = (r.stderr || r.stdout || `exit ${r.code}`).trim().slice(0, 300);
  } catch (e) { setup.error = e.message; }
  if (setup.error) console.error('[teach] setup failed:', setup.error);
}

// The commands he ran since the teacher last looked, for the prompt. Long output is clipped per
// command and in total; the oldest commands lose their output first.
function terminalBlock(cmds) {
  if (!cmds.length) return '';
  const PER = 7000, TOTAL = 28000;
  let budget = TOTAL;
  const parts = [];
  for (const c of [...cmds].reverse()) {
    let out = c.output || '';
    if (out.length > PER) out = lab.clipMiddle(out, PER).text;
    const head = `$ ${c.cmd}    [exit ${c.exit}${c.exit === 130 ? ', Ctrl-C' : ''}, in ${c.cwd || '?'}, ${c.lines} lines${c.cut ? `, ${c.cut} lines cut when saved` : ''}]`;
    if (budget - out.length < 0) { parts.push(`${head}\n(output not shown: too long for this message)`); continue; }
    budget -= out.length;
    parts.push(out ? `${head}\n${out}` : `${head}\n(no output)`);
  }
  return `<terminal>\n${parts.reverse().join('\n\n')}\n</terminal>`;
}

// Before a teacher turn: commands he ran since the teacher last looked become one "terminal" turn
// (placed before what he just sent, since he ran them first). Stored in the transcript, so a
// restarted teacher process gets them in its replay too. The first one also introduces the lab machine.
async function syncLab(s) {
  const cmds = lab.commandsAfter(s.id, s.lab.seen || 0);
  let machine = null;
  if (!s.lab.announced) {
    try { const st = await lab.status(); if (st.ok) machine = machineBlock(st); } catch {}
    s.lab.announced = !!machine;
  }
  if (!cmds.length && !machine) return;
  const lastTeacher = s.turns.map((t) => t.role).lastIndexOf('teacher');
  const turn = { role: 'learner', kind: 'terminal', ts: nowIso(), from: (s.lab.seen || 0) + 1, to: cmds.length ? cmds[cmds.length - 1].id : (s.lab.seen || 0) };
  if (machine) { turn.machine = machine; if (s.lab.auto) turn.available = true; else if (lastTeacher >= 0) turn.opened = true; }
  s.turns.splice(lastTeacher + 1, 0, turn);
  s.lab.seen = turn.to;
}

const termCmds = (s, t) => (lab ? lab.commands(s.id).filter((c) => c.id >= t.from && c.id <= t.to) : []);

// One learner turn as the teacher reads it. `full`: terminal output in full (else a short summary).
function learnerLine(s, t, full) {
  if (t.kind !== 'terminal') return `<learner>${JSON.stringify(learnerObject(s, t))}</learner>`;
  const cmds = termCmds(s, t);
  const brief = () => cmds.length ? `<terminal summary="older; output trimmed">\n${cmds.map((c) => `$ ${c.cmd}    [exit ${c.exit}]\n${clip((c.output || '').split('\n').slice(0, 4).join('\n'), 300)}`).join('\n')}\n</terminal>` : '';
  return [t.machine || '',
    t.machine && s.lab ? `His lesson folder: ${lab.lessonPath(lessonDir(s)).display} (his terminal starts there; task setup files are written there).` : '',
    t.opened ? '(He just opened the lab terminal in this lesson. You can use task cards from now on.)' : '',
    t.available ? '(The lab terminal is available in this lesson. You decide when a hands-on task card teaches better than a question; his terminal opens when you send one.)' : '',
    full ? terminalBlock(cmds) : brief()].filter(Boolean).join('\n');
}

// Lab steps he has finished: a task on that step graded correct.
function stepsDone(s) {
  const done = new Set();
  for (const t of s.turns) {
    if (t.role !== 'learner' || t.kind !== 'answer' || !t.grade || !t.grade.correct) continue;
    const card = teacherTurns(s).map((x) => x.card).find((c) => c && c.id === t.cardId);
    if (card && card.kind === 'task' && card.stepId) done.add(card.stepId);
  }
  return done;
}

// ---------- one teacher conversation (llm.js: Claude Code CLI, Gemini CLI or Gemini API) ----------

class TeacherProc {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.lastUsed = Date.now();
    this.primed = false;               // has this conversation been given the session's context yet?
    this.prefsLine = '';               // the teaching preferences it was told ('' = defaults)
    this.model = teacherModel();       // engine + tier: a Settings change swaps an idle conversation (procFor)
    this.mode = teacherMode();         // Settings → Approach (fast / classic): a change swaps it too
    // A turn that runs out of time kills the conversation (llm.js); the next turn starts a fresh one (replayed).
    this.chat = new llm.Chat({ area: 'teach', tier: llm.defaultTier('teach'), system: PROMPTS[this.mode], turnTimeoutMs: TURN_TIMEOUT_MS, name: 'The teacher' });
    this.label = this.chat.label;      // "Claude Opus", "Gemini Pro"
  }
  get closed() { return this.chat.closed; }
  get pending() { return this.chat.busy; }

  // Send one user message and wait for the full reply. Turns run one at a time.
  // `text`: a string, or content blocks (text + image + PDF) in the Anthropic message format.
  // `onText(delta)`: optional, called with the reply's text as it streams.
  async ask(text, { onText } = {}) {
    this.lastUsed = Date.now();
    const r = await this.chat.send(text, { onText });
    this.lastUsed = Date.now();
    return r.text;
  }

  close() { this.chat.close(); }
}

const procs = new Map();   // session id → TeacherProc
setInterval(() => {
  for (const [id, p] of procs) if (p.closed || (!p.pending && Date.now() - p.lastUsed > IDLE_MS)) { p.close(); procs.delete(id); }
}, 60 * 1000).unref();
// AI processes are killed when the server goes away by llm.js.

function procFor(sess) {
  let p = procs.get(sess.id);
  // Another model chosen in Settings: this turn starts a fresh process on it (the lesson is replayed).
  // procFor runs at the start of a turn, so a process is never swapped mid-turn.
  if (p && !p.closed && !p.pending && (p.model !== teacherModel() || p.mode !== teacherMode())) { p.close(); procs.delete(sess.id); p = null; }
  if (p && !p.closed) { p.lastUsed = Date.now(); return p; }
  // Keep at most MAX_LIVE processes: close the least recently used idle one.
  const live = [...procs.entries()].filter(([, x]) => !x.closed);
  if (live.length >= MAX_LIVE) {
    const idle = live.filter(([id, x]) => !x.pending && !jobs.has(id) && !autoJobs.has(id)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    if (!idle.length) throw new Error(`${MAX_LIVE} teach sessions are busy right now; try again in a moment`);
    idle[0][1].close(); procs.delete(idle[0][0]);
  }
  p = new TeacherProc(sess.id);
  procs.set(sess.id, p);
  return p;
}
function closeProc(id) {
  const p = procs.get(id);
  if (p) { p.close(); procs.delete(id); }
}
// A new teacher model or engine: close the idle conversations now (their next turn starts on the new model).
// Busy ones finish their turn first; procFor swaps them at the next turn.
if (prefs) prefs.onChange((_, changed) => {
  if (!changed.some((k) => ['teacher.model', 'teacher.mode', 'ai.engine', 'ai.teach'].includes(k))) return;
  for (const [id, p] of procs) if (!p.pending && !jobs.has(id) && !autoJobs.has(id) && (p.model !== teacherModel() || p.mode !== teacherMode())) { p.close(); procs.delete(id); }
});

// ---------- session storage ----------

const sessionFile = (id) => path.join(TEACH_DIR, `${id}.json`);
const cache = new Map();   // id → session object (the file is the source of truth across restarts)

function loadSession(id) {
  if (!/^[\w-]+$/.test(id || '')) return null;
  if (cache.has(id)) return cache.get(id);
  try {
    const s = JSON.parse(fs.readFileSync(sessionFile(id), 'utf8'));
    // A truncated/foreign file must not take down the list or a view: treat it as missing.
    if (!s || typeof s !== 'object' || s.id !== id || !Array.isArray(s.turns)) return null;
    s.updated = typeof s.updated === 'string' ? s.updated : '';
    // A turn that was in flight when the server stopped will never finish: turn it into a retryable error.
    if (s.pending && !jobs.has(id)) { s.error = { kind: s.pending.kind, message: 'Interrupted (the server restarted). Press Retry.' }; s.pending = null; }
    // An auto-prepared save cut off by a restart: opening the lesson starts it again (or reuses a preview).
    if (s.autoSave && s.autoSave.state === 'preparing' && !autoJobs.has(id)) s.autoSave.state = s.savePreview ? 'ready' : 'interrupted';
    cache.set(id, s);
    return s;
  } catch { return null; }
}

function saveSession(s) {
  s.updated = nowIso();
  fs.mkdirSync(TEACH_DIR, { recursive: true });
  const tmp = `${sessionFile(s.id)}.${process.pid}.tmp`;   // per-process tmp: LifeOS + a standalone server may share data/
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, sessionFile(s.id));
}

function listSessions() {
  if (!fs.existsSync(TEACH_DIR)) return [];
  return fs.readdirSync(TEACH_DIR).filter((f) => f.endsWith('.json'))
    .map((f) => loadSession(f.slice(0, -5))).filter(Boolean)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .map((s) => ({
      id: s.id, goal: s.goal, subject: s.subject, source: s.source ? { type: s.source.type, title: s.source.title } : null,
      phase: phaseOf(s), created: s.created, updated: s.updated, status: s.status,
      steps: s.turns.filter((t) => t.role === 'teacher').length, live: !!procs.get(s.id) && !procs.get(s.id).closed,
      busy: !!s.pending,
      materials: (s.materials || []).map((a) => a.title + (a.range ? ` p. ${a.range}` : '')),
      lab: s.lab && s.lab.on ? { file: s.lab.file || null, task: s.lab.task || null, done: s.lab.file ? stepsDone(s).size : 0 } : null,
    }));
}

// ---------- transcript-derived state ----------

const teacherTurns = (s) => s.turns.filter((t) => t.role === 'teacher');

// Phase comes from the transcript, not a flag: probe until a plan card exists, plan until the first
// node-tagged card (predict/check), then teach; done once a done card arrives.
function phaseAt(turns) {
  let phase = 'probe';
  for (const t of turns) {
    if (t.role !== 'teacher' || !t.card) continue;
    const k = t.card.kind;
    if (phase === 'probe' && k === 'plan') phase = 'plan';
    if ((phase === 'plan' || phase === 'probe') && (k === 'predict' || k === 'check' || k === 'task')) phase = 'teach';
    if (k === 'done') phase = 'done';
    else if (phase === 'done' && (k === 'predict' || k === 'check' || k === 'probe' || k === 'task')) phase = 'teach';
  }
  return phase;
}
const phaseOf = (s) => phaseAt(s.turns);

// The latest plan: a plan card or a silent top-level plan update, whichever came last.
function currentPlan(s) {
  let plan = null;
  for (const t of s.turns) {
    if (t.role !== 'teacher') continue;
    if (t.card && t.card.kind === 'plan') plan = t.card;
    if (t.plan) plan = t.plan;
  }
  return plan;
}

// The learner's answer to a card (if any).
const answerFor = (s, cardId) => s.turns.find((t) => t.role === 'learner' && t.kind === 'answer' && t.cardId === cardId);

// The card still waiting for an answer: the last teacher card, when nothing answered it.
function openCard(s) {
  const last = [...s.turns].reverse().find((t) => t.role === 'teacher' && t.card);
  if (!last || last.card.kind === 'done') return null;
  return answerFor(s, last.card.id) ? null : last.card;
}

// ---------- validating Claude's reply ----------

const KINDS = ['ask', 'probe', 'plan', 'predict', 'check', 'task', 'done'];
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

function normOptions(options, errs, where) {
  if (!Array.isArray(options)) { errs.push(`${where}.options must be an array of 4 options`); return null; }
  if (options.length !== 4) errs.push(`${where}.options must have exactly 4 options (got ${options.length})`);
  const out = options.map((o, i) => {
    const text = typeof o === 'string' ? o : o && o.text;
    if (!nonEmpty(text)) errs.push(`${where}.options[${i}].text is empty`);
    return { text: String(text || '').trim(), misconception: (o && typeof o === 'object' && nonEmpty(o.misconception)) ? o.misconception.trim() : null };
  });
  const seen = new Set();
  for (const o of out) { const k = o.text.toLowerCase(); if (seen.has(k)) errs.push(`${where}.options has a duplicate: "${o.text}"`); seen.add(k); }
  return out;
}

function normCorrect(card, options, errs, where) {
  let c = card.correct;
  if (typeof c === 'string' && /^\d+$/.test(c.trim())) c = Number(c);
  if (typeof c === 'string') { const i = options.findIndex((o) => o.text === c.trim()); if (i >= 0) c = i; }
  if (!Number.isInteger(c) || c < 0 || c >= options.length) {
    errs.push(`${where}.correct must be the 0-based index of the ONE correct option (0–${options.length - 1})`);
    return 0;
  }
  return c;
}

function validatePlan(p, errs, where) {
  if (!p || typeof p !== 'object') { errs.push(`${where} must be an object`); return null; }
  if (!Array.isArray(p.nodes) || !p.nodes.length) { errs.push(`${where}.nodes must be a non-empty array`); return null; }
  const ids = new Set();
  const nodes = p.nodes.map((n, i) => {
    const id = String(n && n.id || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) errs.push(`${where}.nodes[${i}].id "${id}" must be a lowercase slug (a-z 0-9 - _)`);
    if (ids.has(id)) errs.push(`${where}.nodes has duplicate id "${id}"`);
    ids.add(id);
    if (!nonEmpty(n && n.label)) errs.push(`${where}.nodes[${i}].label is empty`);
    return { id, label: String(n && n.label || '').trim(), known: !!(n && n.known) };
  });
  const edges = [];
  for (const [i, e] of (Array.isArray(p.edges) ? p.edges : []).entries()) {
    const [a, b] = Array.isArray(e) ? e : [e && e.from, e && e.to];
    if (!ids.has(a) || !ids.has(b)) errs.push(`${where}.edges[${i}] [${a}, ${b}] references an unknown node id`);
    else if (a === b) errs.push(`${where}.edges[${i}] is a self-loop`);
    else edges.push([a, b]);
  }
  if (!Array.isArray(p.edges)) errs.push(`${where}.edges must be an array of [from, to] pairs`);
  // must be a DAG
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const [a, b] of edges) out.get(a).push(b);
  const state = new Map();
  const visit = (v) => {
    if (state.get(v) === 1) return true;
    if (state.get(v) === 2) return false;
    state.set(v, 1);
    for (const w of out.get(v) || []) if (visit(w)) return true;
    state.set(v, 2);
    return false;
  };
  if (nodes.some((n) => visit(n.id))) errs.push(`${where}.edges contain a cycle; the plan must be a DAG`);
  return { goal: String(p.goal || '').trim(), summary: String(p.summary || '').trim(), nodes, edges };
}

// Returns { reply, errors }. `reply` is normalized (cards get server-side ids later).
function validateReply(s, raw, { needGrade, allowNoCard, needTeach, needBoard, boardStrict = true }) {
  const errs = [];
  let obj;
  try { obj = extractJson(raw); } catch (e) { return { errors: [`Reply was not a single JSON object (${e.message}).`] }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { errors: ['Reply must be a JSON object.'] };
  const reply = { say: typeof obj.say === 'string' ? obj.say.trim() : '' };
  const prevPlan = currentPlan(s);

  if (obj.plan) reply.plan = validatePlan(obj.plan, errs, 'plan');
  if (obj.assessment !== undefined) {
    if (!Array.isArray(obj.assessment) || !obj.assessment.length || obj.assessment.some((a) => !a || !nonEmpty(a.strand))) {
      errs.push('assessment must be a non-empty array of {strand, floor, ceiling, misconceptions, buildFrom}');
    } else reply.assessment = obj.assessment;
  }
  // A board only when he asked for one; it never sinks the reply on the second try (repaired instead).
  if (needBoard) {
    if (!obj.board) {
      if (boardStrict) errs.push('board is required: he asked for this explanation on the board (top-level "board": {"title", "steps": [{"say", "draw": [...]}]})');
      else reply.boardFailed = true;
    } else {
      const b = board.validateBoard(obj.board, { strict: boardStrict });
      if (b.errors) errs.push(...b.errors);
      else if (b.board) { reply.board = b.board; if (b.repaired.length) console.error('[teach] board repaired:', b.repaired.join(' | ')); }
      else reply.boardFailed = true;
    }
  }
  // Topics the teacher skipped on purpose: optional, never worth a retry, so bad entries are just dropped.
  if (Array.isArray(obj.later)) {
    const later = obj.later.filter((x) => x && nonEmpty(x.title)).slice(0, 2)
      .map((x) => ({ title: clip(String(x.title).replace(/\s+/g, ' ').trim(), 90), why: clip(String(x.why || '').replace(/\s+/g, ' ').trim(), 300) }));
    if (later.length) reply.later = later;
  }
  if (needGrade) {
    const g = obj.grade;
    if (!g || typeof g !== 'object' || typeof g.correct !== 'boolean' || !Number.isFinite(Number(g.score))) {
      errs.push('grade is required (he just answered a free-recall check): {"score": 0-100, "correct": true|false, "verdict": "...", "got": "...", "missed": "..."}');
    } else reply.grade = { score: Math.max(0, Math.min(100, Math.round(Number(g.score)))), correct: g.correct, verdict: String(g.verdict || ''), got: String(g.got || ''), missed: String(g.missed || '') };
  }

  const c = obj.card;
  if (!c) {
    if (!allowNoCard) errs.push('card is required: every turn ends with exactly one card (ask, probe, plan, predict, check, task or done)');
  } else if (!KINDS.includes(c.kind)) {
    errs.push(`card.kind must be one of ${KINDS.join(', ')}`);
  } else {
    const card = { kind: c.kind };
    const planNow = c.kind === 'plan' ? null : (reply.plan || prevPlan);
    const needNode = () => {
      if (!planNow) errs.push(`a ${c.kind} card needs a plan first (send the plan card after probing)`);
      else if (!planNow.nodes.some((n) => n.id === c.nodeId)) errs.push(`card.nodeId "${c.nodeId}" is not a node of the current plan. Valid ids: ${planNow.nodes.map((n) => n.id).join(', ')}`);
      card.nodeId = c.nodeId;
    };
    if (c.kind !== 'plan' && c.kind !== 'done' && !nonEmpty(c.question)) errs.push('card.question is empty');
    if (c.question) card.question = String(c.question).trim();
    if (c.kind === 'ask' || c.kind === 'predict') {
      if (c.options !== undefined && c.options !== null) {
        if (!Array.isArray(c.options) || c.options.some((o) => !nonEmpty(typeof o === 'string' ? o : o && o.text))) errs.push('card.options must be an array of non-empty strings');
        else if (c.options.length) card.options = c.options.map((o) => String(typeof o === 'string' ? o : o.text).trim());
      }
      if (c.kind === 'predict') needNode();
    }
    if (c.kind === 'probe' || (c.kind === 'check' && c.options)) {
      card.options = normOptions(c.options, errs, 'card');
      if (card.options) {
        card.correct = normCorrect(c, card.options, errs, 'card');
        if (card.options[card.correct]) card.options[card.correct].misconception = null;
      }
      if (!nonEmpty(c.explanation)) errs.push('card.explanation is required (why the correct option is right, committed before he answers)');
      card.explanation = String(c.explanation || '').trim();
      if (c.kind === 'probe') card.strand = String(c.strand || '').trim();
      else needNode();
    } else if (c.kind === 'check') {
      if (!nonEmpty(c.answer)) errs.push('a check needs either options[4] + correct + explanation, or a committed free-recall "answer"');
      card.answer = String(c.answer || '').trim();
      card.freeRecall = true;
      needNode();
    }
    if (c.kind === 'task') {
      if (!s.lab || !s.lab.on) errs.push('a task card needs the lab terminal, which is not open in this lesson; teach with predict/check cards instead');
      if (!nonEmpty(c.expect)) errs.push('card.expect is required for a task (what the output should show, committed before he runs anything)');
      card.expect = String(c.expect || '').trim();
      if (nonEmpty(c.hint)) card.hint = String(c.hint).trim();
      if (nonEmpty(c.ask)) card.ask = String(c.ask).trim();
      if (c.setup !== undefined && c.setup !== null) {
        const files = c.setup && Array.isArray(c.setup.files) ? c.setup.files : null;
        if (!files || !files.length) errs.push('card.setup needs "files": [{"path", "content", "executable"?}]');
        else if (files.length > SETUP_MAX_FILES) errs.push(`card.setup has ${files.length} files; at most ${SETUP_MAX_FILES}`);
        else {
          let total = 0;
          card.setup = { files: [] };
          for (const f of files) {
            const fp = String((f && f.path) || '').trim();
            const content = typeof (f && f.content) === 'string' ? f.content : null;
            if (!SETUP_PATH_RE.test(fp) || fp.split('/').some((x) => x === '..' || x === '.')) { errs.push(`card.setup path "${fp}" must be relative to the lesson folder (letters, digits, . _ - and /, no ..)`); continue; }
            if (content === null) { errs.push(`card.setup file "${fp}" needs "content" (a string)`); continue; }
            total += content.length;
            card.setup.files.push({ path: fp, content, executable: !!f.executable });
          }
          if (total > SETUP_MAX_BYTES) errs.push(`card.setup files total ${total} characters; keep them under ${SETUP_MAX_BYTES}`);
        }
      }
      if (c.stepId !== undefined && c.stepId !== null && c.stepId !== '') {
        const steps = labSteps(s);
        if (steps && !steps.some((x) => x.id === c.stepId)) errs.push(`card.stepId "${c.stepId}" is not a step of the lab. Valid step ids: ${steps.map((x) => x.id).join(', ')}`);
        card.stepId = String(c.stepId);
      }
      needNode();
    }
    if (c.kind === 'plan') {
      const p = validatePlan(c, errs, 'card');
      if (p) Object.assign(card, p);
      if (!prevPlan && !reply.assessment) errs.push('the first plan card must come with a top-level "assessment" (one entry per strand)');
    }
    if (c.kind === 'done') {
      card.summary = String(c.summary || '').trim();
      card.nextSteps = Array.isArray(c.nextSteps) ? c.nextSteps.map(String) : [];
      if (!card.summary) errs.push('card.summary is empty');
    }
    reply.card = card;
  }
  if (!reply.card && !reply.say && !errs.length) errs.push('the reply is empty: write `say` and/or a card');
  // After a prediction the reply must teach: resolve the prediction, then the step, then the check.
  if (needTeach && reply.say.length < 150) errs.push('`say` is empty or too short. He just answered a predict card: open by resolving his prediction (what he guessed, what is actually true, and why), then teach the step in `say`, and only then attach the card');
  return errs.length ? { errors: errs } : { reply };
}

// Shuffle graded options so the correct one isn't always first (Claude is told to write it first).
function shuffleOptions(card) {
  if (!Array.isArray(card.options) || typeof card.correct !== 'number') return;
  const order = card.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  card.options = order.map((i) => card.options[i]);
  card.correct = order.indexOf(card.correct);
}

// ---------- his drawings on a board ----------

// The Excalidraw canvas sends describe() (scene JSON) and, for freehand strokes, a PNG. The JSON is
// kept on the learner turn; the PNG goes to data/teach/<id>-<n>.png and is attached as an image.
const DRAWING_JSON_LIMIT = 40000;
const DRAWING_PNG_LIMIT = 400 * 1024;
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function attachDrawing(s, t, d) {
  if (!d || typeof d !== 'object' || !d.scene || typeof d.scene !== 'object' || Array.isArray(d.scene)) return;
  let scene = d.scene;
  // His part: `learner` (shapes, text, strokes) and his arrows (in `arrows`, by: 'learner').
  const hisArrows = Array.isArray(scene.arrows) ? scene.arrows.filter((x) => x && x.by === 'learner') : [];
  if (!Array.isArray(scene.learner) || (!scene.learner.length && !hisArrows.length)) return;
  if (JSON.stringify(scene).length > DRAWING_JSON_LIMIT) {
    // Too big: keep his part, shorten the teacher's (it's the teacher's own board anyway).
    const brief = (x) => ({ id: x && x.id, kind: x && x.kind, label: x && x.label, x: x && x.x, y: x && x.y, w: x && x.w, h: x && x.h });
    scene = { ...scene, teacher: Array.isArray(scene.teacher) ? scene.teacher.map(brief) : [] };
    if (JSON.stringify(scene).length > DRAWING_JSON_LIMIT) scene = { ...scene, learner: scene.learner.slice(0, 60), note: 'drawing trimmed (too large)' };
    if (JSON.stringify(scene).length > DRAWING_JSON_LIMIT) return;
  }
  t.drawing = { scene };
  if (typeof d.png === 'string' && d.png.length < DRAWING_PNG_LIMIT * 1.4) {
    const buf = Buffer.from(d.png, 'base64');
    if (buf.length > 8 && buf.length <= DRAWING_PNG_LIMIT && buf.subarray(0, 8).equals(PNG_SIG)) {
      const name = `${s.id}-${s.turns.length}.png`;
      try { fs.mkdirSync(TEACH_DIR, { recursive: true }); fs.writeFileSync(path.join(TEACH_DIR, name), buf); t.drawing.png = name; }
      catch (e) { console.error('[teach] drawing png not saved:', e.message); }
    }
  }
}
// Image blocks for the stream-json user message (Anthropic message format), one per PNG.
function drawingImages(turns) {
  const out = [];
  for (const t of turns) {
    if (!t.drawing || !t.drawing.png) continue;
    try { out.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: fs.readFileSync(path.join(TEACH_DIR, t.drawing.png)).toString('base64') } }); }
    catch {}
  }
  return out;
}

// His materials as content blocks: every attachment when a process is primed (a fresh process gets
// them all again), else only those attached with the turns being sent now.
async function materialBlocks(list) {
  const out = [];
  if (!materials) return out;
  for (const a of list) {
    try { out.push(...await materials.blocksFor(a)); }
    catch (e) { console.error('[teach] material', a.id, e.message); out.push({ type: 'text', text: `<material title="${a.title}">(Couldn't load it: ${e.message})</material>` }); }
  }
  return out;
}
// Check refs from the browser ({id, pages, role}) and turn them into attachments.
function attachMaterials(s, refs, turn) {
  if (!Array.isArray(refs) || !refs.length) return [];
  if (!materials) throw Object.assign(new Error('materials module missing'), { status: 503 });
  if (refs.length > 4) throw Object.assign(new Error('Attach up to 4 materials at a time'), { status: 400 });
  const list = refs.map((r) => ({ ...materials.attachment(r), turn }));
  const total = (s.materials || []).concat(list).reduce((n, a) => n + a.count, 0);
  if (total > MAX_LESSON_PAGES) throw Object.assign(new Error(`That would make ${total} pages in this lesson: up to ${MAX_LESSON_PAGES}. Pick fewer pages.`), { status: 400 });
  s.materials = (s.materials || []).concat(list);
  for (const a of list) materials.markUsed(a);
  return list;
}
const materialBrief = (a) => ({ title: a.title, ...(a.range ? { pages: a.range } : {}), role: a.role });

// ---------- what Claude sees ----------

// The learner side of one turn, compact: only what the learner added (never the card echoed back).
function learnerObject(s, t) {
  const o = { kind: t.kind };
  if (t.kind === 'answer') {
    const card = teacherTurns(s).map((x) => x.card).find((c) => c && c.id === t.cardId) || {};
    o.card = card.kind;
    if (t.dontKnow) o.dontKnow = true;
    else if (typeof t.choice === 'number' && card.options) {
      const opt = card.options[t.choice];
      o.choice = typeof opt === 'string' ? opt : opt && opt.text;
      if (typeof card.correct === 'number') o.correct = t.choice === card.correct;
    } else if (typeof t.choiceText === 'string') o.choice = t.choiceText;
    if (card.kind === 'plan') { o.kind = 'plan'; if (t.approve) o.approve = true; }
    if (t.text) o.text = t.text;
    if (t.drawing) o.drawing = t.drawing.scene;
    if (typeof t.confidence === 'number') o.confidence = t.confidence;
    if (t.thinking) o.thinking = t.thinking;
    if (t.thinkingWhileReading) o.thinkingWhileReading = t.thinkingWhileReading;
    if (card.freeRecall && !t.dontKnow) o.committedAnswer = card.answer;   // grade against your own commitment
    if (card.kind === 'task') {
      if (t.done) o.done = true;
      if (t.dontKnow) { delete o.dontKnow; o.stuck = true; }
      if (t.check) o.checkResult = t.check;
      o.committedExpect = card.expect;
    }
  } else {
    o.text = t.text;
    if (t.board) o.board = true;
    if (t.live) o.live = true;
    if (t.about) o.about = t.about;
    if (t.drawing) o.drawing = t.drawing.scene;
    if (t.interrupted) o.interrupted = t.interrupted;
    if (t.materials) o.attached = t.materials;
  }
  return o;
}

// A teacher turn as Claude originally wrote it (answer keys included: Claude wrote them).
function teacherJson(t, full) {
  const o = {};
  if (t.say) o.say = full ? t.say : clip(t.say, 500);
  if (t.assessment) o.assessment = t.assessment;
  if (t.plan) o.plan = t.plan;
  if (t.grade) o.grade = t.grade;
  if (t.later) o.later = t.later;
  if (t.board) o.board = board.boardBrief(t.board);
  if (t.card) { const { id, ...card } = t.card; o.card = card; }
  return JSON.stringify(o);
}

// The opening context: goal, source material, and what the app already knows about him.
function buildContext(s) {
  const parts = [`<goal>${s.goal}</goal>`];
  const src = s.source || {};
  let subject = s.subject || src.subject || null;
  let topicName = src.topic || null;

  if (src.type === 'gap') {
    try {
      const g = ctx.gaps.listForClient().open.concat(ctx.gaps.listForClient().resolved).find((x) => x.id === src.gapId);
      if (g) {
        subject = subject || g.subject; topicName = topicName || g.topic;
        const a = g.analysis || {};
        const all = ctx.loadQuestions();
        const qs = [g.sourceId, ...(a.relatedIds || [])].map((id) => all.find((q) => q.id === id)).filter(Boolean);
        parts.push(`<gap>\nHe flagged this while answering "${g.sourceQuestion}" (his answer: ${JSON.stringify(g.answer || '')}).\n` +
          `His own words about what confused him: ${g.texts.map((x) => JSON.stringify(x.text)).join(' / ')}\n` +
          (a.concept ? `The missing concept (an earlier analysis): ${a.concept}\n` : '') + (a.why ? `Why it didn't land: ${a.why}\n` : '') +
          `</gap>`);
        if (qs.length) parts.push(`<related_quiz_questions>\n${qs.map((q) => `- [${q.id}] ${q.question}\n  Reference answer: ${clip(stripVisuals(q.answer).replace(/\n+/g, ' '), 600)}`).join('\n')}\n</related_quiz_questions>`);
        if (a.note && !src.title) { src.title = a.note.title; src.subject = subject; }
      }
    } catch (e) { console.error('[teach] gap context', e.message); }
  }
  if (src.type === 'topic' && topicName && subject) {
    try {
      const qs = ctx.loadQuestions().filter((q) => q.subject === subject && q.topic === topicName);
      const progress = ctx.loadProgress();
      if (qs.length) parts.push(`<topic_questions topic="${subject} / ${topicName}">\n${qs.slice(0, 30).map((q) => `- ${q.question} (box ${progress[q.id] ? progress[q.id].box : 'new'}/5)`).join('\n')}\n</topic_questions>`);
      if (!src.title && qs[0]) {
        const m = fs.readFileSync(path.join(LEARNING_DIR, qs[0].file), 'utf8').match(/Source note:\s*\[\[([^\]|#]+)/);
        if (m) src.title = m[1].trim();
      }
    } catch (e) { console.error('[teach] topic context', e.message); }
  }
  if (src.type === 'tolearn') {
    try { const block = require('./tolearn').contextFor(src.list, src.item); if (block) parts.push(block); } catch (e) { console.error('[teach] tolearn context', e.message); }
  }
  if (src.title) {
    const note = findNote(src.title, subject);
    if (note) {
      subject = subject || note.subject;
      parts.push(`<study_note title="${note.title}">\n${readNote(note)}\n</study_note>\nThis is his own study note on the subject: teach toward understanding it, and use its examples and analogies where they help.`);
    }
  }

  if (s.lab && s.lab.on) {
    const l = labOf(s);
    if (l) {
      parts.push(`<lab title="${l.title}" file="${l.id}">\nStep ids: ${l.steps.map((x) => x.id).join(', ')}.${l.steps.some((x) => x.check) ? ' Steps with a check command get it run when he presses Done; you see the result as checkResult.' : ''}\n\n${clip(l.raw, 30000)}\n</lab>`);
      subject = subject || l.subject;
    } else if (s.lab.task) {
      parts.push(`<lab_task>${s.lab.task}</lab_task>\nThis lesson is a hands-on lab built around that task: design the steps yourself.`);
    }
  }

  // What the quiz app already knows about him.
  try {
    const stats = ctx.computeStats();
    const topics = stats.topics.filter((t) => !subject || t.subject === subject);
    if (topics.length) parts.push(`<quiz_mastery subject="${subject || 'all'}">\n${topics.map((t) => `- ${t.subject} / ${t.topic}: mastery ${t.mastery}%, seen ${t.seen}/${t.total}, weak ${t.weak}`).join('\n')}\n</quiz_mastery>`);
  } catch {}
  try {
    const learner = require('./learner');
    if (learner && typeof learner.summaryFor === 'function') {
      const lines = [topicName && subject ? learner.summaryFor({ subject, topic: topicName }) : '', subject ? learner.summaryFor(subject) : '']
        .filter(Boolean).join('\n');
      if (lines.trim()) parts.push(`<learner_model>\nWhat the app has learned about him from past quiz answers:\n${lines}\n</learner_model>`);
    }
  } catch {}
  s.subject = subject;
  return `<context>\n${parts.join('\n\n')}\n</context>`;
}

// For a fresh process: the context plus a compact replay of everything so far.
function buildReplay(s, upTo) {
  const turns = s.turns.slice(0, upTo);
  if (!turns.length) return s.context;
  const lastTeacher = turns.map((t) => t.role).lastIndexOf('teacher');
  // Older turns are clipped (teacher prose AND the learner's free text, which can be 8000 chars each).
  const oldLearner = (o) => {
    for (const k of ['text', 'thinking', 'thinkingWhileReading', 'committedAnswer']) if (o[k]) o[k] = clip(o[k], 400);
    if (o.drawing) o.drawing = { title: o.drawing.title, learner: o.drawing.learner, arrows: (o.drawing.arrows || []).filter((x) => x.by === 'learner') };   // older drawings: only his part
    return o;
  };
  let lines = turns.map((t, i) => t.role === 'teacher'
    ? `TEACHER: ${teacherJson(t, i >= lastTeacher - 6)}`     // older prose clipped, recent turns in full
    : t.kind === 'terminal' ? `TERMINAL:\n${learnerLine(s, t, i >= lastTeacher - 2)}`
    : `LEARNER: ${JSON.stringify(i >= lastTeacher - 6 ? learnerObject(s, t) : oldLearner(learnerObject(s, t)))}`);
  // Hard cap for very long lessons: drop the oldest exchanges, but restate the current plan.
  let dropped = 0;
  while (lines.length > 12 && lines.reduce((n, l) => n + l.length, 0) > REPLAY_LIMIT) { lines.shift(); dropped++; }
  if (dropped) {
    const plan = currentPlan({ turns });
    lines = [`[… ${dropped} earlier exchanges omitted for length]`, ...(plan ? [`CURRENT PLAN: ${JSON.stringify(plan)}`] : []),
      ...(s.assessment ? [`ASSESSMENT: ${JSON.stringify(s.assessment)}`] : []), ...lines];
  }
  return `${s.context}\n\n<resume>\nThis lesson was interrupted and is continuing in a new conversation. Here is everything so far (your own earlier replies included, answer keys and all). Continue exactly where it left off, in the same phase.\n${lines.join('\n')}\n</resume>`;
}

// ---------- live board answers: the teacher talks and draws at once ----------
// The reply streams in as text deltas: `<title>…</title>`, sentences with `<draw>{op}</draw>` tags
// between them, then the usual ```json reply object. LiveRun parses that as it arrives, checks each op
// (board.liveBoard: repaired or dropped, never fatal) and fans events out to the browser over SSE:
//   say {seq, text}        a sentence to speak (seq 0, 1, …)
//   draw {op, afterSeq}    an op, written after sentence afterSeq (-1: before any); the browser fires it
//                          when sentence afterSeq + 1 starts (each tag sits right before the sentence about it)
//   title {text}           the board's title
//   done {board, turn}     the turn is stored (turn = index in s.turns); board = the assembled board
//   error {message}
// Every event carries t (ms since the request). The assembled board has the usual shape: one step per
// sentence that has ops before it (sentences without ops join the step before), so replays use the player.
const LIVE_KEEP_MS = 2 * 60 * 1000;
const lives = new Map();   // session id → LiveRun (the live answer in flight, kept a while after it ends)
const SENTENCE_MIN = 12;   // shorter "sentences" ("Now.") ride along with the next one

class LiveRun {
  constructor(id) {
    this.id = id;
    this.t0 = Date.now();
    this.events = [];
    this.subs = new Set();
    this.closed = false;
    this.mode = 'talk';      // 'talk' → 'json' once the reply object starts
    this.buf = '';           // unparsed talk
    this.sentence = '';      // the sentence being written
    this.seq = -1;
    this.items = [];         // [{say: text} | {op}] in order
    this.title = '';
    this.lb = board.liveBoard();
    this.dropped = 0;
    this.marks = {};
    lives.set(id, this);
  }
  mark(k) { if (this.marks[k] === undefined) this.marks[k] = Date.now() - this.t0; }
  emit(type, data) {
    if (this.closed) return;
    const ev = { id: this.events.length + 1, type, data: { ...data, t: Date.now() - this.t0 } };
    this.events.push(ev);
    for (const f of this.subs) f(ev);
  }
  // The end of the stream: a done/error event, then subscribers are let go.
  close(type, data) {
    if (this.closed) return;
    this.emit(type, data);
    this.closed = true;
    for (const f of this.subs) f(null);
    this.subs.clear();
    setTimeout(() => { if (lives.get(this.id) === this) lives.delete(this.id); }, LIVE_KEEP_MS).unref();
  }

  feed(delta) {
    this.mark('firstText');
    if (this.mode !== 'talk') return;
    this.buf += delta;
    this.scan(false);
  }
  // The model finished (or stopped) talking: flush what's left of the talk.
  end() { if (this.mode === 'talk') this.scan(true); this.mode = 'json'; this.flush(); this.mark('talkEnd'); }

  scan(final) {
    for (;;) {
      const b = this.buf;
      // It ignored live mode and wrote only the JSON object: nothing to say.
      if (this.seq < 0 && !this.sentence && /^\s*[{`]/.test(b) && !/^\s*`?$/.test(b)) { this.mode = 'json'; this.buf = ''; return; }
      const m = b.match(/<(draw|title)>|```|\n[ \t]*\{/);
      if (!m) {
        // Hold back what could still become a tag, a fence or the JSON's first line.
        let keep = 0;
        if (!final) {
          const lt = b.lastIndexOf('<');
          if (lt >= 0 && /^<\/?[a-z]*$/.test(b.slice(lt))) keep = b.length - lt;
          const bt = b.match(/(`{1,2}|\n[ \t]*)$/);
          if (bt) keep = Math.max(keep, bt[0].length);
        }
        this.talk(b.slice(0, b.length - keep));
        this.buf = b.slice(b.length - keep);
        return;
      }
      this.talk(b.slice(0, m.index));
      if (m[1]) {
        const close = b.indexOf(`</${m[1]}>`, m.index);
        if (close < 0) { this.buf = b.slice(m.index); if (final) this.buf = ''; return; }
        const inner = b.slice(m.index + m[0].length, close).trim();
        this.buf = b.slice(close + m[1].length + 3);
        if (m[1] === 'title') { this.title = inner.replace(/[*_`#]/g, '').slice(0, 80) || 'Board'; this.emit('title', { text: this.title }); if (this.onTitle) this.onTitle(); }
        else { this.flush(); this.draw(inner); }
        continue;
      }
      this.flush();            // ``` or a `{` line: the reply object begins
      this.mode = 'json';
      this.buf = '';
      return;
    }
  }
  // Talk text: emit each finished sentence (ends in . ! or ? followed by a space; not "...").
  talk(text) {
    if (!text) return;
    this.sentence += text;
    for (;;) {
      const s = this.sentence;
      let cut = -1;
      for (let i = SENTENCE_MIN; i < s.length - 1; i++) {
        if (!'.!?'.includes(s[i]) || !/\s/.test(s[i + 1])) continue;
        if (s[i] === '.' && (s[i - 1] === '.' || /(^|[\s(])(e\.g|i\.e|etc|vs|[A-Za-z])$/i.test(s.slice(Math.max(0, i - 5), i)))) continue;   // "...", "e.g.", "x."
        cut = i + 1; break;
      }
      if (cut < 0) return;
      this.say(s.slice(0, cut));
      this.sentence = s.slice(cut);
    }
  }
  flush() { const s = this.sentence; this.sentence = ''; this.say(s); }
  say(raw) {
    const text = String(raw).replace(/\[[a-z ]{2,30}\]/gi, ' ').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
    if (!/[a-z0-9]/i.test(text)) return;
    this.seq++;
    this.items.push({ say: text });
    this.mark('firstSay');
    this.emit('say', { seq: this.seq, text });
  }
  draw(json) {
    let raw;
    try { raw = JSON.parse(json); } catch { this.dropped++; console.error('[teach] live: a draw tag is not JSON:', clip(json, 120)); return; }
    const { op, problems } = this.lb.add(raw);
    if (problems.length) console.error(`[teach] live op ${op ? 'repaired' : 'dropped'}:`, problems.join(' | '));
    if (!op) { this.dropped++; return; }
    this.items.push({ op });
    this.mark('firstDraw');
    this.emit('draw', { op, afterSeq: this.seq });
  }

  // The board as the player stores it: a step starts at each sentence that has ops before it.
  board() {
    const steps = [];
    let ops = [];
    for (const it of this.items) {
      if (it.op) { ops.push(it.op); continue; }
      const last = steps[steps.length - 1];
      if (!last || ops.length || (last.say + ' ' + it.say).length > 400) steps.push({ say: it.say, draw: ops });
      else last.say += ' ' + it.say;
      ops = [];
    }
    if (ops.length) { if (steps.length) steps[steps.length - 1].draw.push(...ops); else steps.push({ say: this.title || 'The board.', draw: ops }); }
    // At most 12 steps: join the pair with the shortest narration (ops stay in order).
    while (steps.length > 12) {
      let best = 1;
      for (let i = 2; i < steps.length; i++) if (steps[i - 1].say.length + steps[i].say.length < steps[best - 1].say.length + steps[best].say.length) best = i;
      const [a, b] = [steps[best - 1], steps[best]];
      steps.splice(best - 1, 2, { say: `${a.say} ${b.say}`.slice(0, 400), draw: [...a.draw, ...b.draw] });
    }
    if (!steps.some((s) => s.draw.length)) return null;
    const r = board.validateBoard({ title: this.title || 'On the board', steps }, { strict: false });
    return r.board || null;
  }
  timing() {
    return { ...this.marks, says: this.seq + 1, draws: this.items.filter((x) => x.op).length, dropped: this.dropped, chars: this.items.reduce((n, x) => n + (x.say ? x.say.length + 1 : 0), 0) };
  }
}

// GET /api/teach/<id>/live: the live answer's events (text/event-stream). Events already sent are
// replayed first (the browser may connect a moment after the turn started); Last-Event-ID skips them.
function liveStream(req, res, s) {
  const run = lives.get(s.id);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const write = (ev) => res.write(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
  res.write('retry: 2000\n\n');
  if (!run) { res.write('event: none\ndata: {}\n\n'); res.end(); return; }
  const last = Number(req.headers['last-event-id']) || 0;
  for (const ev of run.events) if (ev.id > last) write(ev);
  if (run.closed) { res.end(); return; }
  const sub = (ev) => { if (ev) write(ev); else { clearInterval(hb); res.end(); } };
  const hb = setInterval(() => res.write(': hb\n\n'), 15000);
  run.subs.add(sub);
  req.on('close', () => { clearInterval(hb); run.subs.delete(sub); });
}

// ---------- running a teacher turn ----------

const jobs = new Map();   // session id → promise of the turn in flight
const autoJobs = new Map();   // session id → promise of an auto-prepared save preview (see maybeAutoSave)

function startJob(s, kind, fn, extra) {
  if (s.pending || jobs.has(s.id)) throw Object.assign(new Error('The teacher is still working on the last turn'), { status: 409 });
  s.pending = { kind, since: nowIso(), ...(extra || {}) };
  s.error = null;
  try { saveSession(s); } catch (e) { s.pending = null; throw e; }   // don't leave the session stuck "busy"
  const job = (async () => {
    try { await fn(); }
    catch (e) {
      console.error(`[teach] ${kind} failed:`, e.message);
      s.error = { kind, message: e.message };
      closeProc(s.id);   // a fresh process + replay is the cleanest way to retry
    } finally {
      s.pending = null;
      jobs.delete(s.id);
      // Nobody awaits this promise: a throw here would be an unhandled rejection and crash the server.
      try { saveSession(s); } catch (e) { console.error('[teach] save failed:', e.message); }
      // A turn that ended the lesson: prepare the vault save in the background (never blocks this turn).
      if (kind === 'turn' && !s.error) setImmediate(() => { try { maybeAutoSave(s); } catch (e) { console.error('[teach] auto save:', e.message); } });
    }
  })();
  jobs.set(s.id, job);
  return job;
}

// Send everything the learner added since the teacher's last turn, validate the reply, retry once
// with the errors, then append the teacher turn.
// A turn answering a live board request (see LiveRun): set up the stream, run the turn, then tell the
// browser how it ended. Every other turn is a plain startJob.
function turnJob(s) {
  const lastTeacher = s.turns.map((t) => t.role).lastIndexOf('teacher');
  const fresh = s.turns.slice(lastTeacher + 1);
  const live = fresh.some((t) => t.kind === 'message' && t.live);
  // teacher.boards = 'auto': the teacher may answer a question on the live board by itself. The turn
  // streams through a LiveRun either way; the browser is only told it's live (pending.live) once the
  // reply opens with a <title>, so a plain answer looks exactly like any other turn.
  const auto = !live && fresh.some((t) => t.kind === 'message' && t.autoBoard && !t.board);
  if (!live && !auto) return startJob(s, 'turn', () => teacherTurn(s));
  const old = lives.get(s.id);
  if (old) old.close('error', { message: 'replaced by a newer answer' });
  const run = new LiveRun(s.id);
  if (auto) {
    run.auto = true;
    run.onTitle = () => {
      if (!s.pending || s.pending.live) return;
      s.pending.live = true;
      try { saveSession(s); } catch {}
    };
  }
  const job = startJob(s, 'turn', () => teacherTurn(s, run), live ? { live: true } : undefined);
  job.then(() => {
    if (s.error) return run.close('error', { message: s.error.message });
    if (run.auto && !run.title) return run.close('done', { turn: s.turns.length - 1, board: null, fallback: true });
    const ti = s.turns.length - 1, t = s.turns[ti];
    run.close('done', { turn: ti, board: (t && t.board) || null, fallback: !(t && t.live) });
  });
  return job;
}

async function teacherTurn(s, live = null) {
  const p = procFor(s);
  // Every lesson gets the lab terminal when its machine answers: the teacher decides when a hands-on task fits.
  if (lab && !(s.lab && s.lab.on) && !(s.lab && s.lab.on === false && !s.lab.auto)) {   // not after he turned it off
    try { const st = await lab.status(); if (st.ok) s.lab = { ...(s.lab || {}), on: true, auto: true, seen: (s.lab && s.lab.seen) || 0 }; } catch {}
  }
  if (lab && s.lab && s.lab.on) await syncLab(s);
  const lastTeacher = s.turns.map((t) => t.role).lastIndexOf('teacher');
  const fresh = s.turns.slice(lastTeacher + 1);
  let prompt = fresh.map((t) => learnerLine(s, t, true)).join('\n');
  let mats;
  if (!p.primed) {
    prompt = (lastTeacher < 0 ? s.context : buildReplay(s, lastTeacher + 1)) + (prompt ? '\n\n' + prompt : '');
    if (lastTeacher < 0) prompt += '\n\nBegin the probe. One card.';
    mats = await materialBlocks(s.materials || []);
    p.primed = true;
  } else {
    const firstFresh = lastTeacher + 1;
    mats = await materialBlocks((s.materials || []).filter((a) => a.turn >= firstFresh));
  }
  // His teaching preferences, when they differ from what this process was last told.
  const pl = prefsLine();
  if (pl !== p.prefsLine) {
    prompt += pl ? `\n\n(His preferences for how you teach, from now on until told otherwise. They adjust your instructions, they don't replace them: ${pl})`
      : '\n\n(His teaching preferences are back to the defaults: follow your instructions as written.)';
    p.prefsLine = pl;
  }
  // Rules for this reply that depend on what the learner just did.
  const answered = fresh.filter((t) => t.kind === 'answer').pop();
  const answeredCard = answered && teacherTurns(s).map((t) => t.card).find((c) => c && c.id === answered.cardId);
  const needGrade = !!(answeredCard && (answeredCard.freeRecall || answeredCard.kind === 'task') && !answered.dontKnow);
  // A free question while a card is still open (or after the lesson is done) may be answered in prose only.
  const allowNoCard = !!openCard(s) || phaseOf(s) === 'done';
  const needTeach = !!(answeredCard && answeredCard.kind === 'predict');
  const needBoard = !live && fresh.some((t) => t.kind === 'message' && t.board);
  if (needBoard) prompt += '\n\n(He asked for a board explanation: include "board".)';
  if (live && !live.auto) prompt += '\n\n(He asked for a LIVE board: first the talk with <title> and <draw> tags, as the live-board rules say, then the ```json reply object, without "board".)';
  if (live && live.auto) prompt += '\n\n(If a picture clearly helps with his question, such as how a mechanism works, how data moves, or what a structure looks like, you may answer it as a LIVE board on your own: first the talk with <title> and <draw> tags, as the live-board rules say, then the ```json reply object, without "board". Otherwise answer as usual, with the JSON object only.)';
  if (needGrade) prompt += `\n\n(Include "grade" for his ${answeredCard.kind === 'task' ? 'task' : 'free-recall answer'}.)`;

  // His freehand drawings, as images next to the text (the JSON only says where the strokes are).
  const images = drawingImages(fresh);
  if (images.length) prompt += `\n\n(${images.length === 1 ? 'An image of the board with his drawing is' : 'Images of the boards with his drawings are'} attached.)`;
  if (mats.length) prompt = `(His materials are attached above this message.)\n\n${prompt}`;
  const content = images.length || mats.length ? [...mats, { type: 'text', text: prompt }, ...images] : prompt;

  const t0 = Date.now();
  let raw = await p.ask(content, live ? { onText: (d) => live.feed(d) } : {});
  // Live: the talk was streamed to the browser; what's left to check is the JSON object after it.
  let liveObj = null;
  if (live) {
    live.end();
    raw = raw.replace(/<draw>[\s\S]*?<\/draw>|<title>[\s\S]*?<\/title>/g, '');
    try { liveObj = extractJson(raw); } catch {}
  }
  let { reply, errors } = validateReply(s, raw, { needGrade, allowNoCard, needTeach, needBoard });
  if (errors) {
    console.error('[teach] invalid reply, asking for a fix:', errors.join(' | '));
    raw = await p.ask(`<invalid>\n${errors.map((e) => `- ${e}`).join('\n')}\n</invalid>\nSend the whole corrected JSON object again.`);
    ({ reply, errors } = validateReply(s, raw, { needGrade, allowNoCard, needTeach, needBoard, boardStrict: false }));
    if (errors) throw new Error(`The teacher's reply was invalid twice: ${errors.join('; ')}`);
  }
  const n = teacherTurns(s).length + 1;
  const turn = { role: 'teacher', ts: nowIso(), ms: Date.now() - t0, model: p.label, say: reply.say };
  if (reply.assessment) turn.assessment = reply.assessment;
  if (reply.plan) turn.plan = reply.plan;
  if (reply.board) {
    turn.board = reply.board;
    // Narration audio in the background (free local voice, when installed), so Play starts instantly. Never blocks the turn.
    try { require('./voice').pregenerate(turn.board); } catch {}
  }
  if (reply.boardFailed) turn.boardFailed = true;
  if (live && live.auto && !live.title) {
    // 'auto' and it answered in text: an ordinary turn, nothing about boards.
  } else if (live) {
    const b = live.board();
    if (b) { turn.board = b; turn.live = { ...live.timing(), totalMs: Date.now() - t0 }; }
    else {
      // No talk with drawings: use a whole board if it sent one anyway, else the answer stays in text.
      const v = liveObj && liveObj.board ? board.validateBoard(liveObj.board, { strict: false }) : null;
      if (v && v.board) turn.board = v.board; else turn.boardFailed = true;
    }
    console.error('[teach] live board:', JSON.stringify(turn.live || { fallback: !!turn.board }));
  }
  if (reply.later) turn.later = reply.later;
  if (reply.grade) {
    turn.grade = reply.grade;
    if (answered) answered.grade = reply.grade;
  }
  if (reply.card) {
    turn.card = { id: `c${n}`, ...reply.card };
    shuffleOptions(turn.card);
    if (turn.card.setup) await deploySetup(s, turn.card.setup);
  }
  turn.phase = phaseAt([...s.turns, turn]);
  s.turns.push(turn);
  if (reply.assessment) s.assessment = reply.assessment;
}

// ---------- the browser's view of a session (answer keys stripped until answered) ----------

function clientCard(s, card) {
  if (!card) return null;
  const ans = answerFor(s, card.id);
  const base = { id: card.id, kind: card.kind };
  for (const k of ['question', 'nodeId', 'strand', 'goal', 'summary', 'nodes', 'edges', 'nextSteps', 'freeRecall', 'hint', 'ask', 'stepId']) if (card[k] !== undefined) base[k] = card[k];
  if (Array.isArray(card.options)) base.options = card.options.map((o) => (typeof o === 'string' ? o : o.text));
  if (card.setup) base.setup = { dir: card.setup.dir, ok: !!card.setup.ok, error: card.setup.error || null, files: card.setup.files.map((f) => ({ path: f.path, executable: f.executable, content: f.content })) };
  if (!ans) return base;
  base.answer = {
    choice: ans.choice, choiceText: ans.choiceText, text: ans.text, dontKnow: !!ans.dontKnow, approve: !!ans.approve,
    confidence: ans.confidence, thinking: ans.thinking, thinkingWhileReading: ans.thinkingWhileReading, ts: ans.ts, drawing: !!ans.drawing,
  };
  if (card.kind === 'task') {
    base.answer.done = !!ans.done;
    base.result = { committed: card.expect, grade: ans.grade || null, correct: ans.grade ? ans.grade.correct : null, check: ans.check || null };
  }
  if (card.kind === 'probe' || card.kind === 'check') {
    base.result = card.freeRecall
      ? { committed: card.answer, grade: ans.grade || null, correct: ans.grade ? ans.grade.correct : null }
      : { correctIndex: card.correct, correct: !ans.dontKnow && ans.choice === card.correct, explanation: card.explanation, misconceptions: card.options.map((o) => o.misconception) };
  }
  return base;
}

function viewOf(s) {
  const plan = currentPlan(s);
  const items = [];
  let current = null;
  const visited = [];
  for (const [ti, t] of s.turns.entries()) {
    if (t.role === 'teacher') {
      if (t.card && t.card.nodeId) { current = t.card.nodeId; if (!visited.includes(current)) visited.push(current); }
      items.push({ type: 'teacher', ts: t.ts, ms: t.ms, phase: t.phase, say: t.say, card: clientCard(s, t.card), assessment: t.assessment || null, planUpdated: !!t.plan,
        turn: ti, board: t.board || null, boardFailed: !!t.boardFailed, later: t.later || null });
    } else if (t.kind === 'message' || t.kind === 'planChange') {
      items.push({ type: t.kind, ts: t.ts, text: t.text, board: !!t.board, drawing: !!t.drawing, materials: t.materials || null });
    } else if (t.kind === 'terminal') {
      const cmds = termCmds(s, t);
      if (cmds.length) items.push({ type: 'terminal', ts: t.ts, cmds: cmds.map((c) => ({ id: c.id, cmd: c.cmd, exit: c.exit })) });
    } else if (t.kind === 'answer') {
      // The answer itself shows inside its card. When something came between that card and now
      // (e.g. the learner asked a question first), mark the spot so the reply that follows isn't
      // read as part of the teacher's previous message.
      const last = [...items].reverse().find((x) => x.type !== 'terminal');
      if (!(last && last.type === 'teacher' && last.card && last.card.id === t.cardId)) {
        const owner = s.turns.find((x) => x.role === 'teacher' && x.card && x.card.id === t.cardId);
        const opt = owner && Array.isArray(owner.card.options) && t.choice != null ? owner.card.options[t.choice] : null;
        const said = t.dontKnow ? 'I don’t know' : opt ? (typeof opt === 'string' ? opt : opt.text) : (t.text || '');
        items.push({ type: 'answer', ts: t.ts, cardId: t.cardId, text: clip(String(said || ''), 160), drawing: !!t.drawing });
      }
    }
  }
  const open = openCard(s);
  let labView = null;
  if (s.lab && s.lab.on) {
    const l = labOf(s);
    const done = stepsDone(s);
    labView = {
      on: true, auto: !!s.lab.auto, file: s.lab.file || null, task: s.lab.task || null, title: l ? l.title : null,
      steps: l ? l.steps.map((x) => ({ id: x.id, title: x.title, done: done.has(x.id) })) : null,
      seen: s.lab.seen || 0,   // commands up to this id were already shown to the teacher
      dir: lessonDir(s),       // the lesson's folder id (lab.lessonPath puts it under the lessons folder; the terminal starts there)
    };
  }
  return {
    id: s.id, goal: s.goal, subject: s.subject, source: s.source ? { type: s.source.type, title: s.source.title || null, topic: s.source.topic || null } : null,
    lab: labView,
    materials: (s.materials || []).map((a) => ({ id: a.id, title: a.title, kind: a.kind, range: a.range, role: a.role, first: a.pages[0] ?? null, count: a.count, turn: a.turn })),
    created: s.created, updated: s.updated, status: s.status,
    phase: phaseOf(s), plan, current, visited, assessment: s.assessment || null,
    openCardId: open ? open.id : null,
    pending: s.pending, error: s.error, items,
    savePreview: s.savePreview ? publicPreview(s.savePreview) : null, saved: s.saved || [], autoSave: autoSaveView(s),
    captures: capturesOf(s),
  };
}

// ---------- saved to To Learn (tolearn.js capture) ----------
// s.captures: [{ turn, quote, later, title, itemId, listId, ts }]. quote = the text he selected (the UI
// underlines it in that turn); later = the title of a teacher "later" chip he saved.
function addCapture(id, c) {
  const s = loadSession(id);
  if (!s) return [];
  s.captures = [...(s.captures || []), c];
  saveSession(s);
  return capturesOf(s);
}
// Only captures whose To Learn item still exists (he may have deleted it there).
function capturesOf(s) {
  if (!s.captures || !s.captures.length) return [];
  let have = null;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tolearn.json'), 'utf8'));
    have = new Set(d.lists.flatMap((l) => l.items.map((x) => `${l.id}/${x.id}`)));
  } catch {}
  return s.captures.filter((c) => !have || have.has(`${c.listId}/${c.itemId}`))
    .map((c) => ({ turn: c.turn, quote: c.quote || null, later: c.later || null, title: c.title, itemId: c.itemId, listId: c.listId }));
}

// ---------- save to vault ----------

// The same rules as server.js parseFile, plus the format checks the question-writer agent follows.
function parseQuestionText(text) {
  const body = text.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  const out = [];
  for (const chunk of body.split(/^## /m).slice(1)) {
    const lines = chunk.split('\n');
    const idMatch = chunk.match(/%%\s*id:\s*([\w-]+)\s*%%/);
    const answer = [];
    let inAnswer = false, ended = false, trailing = false;
    for (const line of lines.slice(1)) {
      if (/^>\s*\[!answer\]/i.test(line)) { inAnswer = true; continue; }
      if (inAnswer && !ended) {
        if (!line.startsWith('>')) { ended = true; if (line.trim()) trailing = true; continue; }
        answer.push(line.replace(/^> ?/, ''));
      } else if (ended && line.trim()) trailing = true;
    }
    out.push({ question: lines[0].trim(), id: idMatch ? idMatch[1] : null, answer: answer.join('\n').trim(), trailing });
  }
  return out;
}

// allowNoSource: a questions-only save may have no study note to point to (the graders then work
// without one: ai-grader/gaps/mcq all treat a missing "Source note" as "no note").
function questionProblems(text, noteTitle, { allowNoSource = false } = {}) {
  const probs = [];
  if (!/^---\n[\s\S]*?\n---\n/.test(text)) probs.push('the question file must start with YAML frontmatter (subject, topic, tags)');
  if (!/Source note:\s*\[\[/.test(text)) { if (!allowNoSource) probs.push('missing the "Source note: [[...]]" line'); }
  else if (noteTitle && !text.includes(`[[${noteTitle}`)) probs.push(`"Source note" should link [[${noteTitle}]]`);
  const qs = parseQuestionText(text);
  if (!qs.length) probs.push('no "## " questions found');
  qs.forEach((q, i) => {
    const where = `question ${i + 1} ("${clip(q.question, 50)}")`;
    if (!q.id) probs.push(`${where} has no %% id: … %% line`);
    if (!q.answer) probs.push(`${where} has no "> [!answer]-" callout (or it's empty)`);
    if (q.trailing) probs.push(`${where}: text after the answer callout would be lost (every answer line must start with ">")`);
    if (/^\s*\|.*\|\s*$/m.test(q.answer)) probs.push(`${where}: no tables inside answers`);
    if (/^#{1,6} /m.test(q.answer)) probs.push(`${where}: no headings inside answers`);
    // LaTeX outside code (Bash answers legitimately contain `$1`, `$HOME`…)
    const prose = q.answer.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    if (/\$\$|\\\(|\\\[|\$[^$\n]*(\\[a-zA-Z]+|\^|_\{)[^$\n]*\$/.test(prose)) probs.push(`${where}: no LaTeX inside answers`);
  });
  return probs;
}

// Rewrite every %% id %% to <prefix>-001, -002, … in order (these are brand-new questions, so
// renumbering is safe), picking a prefix no existing question uses.
// Works per "## " question (the same split as server.js parseFile): every question gets exactly one
// id line right under its heading, so a question the model left without an id can't fall back to a
// slug id, and a stray or duplicate %% id %% can't shadow the real one.
function assignIds(text, wanted, existingIds) {
  const taken = new Set(existingIds.map((id) => String(id).toLowerCase()));
  const used = new Set([...taken].map((id) => id.replace(/-\d+$/, '')));
  let base = String(wanted || 'tm').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'tm';
  let prefix = base, n = 2;
  const clash = (p) => used.has(p) || [...taken].some((id) => id.startsWith(`${p}-`));
  while (clash(prefix)) prefix = `${base}${n++}`;
  const src = String(text || '').replace(/\r\n/g, '\n');
  const fm = (src.match(/^---\n[\s\S]*?\n---\n/) || [''])[0];
  const parts = src.slice(fm.length).split(/^## /m);
  let i = 0;
  const qs = parts.slice(1).map((chunk) => {
    const lines = chunk.split('\n').filter((l, k) => k === 0 || !/^\s*%%\s*id:.*%%\s*$/.test(l));
    lines.splice(1, 0, `%% id: ${prefix}-${String(++i).padStart(3, '0')} %%`);
    return lines.join('\n');
  });
  const out = fm + [parts[0], ...qs].join('## ');
  return { text: out, prefix, count: i };
}

// Every question id the app has ever seen: in the vault now, plus ids that only survive in
// progress/history (a deleted question's id must never be reused: it keys his history).
function allKnownIds() {
  const ids = new Set(ctx.loadQuestions().map((q) => q.id));
  try { for (const id of Object.keys(ctx.loadProgress() || {})) ids.add(id); } catch {}
  try { for (const h of ctx.loadHistory() || []) if (h && h.id) ids.add(h.id); } catch {}
  return [...ids];
}

// The entry of `dir` equal to `name` ignoring case (its real spelling), else `name` itself.
function sameCaseName(dir, name) {
  const lower = name.toLowerCase();
  try { return fs.readdirSync(dir).find((f) => f.toLowerCase() === lower) || name; } catch { return name; }
}

// Where a preview would be written, refusing anything that escapes the vault or the subject folder.
function vaultPaths(pv, root = LEARNING_DIR) {
  const names = [pv.subject, pv.noteTitle, pv.topic];
  if (names.some((n) => !n || n !== safeName(n))) throw Object.assign(new Error('unsafe subject, title or topic'), { status: 400 });
  // Reuse an existing subject folder whatever its case (macOS is case-insensitive; "bash" must land in Bash/).
  const subject = subjectDirs(root).find((d) => d.toLowerCase() === pv.subject.toLowerCase()) || pv.subject;
  const subjectDir = path.join(root, subject);
  // Same for the note and question file: on Linux (case-sensitive) "cpu caches.md" next to "CPU Caches.md"
  // would be a second note; on the Mac existsSync already matched it. Reuse the existing file's case.
  const notePath = path.join(subjectDir, sameCaseName(subjectDir, `${pv.noteTitle}.md`));
  const qPath = path.join(subjectDir, 'Questions', sameCaseName(path.join(subjectDir, 'Questions'), `${pv.topic}.md`));
  const inside = (f, dir) => path.resolve(f).startsWith(path.resolve(dir) + path.sep);
  if (!inside(subjectDir, root) || !inside(notePath, subjectDir) || !inside(qPath, path.join(subjectDir, 'Questions'))) {
    throw Object.assign(new Error('refusing to write outside the Learning folder'), { status: 400 });
  }
  return { subject, subjectDir, notePath, qPath };
}

// Atomic create-only write: the tmp file is linked into place, which fails if the target exists.
function createFile(file, content) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content);
  try { fs.linkSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}

// Write a confirmed preview under `root` (the real Learning folder, or a temp dir in tests).
// Never overwrites: an existing note is skipped; an existing question file gets the new
// questions appended (they already carry a prefix no other question uses).
function writeToVault(preview, root = LEARNING_DIR) {
  const result = { written: [], skipped: [], appended: [] };
  const { subjectDir, notePath, qPath } = vaultPaths(preview, root);
  const qStart = preview.questions ? preview.questions.search(/^## /m) : -1;
  if (preview.questions && qStart < 0) throw Object.assign(new Error('the question file has no "## " questions'), { status: 400 });
  fs.mkdirSync(path.join(subjectDir, 'Questions'), { recursive: true });
  const exists = (f, why) => { result.skipped.push({ file: path.relative(root, f), reason: why }); };
  if (preview.note) {
    if (fs.existsSync(notePath)) exists(notePath, 'a note with this title already exists');
    else {
      try { createFile(notePath, preview.note.endsWith('\n') ? preview.note : preview.note + '\n'); result.written.push(path.relative(root, notePath)); }
      catch (e) { if (e.code === 'EEXIST') exists(notePath, 'a note with this title already exists'); else throw e; }
    }
  }
  if (preview.questions) {
    if (fs.existsSync(qPath)) {
      // Append = rewrite existing + new via tmp + rename, so a crash can't leave a half-written file.
      const chunks = preview.questions.slice(qStart).trim();
      const existing = fs.readFileSync(qPath, 'utf8');
      const tmp = path.join(path.dirname(qPath), `.${path.basename(qPath)}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, existing + (existing.endsWith('\n') ? '\n' : '\n\n') + chunks + '\n');
      fs.renameSync(tmp, qPath);
      result.appended.push(path.relative(root, qPath));
    } else {
      createFile(qPath, preview.questions.endsWith('\n') ? preview.questions : preview.questions + '\n');
      result.written.push(path.relative(root, qPath));
    }
  }
  return result;
}

// Where the learner struggled: wrong answers (confident ones first), "I don't know"s, and his thinking.
function struggles(s) {
  const out = [];
  for (const t of s.turns) {
    if (t.role !== 'learner' || t.kind !== 'answer') continue;
    const card = teacherTurns(s).map((x) => x.card).find((c) => c && c.id === t.cardId);
    if (!card || (card.kind !== 'probe' && card.kind !== 'check' && card.kind !== 'task')) continue;
    const wrong = t.dontKnow || (card.freeRecall || card.kind === 'task' ? t.grade && !t.grade.correct : t.choice !== card.correct);
    const fragile = !wrong && typeof t.confidence === 'number' && t.confidence <= 50;
    if (!wrong && !fragile) continue;
    const pick = typeof t.choice === 'number' && card.options ? card.options[t.choice] : null;
    out.push(`- ${card.kind === 'task' ? (t.dontKnow ? 'stuck on a lab task' : 'lab task not done right') : wrong ? (typeof t.confidence === 'number' && t.confidence >= 70 ? 'WRONG and confident' : t.dontKnow ? "didn't know" : 'wrong') : 'right but unsure'}: "${clip(card.question, 300)}"` +
      (card.kind === 'task' && t.grade && t.grade.missed ? ` → missed: ${clip(t.grade.missed, 200)}` : '') +
      (pick ? ` → picked "${pick.text}"${pick.misconception ? ` (${pick.misconception})` : ''}` : '') +
      (t.text ? ` → wrote "${clip(t.text, 200)}"` : '') + (t.thinking ? ` · thinking: "${clip(t.thinking, 200)}"` : ''));
  }
  return out;
}

// Was the lesson hands-on? Lab tasks or commands he ran in the lesson's terminal.
function handsOn(s) {
  const tasks = teacherTurns(s).filter((t) => t.card && t.card.kind === 'task').length;
  let cmds = [];
  try { cmds = lab ? lab.commands(s.id) : []; } catch {}
  return { tasks, cmds };
}

async function savePreviewTurn(s, { auto = false } = {}) {
  const p = procFor(s);
  let prefix = '', mats = [];
  if (!p.primed) { prefix = buildReplay(s, s.turns.length) + '\n\n'; mats = await materialBlocks(s.materials || []); p.primed = true; }
  const all = ctx.loadQuestions();
  const subjects = subjectDirs();
  const subject = s.subject && subjects.includes(s.subject) ? s.subject : null;
  const notes = listNotes().filter((n) => !subject || n.subject === subject).map((n) => n.title);
  const qFiles = [...new Set(all.filter((q) => !subject || q.subject === subject).map((q) => q.topic))];
  const knownIds = allKnownIds();
  const prefixes = [...new Set(knownIds.map((id) => id.replace(/-\d+$/, '')))];
  const sample = s.source && s.source.title ? findNote(s.source.title, subject) : null;
  const sampleHead = sample ? fs.readFileSync(sample.file, 'utf8').split('\n').slice(0, 30).join('\n') : '';
  const hard = struggles(s);
  const ho = handsOn(s);
  const practical = ho.tasks > 0 || ho.cmds.length > 0;
  const ran = [...new Set(ho.cmds.map((c) => String(c.cmd || '').trim()).filter(Boolean))].slice(-40);
  const cheat = `a PRACTICAL CHEAT SHEET, still in his note style (frontmatter, "# <emoji> <Title>", the TL;DR callout): the commands / keys / flags used, grouped by purpose ("## 1. Moving around 🧭", "## 2. Deleting ✂️", …), each with what it does in a few words (tables are fine here); small examples taken from what he actually did in this lesson; his mistakes and the fix ("> [!warning]" callouts); and a short "why it works" part where it helps him remember (how the pieces combine, what the tool is doing underneath)`;
  // Fast (AI-era) teacher: questions test understanding and judging AI output, never recall of syntax.
  const practicalQs = teacherMode() === 'fast'
    ? 'Practical lesson: he works with AI, which writes the commands for him. Never ask him to recall a command, flag, key or syntax. Ask: what a given snippet or command does and why; reading a short script "an AI wrote" and spotting what is wrong or dangerous; what he would ask an AI for in a situation and what he would check in its answer; and why-questions (why it works, why his mistake failed).'
    : 'Practical lesson: ask for recall of commands IN CONTEXT ("In vim, how do you delete from the cursor to the end of the word?", "Which flag makes grep print line numbers?"), predicting what a command does to a given input, and why-questions (why it works, why his mistake failed). Everything asked was taught by now, so recall is the point; never a bare "guess the key" with no context.';

  const prompt = `${prefix}<save_request>
The lesson is ${phaseOf(s) === 'done' ? 'finished' : 'paused'}. Turn it into two files for his Obsidian vault. This is a side task: no JSON, no card.

1. A study note in the style of his vault${sampleHead ? ' (the start of one of his notes is below)' : ''}${practical ? `. This lesson was hands-on (${ho.tasks ? `${ho.tasks} lab task${ho.tasks === 1 ? '' : 's'}, ` : ''}${ho.cmds.length} command${ho.cmds.length === 1 ? '' : 's'} in the terminal). If using the tool, its commands or keys was the point of the lesson (a CLI, an editor, a debugger…), make it ${cheat}. If the hands-on part only illustrated a concept, keep the usual shape and end with a short "## 🛠 Commands you used" section (each command, what it showed him, his mistakes and the fix). The usual shape` : ''}: YAML frontmatter (subject, topic, tags ending in "notes"), "# <emoji> <Title>", a "> [!abstract] TL;DR" callout, a "Builds on: [[...]]" line when an existing note fits, then numbered sections ("## 1. … <emoji>"), each building on the last the way you taught it: the unconditional truths first, every step motivated, concrete examples, analogies in "> [!tip]" callouts, common mistakes in a "> [!warning]" callout.${practical ? '' : ` If the lesson was really about USING a tool, CLI or editor (commands, keys, flags), write it as ${cheat} instead.`} Plain markdown only (no dataviewjs, no HTML). Tables are fine in the note.
2. A question file in EXACTLY this format:
---
subject: <Subject>
topic: <Short Topic>
tags: [<subject lowercase>, questions]
---

# <Short Topic> — Questions

Source note: [[<the note title>]]

## <Question text?>
%% id: <prefix>-001 %%
> [!answer]-
> **Core answer** in 1–4 lines, key terms bold.
>
> **Why:** 2–4 short bullets someone could use to re-derive it.
>
> **Example:** a concrete case with real numbers.

Rules for the question file: 6 to 12 questions; build them mainly from what was taught AND where he struggled (below): each misconception he showed deserves a question whose answer repairs it. Explain the why, not just the fact. ${practical ? `For what he did hands-on: ${practicalQs.replace(/^Practical lesson: a/, 'a')}` : `If the lesson was about using a tool or CLI: ${practicalQs.replace(/^Practical lesson: a/, 'a')}`} Every answer line starts with "> " (blank lines inside are ">"). No tables, no headings, no LaTeX inside answers. ids are <prefix>-001, -002, … in order (the server re-numbers them anyway).

Existing subjects: ${subjects.join(', ')}.
Existing notes${subject ? ` in ${subject}` : ''} (don't reuse a title; link them with [[...]] where relevant): ${notes.join(' · ') || '(none)'}
Existing question files${subject ? ` in ${subject}` : ''}: ${qFiles.join(' · ') || '(none)'}
Taken id prefixes (pick a new short one, 2–4 letters): ${prefixes.join(', ')}
${hard.length ? `\nWhere he struggled in this lesson:\n${hard.join('\n')}\n` : ''}${ran.length ? `\nCommands he ran in the lesson's terminal (for the examples):\n${ran.map((c) => `$ ${clip(c, 200)}`).join('\n')}\n` : ''}${sampleHead ? `\nStart of one of his notes, for style:\n<<<\n${sampleHead}\n>>>\n` : ''}
Reply in exactly this shape and nothing else:
<meta>{"subject": "<existing subject folder>", "noteTitle": "<new note title, no slashes or colons>", "topic": "<short topic = question file name>", "prefix": "<new id prefix>"}</meta>
<note_file>
…the whole note…
</note_file>
<question_file>
…the whole question file…
</question_file>
</save_request>${(s.materials || []).length ? `\nThis lesson worked from his materials (${s.materials.map((a) => `“${a.title}”${a.range ? ` pages ${a.range}` : ''}`).join('; ')}): use their terminology and examples, name the source pages in the note (e.g. "Source: <title>, pp. 40–55"), and make questions on what those pages cover.` : ''}`;

  const parse = (raw) => {
    const errs = [];
    const tag = (name) => { const m = raw.match(new RegExp(`<${name}>\\n?([\\s\\S]*?)\\n?</${name}>`)); return m ? m[1].trim() : null; };
    let meta = null;
    try { meta = JSON.parse(tag('meta') || ''); } catch { errs.push('the <meta> block is not valid JSON'); }
    if (meta !== null && (typeof meta !== 'object' || Array.isArray(meta))) { meta = null; errs.push('<meta> must be a JSON object'); }
    const note = tag('note_file'), questions = tag('question_file');
    if (!note) errs.push('missing <note_file>');
    if (!questions) errs.push('missing <question_file>');
    if (meta) {
      meta.subject = safeName(meta.subject); meta.noteTitle = safeName(meta.noteTitle); meta.topic = safeName(meta.topic);
      meta.subject = subjects.find((x) => x.toLowerCase() === meta.subject.toLowerCase()) || meta.subject;   // existing folder's case
      if (!meta.subject || !meta.noteTitle || !meta.topic) errs.push('meta needs subject, noteTitle and topic');
    }
    if (questions && meta) errs.push(...questionProblems(questions, meta.noteTitle));
    return { errs, meta, note, questions };
  };

  let raw = await p.ask(mats.length ? [...mats, { type: 'text', text: prompt }] : prompt);
  let r = parse(raw);
  if (r.errs.length) {
    raw = await p.ask(`<invalid>\n${r.errs.map((e) => `- ${e}`).join('\n')}\n</invalid>\nSend the whole <meta>, <note_file> and <question_file> reply again, fixed.`);
    r = parse(raw);
    if (r.errs.length && (!r.meta || !r.questions || !r.meta.subject || !r.meta.noteTitle || !r.meta.topic)) throw new Error(`Couldn't build the vault files: ${r.errs.join('; ')}`);
  }
  const ids = assignIds(r.questions, r.meta.prefix, knownIds);
  s.savePreview = {
    id: crypto.randomBytes(4).toString('hex'), ts: nowIso(),
    subject: r.meta.subject, noteTitle: r.meta.noteTitle, topic: r.meta.topic, prefix: ids.prefix,
    note: r.note, questions: ids.text, count: ids.count,
    problems: questionProblems(ids.text, r.meta.noteTitle),
  };
  if (auto) s.savePreview.auto = true;   // prepared by itself: the browser shows a banner, not the modal
  if (practical) s.savePreview.practical = true;
}

// What the browser sees of a preview: content + where it would go + what already exists.
function publicPreview(pv) {
  const notePath = path.join(pv.subject, `${pv.noteTitle}.md`);
  const qPath = path.join(pv.subject, 'Questions', `${pv.topic}.md`);
  return {
    ...pv, notePath, questionPath: qPath,
    noteExists: fs.existsSync(path.join(LEARNING_DIR, notePath)),
    questionFileExists: fs.existsSync(path.join(LEARNING_DIR, qPath)),
    newSubject: !fs.existsSync(path.join(LEARNING_DIR, pv.subject)),
  };
}

// ---------- auto-prepared save (the lesson just ended) ----------
// When a teacher turn with a done card is stored, the same save preview is made in the background, so
// at the end of a lesson the note and questions are one click away. s.autoSave = { state, key, since,
// message, dismissed }: state preparing | ready | failed | interrupted (server restarted mid-job);
// key = the done turn's ts (a failure isn't retried for the same done turn; a rewritten one may retry).
// It doesn't use s.pending/startJob: the learner can keep asking while it runs (his turn queues behind
// it on the same teacher process).
const VAULT_DIR = path.resolve(LEARNING_DIR, '..');
const VAULT_NAME = process.env.QUIZ_VAULT || path.basename(VAULT_DIR);
const obsidianUrl = (rel) => `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(posixRel(VAULT_DIR, path.join(LEARNING_DIR, rel)).replace(/\.md$/, ''))}`;

function lastDoneTurn(s) {
  if (phaseOf(s) !== 'done') return null;
  return teacherTurns(s).filter((t) => t.card && t.card.kind === 'done').pop() || null;
}

// Start the background preview if the lesson just ended and nothing is saved, prepared or preparing.
// force: restart an interrupted one / Try again (still never while a preview exists or one runs).
function maybeAutoSave(s, { force = false } = {}) {
  if (!ctx || !ctx.ai || !llm.available('teach')) return null;
  if (cache.get(s.id) !== s) return null;                         // deleted meanwhile
  const done = lastDoneTurn(s);
  const a = s.autoSave || {};
  if (!done || (s.saved || []).length || s.savePreview || autoJobs.has(s.id)) return null;
  if (s.pending && s.pending.kind === 'save') return null;        // a manual preview is being made
  if (a.dismissed && !force) return null;
  if (!force && a.state === 'failed' && a.key === done.ts) return null;
  if (!force && a.state && a.state !== 'failed' && a.key === done.ts) return null;   // already handled this done card
  s.autoSave = { state: 'preparing', key: done.ts, since: nowIso(), dismissed: !!a.dismissed };
  saveSession(s);
  let used = null;   // the teacher process this job asks (a redo may replace it meanwhile)
  const job = (async () => {
    try {
      const run = savePreviewTurn(s, { auto: true });
      used = procs.get(s.id);
      await run;
      s.autoSave.state = 'ready';
      delete s.autoSave.message;
    } catch (e) {
      console.error('[teach] auto save preview failed:', e.message);
      const still = lastDoneTurn(s);
      // Cut off by a rewrite of the last reply (its process was closed): the new done turn starts it again.
      if (!still || still.ts !== s.autoSave.key) s.autoSave.state = null;
      else Object.assign(s.autoSave, { state: 'failed', message: e.message });
      // A fresh process for the next try, but never one a newer turn is using (redo) or about to use.
      if (used && procs.get(s.id) === used && !jobs.has(s.id)) closeProc(s.id);
    } finally {
      autoJobs.delete(s.id);
      if (cache.get(s.id) === s) { try { saveSession(s); } catch (e) { console.error('[teach] save failed:', e.message); } }
      // A done turn stored while this ran (the learner asked something and the teacher closed again) is covered by the same preview.
    }
  })();
  autoJobs.set(s.id, job);
  return job;
}

// What the banner needs.
function autoSaveView(s) {
  const a = s.autoSave;
  if (!a) return null;
  const saved = (s.saved || [])[(s.saved || []).length - 1];
  let state = null;
  if (autoJobs.has(s.id) || a.state === 'interrupted') state = 'preparing';
  else if (saved) state = 'saved';
  else if (s.savePreview) state = 'ready';
  else if (a.state === 'failed') state = 'failed';
  if (!state) return null;
  const out = { state, dismissed: !!a.dismissed, since: a.since || null };
  if (state === 'failed') out.message = a.message || null;
  if (state === 'ready') out.count = s.savePreview.count;
  if (state === 'saved') {
    const note = saved.notePath || (saved.mode !== 'questions' ? saved.written.find((f) => !/[\\/]Questions[\\/]/.test(f)) : null) || null;
    out.saved = { mode: saved.mode || 'all', notePath: note, noteWritten: !!note && saved.written.includes(note), noteUrl: note ? obsidianUrl(note) : null, count: saved.expected || 0, loaded: saved.loaded || 0,
      questionPath: saved.questionPath || [...saved.written, ...saved.appended].find((f) => /[\\/]Questions[\\/]/.test(f)) || null };
  }
  return out;
}

// Questions-only save: point "Source note" at the lesson's own note, else at the preview's note when it
// already exists in the vault, else drop the line (no note to point to).
function retargetSource(s, pv, text) {
  const subject = pv.subject;
  const own = s.source && s.source.title ? findNote(s.source.title, subject) || findNote(s.source.title) : null;
  const target = own ? own.title : fs.existsSync(path.join(vaultPaths(pv).notePath)) ? pv.noteTitle : null;
  const line = /^Source note:.*(?:\n|$)/m;
  if (!target) return { text: text.replace(line, '').replace(/\n{3,}/g, '\n\n'), source: null };
  if (line.test(text)) return { text: text.replace(line, `Source note: [[${target}]]\n`), source: target };
  const i = text.search(/^## /m);
  return { text: i < 0 ? text : `${text.slice(0, i)}Source note: [[${target}]]\n\n${text.slice(i)}`, source: target };
}

// ---------- learner actions ----------

function cleanConfidence(v) { const n = Number(v); return v === null || v === undefined || v === '' || !CONF.includes(n) ? undefined : n; }
const cleanText = (v, n = 8000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);

function recordAnswer(s, body) {
  const card = openCard(s);
  if (!card || card.id !== body.cardId) throw Object.assign(new Error('That card is not open any more'), { status: 409 });
  const t = { role: 'learner', kind: 'answer', ts: nowIso(), cardId: card.id };
  if (card.kind === 'plan') {
    if (body.approve) t.approve = true;
    else if (cleanText(body.text)) t.text = cleanText(body.text);
    else throw Object.assign(new Error('approve or describe the change'), { status: 400 });
  } else {
    if (body.dontKnow) t.dontKnow = true;
    if (!t.dontKnow && Number.isInteger(body.choice) && Array.isArray(card.options) && body.choice >= 0 && body.choice < card.options.length) t.choice = body.choice;
    if (!t.dontKnow && t.choice === undefined && cleanText(body.choiceText, 500)) t.choiceText = cleanText(body.choiceText, 500);
    if (cleanText(body.text)) t.text = cleanText(body.text);
    const conf = cleanConfidence(body.confidence);
    if (conf !== undefined && !t.dontKnow) t.confidence = conf;
    if (cleanText(body.thinking)) t.thinking = cleanText(body.thinking);
    if (cleanText(body.thinkingWhileReading)) t.thinkingWhileReading = cleanText(body.thinkingWhileReading);
    if (card.kind === 'task') {
      if (!t.dontKnow) t.done = true;
      if (body._check) t.check = body._check;
      attachDrawing(s, t, body.drawing);
      s.turns.push(t);
      return;
    }
    const graded = card.kind === 'probe' || card.kind === 'check';
    if (graded && !card.freeRecall && t.choice === undefined && !t.dontKnow) throw Object.assign(new Error('pick an option or "I don\'t know"'), { status: 400 });
    if (card.freeRecall && !t.text && !t.dontKnow) throw Object.assign(new Error('write your answer or press "I don\'t know"'), { status: 400 });
    if (!graded && t.choice === undefined && !t.choiceText && !t.text && !t.dontKnow) throw Object.assign(new Error('write or pick an answer'), { status: 400 });
  }
  attachDrawing(s, t, body.drawing);
  s.turns.push(t);
}

function newSession(body) {
  const goal = cleanText(body.goal, 2000);
  if (!goal) throw Object.assign(new Error('Write what you want to understand'), { status: 400 });
  const source = {};
  let labInfo = null;
  if (body.labFile) {
    const l = lab && lab.parseLab(String(body.labFile));
    if (!l) throw Object.assign(new Error('That lab file was not found'), { status: 404 });
    labInfo = { on: true, file: l.id, task: l.task || null, seen: 0 };
    Object.assign(source, { type: 'lab', lab: l.id, title: l.note || null, labTitle: l.title });
    if (!body.subject) body.subject = l.subject;
  } else if (body.labTask) {
    labInfo = { on: true, file: null, task: String(body.labTask).slice(0, 1000), seen: 0 };
    Object.assign(source, { type: 'lab', title: body.noteTitle || null });
  } else if (body.toLearn && body.toLearn.list && body.toLearn.item) {
    Object.assign(source, { type: 'tolearn', list: String(body.toLearn.list), item: String(body.toLearn.item), title: body.noteTitle || null });
  } else if (body.gapId) Object.assign(source, { type: 'gap', gapId: String(body.gapId), title: body.noteTitle || null });
  else if (body.topic) Object.assign(source, { type: 'topic', topic: String(body.topic), title: body.noteTitle || null });
  else if (body.noteTitle) Object.assign(source, { type: 'note', title: String(body.noteTitle) });
  if (body.subject) source.subject = String(body.subject);
  const s = {
    id: `t-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
    created: nowIso(), updated: nowIso(), status: 'active',
    goal, subject: body.subject ? String(body.subject) : null, source: source.type ? source : null,
    turns: [], pending: null, error: null,
  };
  if (labInfo) s.lab = labInfo;
  const att = attachMaterials(s, body.materials, 0);
  if (att.length) {
    if (!s.subject) s.subject = att.map((a) => a.subject).find(Boolean) || null;
    if (!s.source) s.source = { type: 'material', title: null };
  }
  s.context = buildContext(s);
  cache.set(s.id, s);
  if (source.type === 'tolearn') { try { require('./tolearn').attach(source.list, source.item, s.id); } catch (e) { console.error('[teach] tolearn attach', e.message); } }
  return s;
}

// ---------- http ----------

// A bad or non-object body is the browser's mistake (400), not a server error.
async function readJson(req) {
  let body;
  try { body = await ctx.readBody(req); } catch { throw Object.assign(new Error('invalid JSON body'), { status: 400 }); }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function fail(res, e) {
  return ctx.send(res, e.status || 500, { error: e.message });
}

async function handle(req, res, url, c) {
  ctx = ctx || c;
  const p = url.pathname;
  if (!p.startsWith('/api/teach')) return false;
  const send = ctx.send;
  try {
    if (req.method === 'GET' && p === '/api/teach/sessions') return send(res, 200, { sessions: listSessions(), available: llm.available('teach'), why: llm.whyUnavailable('teach'), engine: llm.engineFor('teach'), model: llm.modelLabel(llm.engineFor('teach'), llm.defaultTier('teach')) }), true;
    // Labs in the vault, with progress from the lessons that ran them, plus whether the lab machine answers.
    if (req.method === 'GET' && p === '/api/teach/labs') {
      if (!lab) return send(res, 200, { labs: [], status: { ok: false, error: 'lab module missing' } }), true;
      const sessions = listSessions().filter((x) => x.lab);
      const labs = lab.listLabs().map((l) => {
        const mine = sessions.filter((x) => x.lab.file === l.id);
        const best = mine.reduce((m, x) => Math.max(m, x.lab.done), 0);
        return { id: l.id, subject: l.subject, title: l.title, goal: l.goal, task: l.task, note: l.note,
          steps: l.steps.map((x) => ({ id: x.id, title: x.title })), done: best, session: mine[0] ? mine[0].id : null };
      });
      const forTask = url.searchParams.get('task');
      const match = forTask ? lab.findLabForTask(forTask) : null;
      return send(res, 200, { labs, match: match ? match.id : null, status: await lab.status(url.searchParams.get('force') === '1') }), true;
    }
    if (req.method === 'GET' && p === '/api/teach/notes') {
      return send(res, 200, { notes: listNotes(), subjects: subjectDirs() }), true;
    }
    if (req.method === 'POST' && p === '/api/teach/start') {
      if (!llm.available('teach')) return send(res, 503, { error: llm.whyUnavailable('teach') }), true;
      const body = await readJson(req);
      const s = newSession(body);
      const job = turnJob(s);
      if (body.wait) await job;
      return send(res, 200, viewOf(s)), true;
    }
    const m = p.match(/^\/api\/teach\/([\w-]+)(?:\/([\w/-]+))?$/);
    if (!m) return send(res, 404, { error: 'not found' }), true;
    const s = loadSession(m[1]);
    if (!s) return send(res, 404, { error: 'teach session not found' }), true;
    const action = m[2] || '';

    if (req.method === 'GET' && !action) {
      if (s.autoSave && s.autoSave.state === 'interrupted') {
        if (s.savePreview || (s.saved || []).length) { s.autoSave.state = 'ready'; saveSession(s); }
        else { s.autoSave.state = null; try { maybeAutoSave(s, { force: true }); } catch (e) { console.error('[teach] auto save restart:', e.message); } }
      }
      return send(res, 200, viewOf(s)), true;
    }
    if (req.method === 'GET' && action === 'live') return liveStream(req, res, s), true;
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true;
    const body = await readJson(req);
    let job = null;

    if (action === 'answer') {
      if (s.pending) throw Object.assign(new Error('The teacher is still working on the last turn'), { status: 409 });
      delete body._check;
      // A lab step's check command (from the vault file, never from the model or the browser) runs now.
      const card = openCard(s);
      if (lab && card && card.kind === 'task' && card.id === body.cardId && card.stepId && !body.dontKnow) {
        const step = (labSteps(s) || []).find((x) => x.id === card.stepId);
        if (step && step.check) body._check = await lab.runCheck(step.check);
      }
      recordAnswer(s, body);
      job = turnJob(s);
    } else if (action === 'message' || action === 'plan') {
      const text = cleanText(body.text);
      if (!text) return send(res, 400, { error: 'empty message' }), true;
      if (s.pending) throw Object.assign(new Error('The teacher is still working on the last turn'), { status: 409 });
      const turn = { role: 'learner', kind: action === 'plan' ? 'planChange' : 'message', ts: nowIso(), text };
      if (action === 'message' && body.board) {
        turn.board = true;
        if (body.live) turn.live = true;   // talk and draw at once, streamed (LiveRun)
        // "Explain on the board" under a reply: quote that reply so the teacher knows what to redraw.
        const ref = Number.isInteger(body.about) ? s.turns[body.about] : null;
        if (ref && ref.role === 'teacher' && ref.say) turn.about = clip(ref.say, 1500);
      } else if (action === 'message' && body.autoBoard && pref('teacher.boards', 'off') === 'auto') {
        turn.autoBoard = true;   // the teacher may answer on the live board by itself (turnJob)
      }
      if (action === 'message') attachDrawing(s, turn, body.drawing);
      if (action === 'message' && Array.isArray(body.materials) && body.materials.length) {
        turn.materials = attachMaterials(s, body.materials, s.turns.length).map(materialBrief);
      }
      // He cut a live answer off (Space, typing, Stop): what he actually heard before that.
      if (action === 'message' && body.interrupted && typeof body.interrupted === 'object') {
        const i = body.interrupted;
        turn.interrupted = {
          heard: clip(String(i.heard || ''), 2000),
          unheard: Math.max(0, Math.min(200, Number(i.unheard) || 0)),
        };
      }
      s.turns.push(turn);
      job = turnJob(s);
    } else if (action === 'redo') {
      // Rewrite the teacher's last reply (e.g. it skipped the explanation). Only while its card is unanswered.
      if (s.pending) throw Object.assign(new Error('The teacher is still working on the last turn'), { status: 409 });
      const last = s.turns[s.turns.length - 1];
      if (!last || last.role !== 'teacher') return send(res, 409, { error: 'You already answered the last reply' }), true;
      if (s.turns.filter((t) => t.role === 'teacher').length < 2) return send(res, 409, { error: 'Nothing to rewrite yet' }), true;
      s.turns.pop();
      if (last.plan || last.assessment) s.assessment = (s.turns.filter((t) => t.assessment).pop() || {}).assessment || null;
      closeProc(s.id);   // a fresh teacher, replayed without the dropped reply
      job = turnJob(s);
    } else if (action === 'retry') {
      if (!s.error) return send(res, 200, viewOf(s)), true;
      const kind = s.error.kind;
      job = kind === 'save' ? startJob(s, kind, () => savePreviewTurn(s)) : turnJob(s);
    } else if (action === 'save/preview') {
      if (!s.turns.length) return send(res, 400, { error: 'nothing taught yet' }), true;
      // The auto-prepared one is still being made: don't start a second; it shows up when ready.
      if (autoJobs.has(s.id)) return send(res, 200, viewOf(s)), true;
      job = startJob(s, 'save', () => savePreviewTurn(s));
    } else if (action === 'save/auto') {
      // Try again after a failed auto preparation (also clears "Not now").
      if (s.pending) throw Object.assign(new Error('The teacher is still working on the last turn'), { status: 409 });
      if (s.autoSave) s.autoSave.dismissed = false;
      if (!maybeAutoSave(s, { force: true }) && !autoJobs.has(s.id)) return send(res, 409, { error: 'nothing to prepare (already saved or prepared)' }), true;
    } else if (action === 'save/dismiss') {
      // "Not now": hide the banner for this lesson. The manual Save to vault… still works.
      s.autoSave = { ...(s.autoSave || {}), dismissed: true };
      saveSession(s);
    } else if (action === 'save/discard') {
      s.savePreview = null; saveSession(s);
    } else if (action === 'save/confirm') {
      const pv = s.savePreview;
      if (!pv || pv.id !== body.previewId) return send(res, 409, { error: 'that preview is gone; make a new one' }), true;
      // mode 'questions': only the question file; its "Source note" points at a note that exists (or nowhere).
      const questionsOnly = body.mode === 'questions';
      const src = questionsOnly ? retargetSource(s, pv, pv.questions) : { text: pv.questions };
      // Re-check ids against the vault as it is now (it may have changed since the preview).
      const fixed = assignIds(src.text, pv.prefix, allKnownIds());
      if (!fixed.count) return send(res, 400, { error: 'the preview has no questions; make a new one' }), true;
      const result = writeToVault({ ...pv, note: questionsOnly ? null : pv.note, questions: fixed.text });
      const loaded = ctx.loadQuestions().filter((q) => q.id.startsWith(`${fixed.prefix}-`)).length;
      const paths = vaultPaths(pv);
      const rel = (f) => posixRel(LEARNING_DIR, f);
      // The note this lesson's questions belong to: the one just written, or an existing one it links.
      const notePath = questionsOnly ? (src.source ? (findNote(src.source, pv.subject) || findNote(src.source) || {}).file || null : null)
        : rel(paths.notePath);
      s.saved = [...(s.saved || []), { ts: nowIso(), ...result, prefix: fixed.prefix, loaded, expected: fixed.count,
        mode: questionsOnly ? 'questions' : 'all', notePath: notePath ? (path.isAbsolute(notePath) ? rel(notePath) : notePath) : null, questionPath: rel(paths.qPath) }];
      s.savePreview = null;
      saveSession(s);
      return send(res, 200, { ...viewOf(s), result: { ...result, loaded, expected: fixed.count } }), true;
    } else if (action === 'lab') {
      // Open the lab terminal in this lesson (any lesson can get one).
      if (!lab) return send(res, 503, { error: 'lab module missing' }), true;
      s.lab = { ...(s.lab || {}), on: body.on !== false };
      if (body.on === false) s.lab.auto = false;   // turned off by hand: don't switch it back on at the next turn
      if (s.lab.seen === undefined) s.lab.seen = 0;
      saveSession(s);
    } else if (action === 'close') {
      closeProc(s.id); s.status = 'closed'; saveSession(s);
    } else if (action === 'delete') {
      if (s.pending) return send(res, 409, { error: 'busy' }), true;
      closeProc(s.id); cache.delete(s.id);
      try { fs.unlinkSync(sessionFile(s.id)); } catch {}
      // His board drawings (<id>-<n>.png).
      try { for (const f of fs.readdirSync(TEACH_DIR)) if (f.startsWith(`${s.id}-`) && f.endsWith('.png')) fs.unlinkSync(path.join(TEACH_DIR, f)); } catch {}
      return send(res, 200, { ok: true }), true;
    } else {
      return send(res, 404, { error: 'unknown action' }), true;
    }
    if (s.status === 'closed' && job) s.status = 'active';
    if (job && body.wait) await job;
    return send(res, 200, viewOf(s)), true;
  } catch (e) {
    if (!e.status) console.error('[teach]', e);
    fail(res, e);
    return true;
  }
}

module.exports = {
  init(c) { ctx = c; },
  handle,
  // for tests / other modules
  writeToVault, parseQuestionText, questionProblems, assignIds, validateReply, phaseAt, SYSTEM_PROMPT, PROMPTS,
  listSessions, loadSession, addCapture,
};
