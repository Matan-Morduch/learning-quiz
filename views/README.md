# Answer Visuals (views)

Interactive widgets and animations shown inside quiz answers. **One file per view**, and each one works in two places:

- **Obsidian:** a `dataviewjs` block in a question's answer calls Dataview's `dv.view(...)`.
- **Quiz app:** `index.html` finds the same block, loads `/views/<name>.js`, and runs it with a fake `dv`.

## Embedding a view in an answer

```markdown
## Why is removing from the front of a dynamic array slow, and what structure fixes it?
%% id: da-024 %%
> [!answer]-
> Core answer…
>
> **Example:** …
>
> ```dataviewjs
> await dv.view("Learning/_quiz/views/front-removal", {n: 6})
> ```
```

- The path is always `Learning/_quiz/views/<name>`, without `.js`.
- The input is a JS object literal **on the same line**. Use `{}` for defaults.

## Contract for view files (`views/<name>.js`)

The file is the **body of an async function** with two variables in scope: `dv` and `input`.

1. **Header comment:** name, what it teaches, and `input: {...}` with each param and its default.
2. **Read input safely:** `const opts = (typeof input === "object" && input) || {};`, with a default for every param.
3. **Plain DOM only:** `document.createElement`, `appendChild`, `innerHTML`, inline SVG.
   - The only `dv` API allowed is `dv.container` (append one root `div` to it).
   - No Obsidian helpers (`createEl`, `empty`), no network, no libraries, no `localStorage`.
4. **Theme:** use these CSS variables, which exist in both Obsidian and the quiz app:
   - Colors: `--interactive-accent`, `--text-on-accent`, `--text-normal`, `--text-muted`, `--text-faint`, `--text-accent`, `--text-error`
   - Backgrounds: `--background-primary`, `--background-secondary`, `--background-modifier-border`
   - Font: `--font-monospace`

   Fixed semantic colors that work in both themes: `#3b82f6` blue, `#2b8a3e` green, `#e8590c` orange, `#9c36b5` purple, `#d6336c` pink.
5. **Root style:** `border:1px solid var(--background-modifier-border);border-radius:10px;padding:12px;font-size:14px;`
6. **Animations and timers:**
   - Every `setTimeout`, `setInterval` and `requestAnimationFrame` loop checks `root.isConnected` and stops when it's false (the answer closed).
   - Use a `busy` flag so double clicks can't start two animations.
7. **Narrate:** keep a live text line that says what just happened *with the real numbers* (e.g. `write = (7 + 1) % 8 = 0 ↩ wrapped`).
8. **Layout:** responsive (`flex-wrap`, SVG `viewBox` + `width="100%"`), comfortable at ~640px and still usable at 360px.
9. **Size:** one idea per view, roughly under 250 lines. Prefer **params** over near-duplicate views.
10. **Test:** `node Learning/_quiz/check-views.js --questions` must pass. It runs every view and every embed against a fake DOM. It catches crashes, not ugly layouts, so read your own render code carefully too.

See `front-removal.js` for the reference style.

## Catalog

Before creating a view, check whether one here already fits (maybe with a param). Add a row for every new view.

| View | Shows | Input |
|---|---|---|
| `front-removal` | Dequeue from a plain array (shifts every element, animated) vs a ring buffer (only the index moves), with a move counter | `{n: 3–12 starting items = 6}` |
| `ring-buffer` | Interactive ring + the underlying array. Enqueue/dequeue/peek, the three full/empty strategies, reject/overwrite, grow ×2, optional deque ops, formulas narrated | `{cap: 8, strategy: "count"\|"slot"\|"free", policy: "reject"\|"overwrite", deque: false, fill: 0, start: 0}` |
| `mod-clock` | Modulo as a clock: step forward and back around `cap`, with language toggle showing `-1 % 8` in C/Java/JS vs Python | `{cap: 8, start: 0}` |
| `bitmask` | `i & (cap−1)` vs `i % cap` bit by bit. Works for powers of 2 and visibly breaks for others | `{i: 13, cap: 8}` |
| `moving-average` | Noisy signal, ring of the last N readings, running total, smoothed line | `{n: 8}` |
| `dynamic-append` | Push into a dynamic array. Size vs capacity, resize animation (allocate, copy, free), pseudocode line highlight, reserve() | `{cap: 1 (0 allowed), factor: 2, reserve: false, showCode: false, target: 16}` |
| `amortized-chart` | Cost of each append as bars (spikes at resizes) + running average line + total vs 3n | `{n: 8–128 = 32, factor: 1.25–4 = 2}` |
| `growth-compare` | Total copies for ×factor vs +k growth as n grows. Waste vs copies trade-off | `{mode: "factor-vs-constant"\|"factors", k: 4, n: 1000}` |
| `address-calc` | `base + i × size`: pick an index and element size, highlight the byte range, O(1) jump | `{base: 1000, size: 4, n: 8, fixed: false}` |
| `array-shift` | Insert or delete at index i with animated shifting, and a move counter | `{op: "insert"\|"delete", index: 2, n: 8}` |
| `search-race` | Linear scan vs binary search on the same array, step counter | `{n: 32, sorted: true}` |
| `shrink-thrash` | Push/pop at the boundary with shrink at ½ vs ¼, counting copies (thrashing) | `{rule: "half"\|"quarter", start: 8}` |
| `realloc-move` | Heap strip with neighbors. Growth needs a new block → copy → old freed → old pointer dangles | `{neighbor: true, pointer: true}` |
| `cache-walk` | Array (contiguous) vs linked list (scattered) traversal, counting cache-line loads | `{n: 8–32 = 16}` |
| `pointer-array` | Python list = array of equal-size pointers to objects of different sizes | `{items: 3}` |
| `pulse-lab` | Pulse train with amplitude/pulse width/period/frequency/duty sliders, positive/negative polarity, leading/trailing vs rising/falling labels, periodic vs data mode | `{focus: "all"\|"amplitude"\|"width"\|"period"\|"frequency"\|"duty"\|"edges", polarity: "positive"\|"negative", mode: "periodic"\|"data", f: 2, duty: 50, amplitude: 5}` |
| `analog-vs-digital` | Add noise to an analog vs a 2-level digital signal, see which one still reads correctly | `{noise: 0.2, levels: 2, ttl: false}` |
| `edge-zoom` | Zoom into a real edge: RC slider, 10%/90% markers, measured tr/tf, tw at 50% | `{show: "rise"\|"fall"\|"width", rc: 4, tin: 40}` (ns) |
| `nonideal-pulse` | Toggle overshoot, ringing, droop, undershoot on a pulse | `{effects: "all" or ["droop", …], ideal: true}` |
| `freq-period` | Converter f ⟷ T with units (Hz/kHz/MHz/GHz ⟷ s/ms/µs/ns) + duty/tw calc | `{f: 1000, T, duty: 50, tw}` (seconds; T overrides f, tw overrides duty) |
| `pwm-lab` | Duty + frequency (slow-mo … 490 Hz), LED, average-voltage line, analogWrite value, multimeter reading | `{duty: 25, speed: "slow"\|"real", value: 0–255, hz, vhigh: 5}` |
| `led-iv` | LED voltage vs current/brightness: nothing, then a cliff at the forward voltage | `{color: "red"\|"white", v}` |
| `dimming-efficiency` | Linear/rheostat dimming vs PWM: power into the load vs heat wasted | `{load: "lamp"\|"led", level: 50}` |
| `gamma-fade` | Linear vs gamma-corrected fades side by side + perceived brightness curve | `{duty: 50, secs: 3}` |
| `servo-pwm` | Pulse width 1–2 ms at 50 Hz → servo angle | `{pw: 1.5}` |
| `phantom-array` | Moving your eyes past a PWM LED: dotted trail vs a smooth smear for DC | `{hz: 490, duty: 25, sweep: 40}` |
| `binary-lab` | Clickable bits with place values, decimal value, +1/−1/×2, overflow, odd/even, MSB/LSB | `{bits: 8, value: 0}` |
| `place-value` | The same number broken into place values in base 10 vs base 2 | `{n: 345, base: 10, digits: "10"}` |
| `dec-to-bin` | Step-by-step decimal → binary, subtract-powers or divide-by-2 method | `{n: 13, method: "divide"\|"subtract"}` |
| `bits-capacity` | n bits → 2ⁿ patterns, range 0…2ⁿ−1, "bits needed for X" | `{bits: 4, need}` |
| `binary-counter` | Counter animation with each bit drawn as a pulse train (frequency divider) | `{bits: 4, rate: 2}` |
| `finger-binary` | Clickable hand(s) counting in binary | `{hands: 1, value}` |
| `rgb-bytes` | Three bytes (R, G, B) as bits/sliders → color swatch | `{r: 255, g: 128, b: 0}` |
| `stream-sim` | Producer/buffer/consumer streaming sim: speed, Wi-Fi mode, buffer size, stalls, delay | `{speed: 1.5, size: 6, mode: "steady"\|"bursty"\|"flaky"}` |
| `buffer-size-calc` | bitrate × seconds → bits → bytes → MB, and samples ÷ rate → latency | `{mode: "memory"\|"latency", bitrate: 5, seconds: 10, samples: 512, rate: 44100}` |
| `flush-demo` | Typed output sits in a line buffer until newline/flush | `{flush: false}` |
| `buffer-vs-cache` | The same request stream through a buffer (passes once, FIFO) vs a cache (hits on repeats) | `{stream: "ABACABA", cap: 3}` |
| `overflow-memory` | Unchecked copy into char[8] overwrites the neighboring variable. Toggle bounds checking | `{text: "HelloWorld!", check: false}` |
| `write-back` | Writes land in a RAM buffer and drain to USB. Yank early → data lost. Eject = flush | `{blocks: 10}` |
| `double-buffer` | Drawing a frame directly on screen (you see half-drawn frames) vs back buffer + swap | `{rows: 6}` |
| `spsc-ring` | Producer (interrupt) + consumer (main loop) share a ring. Each side writes only its own index; a shared count loses an update when an interrupt lands mid-update | `{mode: "indexes"\|"count"}` |
| `latency-throughput` | Packets travel a pipe (length = latency, width = throughput). Total = latency + size ÷ throughput, a bar showing which part dominates, packets in flight = throughput × latency | `{latency: 2, throughput: 4, size: 12, preset: "tiny"\|"big"\|"satellite"\|"slowlink"}` |
| `analogwrite-counter` | How analogWrite(value) works: an 8-bit counter 0→255→0, pin HIGH while counter < value → duty = value/255. Binary of the value, "I want X%" rounding | `{value: 64, vhigh: 5}` |
| `pipeline-gantt` | Two Gantt charts on one time axis: one-at-a-time vs pipelined stages. Animated time cursor, finished-item counters; latency per item stays stages × T, throughput becomes 1 per T | `{stages: 2–5 = 3, stageTime: 30, items: 1–8 = 3, unit: "min", labels: ["Wash","Dry","Fold"]}` |
| `bits-bytes` | Mbit/s ÷ 8 → MB/s, file size → MB → download time step by step, the "forgot ÷8" trap (8× too optimistic), sped-up download bar with a real-time clock | `{mbps: 100, size: 1, unit: "KB"\|"MB"\|"GB"\|"TB" = "GB", latencyMs: 0}` |
| `latency-scale` | Latency ladder (L1, RAM, SSD, disk seek, USA↔Europe RTT) on a log scale + "if 1 ns were 1 s", and a speed-of-light floor calculator (distance, fiber/vacuum, presets NY→London, geostationary, Starlink) with one-way and RTT | `{focus: "both"\|"table"\|"light", highlight: "l1"\|"ram"\|"ssd"\|"disk"\|"net" = "ram", km: 5570, medium: "fiber"\|"vacuum"}` |
| `solid-ripple` | A change request applied to a design without vs with a SOLID principle: which files are edited, added, or at risk, with code + story | `{scenario: "srp"\|"ocp"\|"isp"\|"dip", design: "before"\|"after"}` |
| `lsp-tester` | Run the same client code with the base class and each subclass (animated trace), see which breaks Liskov, with the why and the fix | `{case: "rectangle"\|"bird"\|"account"\|"logger"}` |
| `solid-detective` | Game: read a code snippet, pick which SOLID principle it breaks (S/O/L/I/D), with explanation and score | `{only: "S"\|"O"\|"L"\|"I"\|"D", shuffle: true}` |
| `dependency-arrows` | Why DIP is "inversion": business layer above, details below. Without DIP the arrow across the line points down (OrderService → MySQLDatabase); apply DIP (animated) and the business-owned interface appears, the detail implements it, arrow points up. Plug in MySQL/Postgres/Fake and count OrderService edits | `{design: "before"\|"after", plug: "mysql"\|"postgres"\|"fake"}` |
| `cap-partition` | 3 replicas; cut the network (A alone vs B+C), write/read in CP (errors on minority) or AP (stale reads, conflict + lost write on heal with last-write-wins). Play button runs the classic scenario | `{mode: "CP"\|"AP", autoplay: false}` |
| `quorum-lab` | N/W/R sliders: write reaches W replicas, read asks R; R + W > N overlap rule, fault tolerance (N−W, N−R), 1000-trial stale-read % | `{n: 3, w: 2, r: 2}` |
| `cap-choose` | Game: network splits, should this system be CP or AP? (bank, cart, likes, seats, DNS, leader election…) with reasons | `{shuffle: true}` |
| `conflict-resolve` | Two replicas of a shopping cart diverge during a partition (A adds Mug, B removes Pen). Heal with last-write-wins (loses a write; a "slow clock" toggle makes it pick the wrong winner), merge (nothing added lost, removed item comes back), or ask the user (git-style). Counts lost adds / zombie items | `{strategy: "lww"\|"merge"\|"ask", skew: false, autoplay: false}` |
| `pacelc-latency` | PACELC's "else" trade-off with no partition: a write to a nearby replica with a far copy. EC waits for the far confirm (ack = 2·local + RTT), EL acks locally (2·local) and the far replica is stale ≈ RTT/2. Animated with a true-time clock, RTT slider | `{mode: "EC"\|"EL", rtt: 90 (10–250 ms), local: 1}` |
| `serverless-scaling` | One day of traffic (steady/office/spiky/viral) served by N fixed servers vs serverless: dropped requests, idle capacity, peak instances (= req/s × duration), cost per day. Play the day | `{pattern: "steady"\|"office"\|"spiky"\|"viral", servers: 3}` |
| `cold-start` | Requests over 10 simulated minutes: warm reuse vs cold starts, idle timeout, provisioned concurrency; latency bars, p50/p99, max instances | `{rate: 1, init: 800, timeout: 60, provisioned: 0, preset: "busy"\|"rare"\|"spiky"}` |
| `serverless-cost` | Lambda pricing calculator (requests + GB-seconds, free tier) vs a fixed monthly server, cost curve and break-even | `{requests: 3000000, ms: 200, memory: 128, server: 30, freeTier: true}` |
| `responsibility-stack` | Five layers (code, scaling, runtime, OS + patches, hardware). Click on-prem / IaaS / PaaS / serverless and the layers the cloud takes over slide to the cloud column; car/taxi analogy, "you manage X of 5". Walk-through button | `{model: "onprem"\|"iaas"\|"paas"\|"faas" = "faas"}` |
| `stateless-instances` | The global-variable trap: `visits += 1` across serverless instances. Single requests, bursts (create new instances), quiet period (instances die, counters lost); users see diverging counts vs the real total. Toggle to a database counter | `{store: "global"\|"db", preload: true}` |
| `bucket-sort` | Animated bucket sort: scatter (index formula narrated) → insertion-sort each bucket (comparisons) → gather. Evenly spread vs clumped vs integers; n and k sliders; warns when one bucket holds most items | `{n: 10, k: 5, data: "uniform"\|"clustered"\|"ints"}` |
| `bucket-k-chart` | Work (n + k + Σ b²/4) vs number of buckets k, averaged over random trials; best k, k = n line, n·log₂n reference; evenly spread vs clumped | `{n: 100, data: "uniform"\|"clustered"}` |
| `bucket-index-drill` | Practice: which bucket gets value x? Floats in [0,1) and ranges [min,max], including the x = max → k − 1 trap | `{maxTrap: true}` |
| `bucket-outlier` | One outlier stretches min…max, so equal-width buckets squeeze all normal values into bucket 0: number line with boundaries, items-per-bucket bars, Σ b²/4 work vs n²/4. Outlier slider (none … 10000) and a "boundaries from a sorted sample" (TeraSort) mode that stays balanced | `{n: 20 (10–40, k = n), outlier: 0\|12\|20\|50\|100\|1000\|10000 = 1000, mode: "equal"\|"sampled"}` |
| `bucket-cost-squares` | Why bucket sort is O(n) on even data: histogram of bucket sizes + each bucket's sort cost drawn as a b×b square of tiles; Σb² ≈ 2n vs one giant n² square when clumped | `{n: 40, data: "uniform"\|"clustered"}` |
| `papi-fork-tree` | Step through fork() calls and watch the process tree grow: plain `fork();` × N (2ᴺ) vs loop with `if (fork() == 0) break;` (N + 1). Table of what fork() returned to each process (0 / child PID / not born yet / left loop) | `{mode: "plain"\|"loop", n: 1–4 = 3, start: forks already run (default n), table: true}` |
| `papi-shell` | A shell running one command step by step: fork → child rewires fds (`>` via open + dup2, `\|` via pipe + dup2) → exec (PID kept, program replaced) → parent sleeps in waitpid → child exits → reaped. Process cards with PID/program/state/fork() return/fd table, terminal/out.txt/pipe boxes | `{mode: "simple"\|"redirect"\|"pipe" = "redirect", step: 0, autoplay: false}` |
| `zo-timeline` | Parent/child/PID 1 lifetimes on one time axis: child-first vs parent-first, parent waits / never / SIGCHLD handler / SIG_IGN / server-never-exits, PID 1 = init or your app (Docker, no --init). Zombie/orphan segments, "adopted" and reap marks, live `ps -o pid,ppid,stat,cmd` at the cursor, zombie-time verdict. Play or scrub | `{order: "child-first"\|"parent-first", parent: "wait"\|"never"\|"handler"\|"ignore"\|"server", pid1: "init"\|"app", t: 0–10 = 5}` |
| `zo-pid-table` | Leaky server forks a child per request into a toy PID table; never-reaping fills it with Z until fork() fails with EAGAIN. Toggle a SIGCHLD reaping handler, or kill the server (PID 1 adopts + reaps zombies). Calculator: pid_max ÷ leak rate → time to exhaustion | `{slots: 20–80 = 40, reap: "never"\|"handler", prefill: 0–0.9 = 0.5, rate: 10, pidmax: 32768\|4194304}` |
| `zo-detective` | Game: read ps output or a short story, call it zombie / orphan / normal (incl. traps: PPID 1 service, kill -9 on Z, Docker PID 1), with explanation and score | `{shuffle: true, only: "zombie"\|"orphan"\|"normal"}` |
| `sig-sender` | Send SIGINT/TERM/KILL/STOP/CONT to a plain program, one with a TERM handler, one ignoring TERM, a zombie, a D-state process, or PID 1 in a container. Live ps STAT, pending signals (don't queue), exit code 128 + N, temp file removed vs left behind; "I/O finishes" delivers pending (KILL first) | `{type: "plain"\|"handler"\|"ignores"\|"zombie"\|"dstate"\|"pid1", send: ["TERM", …] = []}` |
| `sig-shutdown` | Graceful-shutdown timeline: SIGTERM at 0, grace period (docker 10 s / k8s 30 s / systemd 90 s), SIGKILL. Cleanup-time slider, app with handler / no handler / PID 1 without handler; % of cleanup done, exit 0 / 137 / 143. Play animates | `{platform: "docker"\|"k8s"\|"systemd", app: "handler"\|"none"\|"pid1", cleanup: 0–120 = 6, autoplay: false}` |
| `sig-exitcode` | Exit code decoder: 128 + N → signal (130 INT, 137 KILL, 139 SEGV, 141 PIPE, 143 TERM…), plus 0, 124 (timeout) and "≤ 128 = the program chose it" | `{code: 137}` |
| `sig-mask` | Decode a /proc/PID/status mask (SigCgt/SigIgn/SigBlk/SigPnd): hex → bits (low 20 shown with names) → signals, rule bit N − 1 = signal N; presets from the note's programs | `{hex: "4002", field: "SigCgt"\|"SigIgn"\|"SigBlk"\|"SigPnd"}` |
| `sig-pending` | Block (sigprocmask) vs ignore (SIG_IGN): send SIGINT repeatedly, see one pending bit (repeats merge) vs thrown away, unblock → handler runs once vs zero times | `{mode: "block"\|"ignore", sends: 0–10 = 0}` |
| `sig-trap-wait` | When a bash trap runs: TERM arrives during foreground `sleep N` (trap waits until sleep ends) vs `sleep N & wait $!` (trap runs at once). Timeline + play | `{mode: "fg"\|"wait", sleep: 2–60 = 5, at: 1}` |
| `proc-scheduler` | Processes × ticks grid (Running / Ready / Blocked / CPU idle) for a tiny non-preemptive scheduler. Starts played out; Replay/Step narrate each transition; toggle switch-on-I/O vs wait-for-I/O and compare utilization (busy ÷ total). Optional time slice (switch-on-I/O only) | `{preset: "fig44"\|"fig43"\|"both"\|"three" = "fig44", progs: ["ccicc","ccccc"] ('c' CPU tick, 'i' tick that starts I/O; overrides preset), io: 1–8 = 3, policy: "io"\|"end", slice: 0–4 = 0}` |
| `proc-states` | Clickable Running/Ready/Blocked state machine: fire scheduled / time slice up / start I/O / I/O done; valid ones animate the arrow, invalid ones explain why (no Ready → Blocked, I/O done → Ready). Shows the ps letter and the path taken | `{start: "running"\|"ready"\|"blocked" = "ready"}` |
| `proc-address-space` | Address space column (code, static data, heap ↑, free, stack ↓) with real where.c addresses. Click a C line (global, static local, main, local, `char *buf = malloc(100)` → stack + heap, argv) to light its region; grow stack/heap buttons | `{focus: "code"\|"data"\|"heap"\|"stack"\|"pointer"}` |
| `proc-context-switch` | CPU registers (PC, SP, FP, R1) + PCB of A and B. Context switch animates: timer interrupt → save each register into the old PCB → Running → Ready → load the new PCB's registers → resume at its PC. "Run a bit" changes only the CPU copy | `{from: "A"\|"B" = "A"}` |
| `bvq-split` | Word splitting visualizer: a value or array through parameter expansion → word splitting (IFS default or `,`) → globbing (pretend folder) → quote removal, then the argument boxes a command gets. Forms `$v`, `"$v"`, `'$v'`, `${arr[@]}`, `"${arr[@]}"`, `"${arr[*]}"`, presets (space, `*`, empty, csv) and a verdict | `{value: "my file.txt", form: "$v"\|"\"$v\""\|"'$v'"\|"${arr[@]}"\|"\"${arr[@]}\""\|"\"${arr[*]}\"", arr: ["my file.txt","*.md",""], ifs: "default"\|",", cmd: "rm"}` |
| `bvq-param` | Parameter expansion playground: `#` `##` `%` `%%` `/` `//` `^^` `,,` `:-` `${#v}` `${v:off:len}` with a typed glob pattern; cut part struck through, result, keyboard memory trick. "Quiz me" mode with random cases and a score | `{value: "/home/matan/photos/beach.tar.gz", op: "#"\|"##"\|"%"\|"%%"\|"/"\|"//"\|"^^"\|",,"\|":-"\|"len"\|"sub" = "##", pattern: "*/", rep: "", quiz: false}` |
| `bvq-order` | Bash expansion order, stage by stage (brace → tilde → `$` → split → glob → quote removal) with the final words as boxes. Presets: a mixed line, `rm $f` with a space, the `v="{1..3}"` brace trap, single vs double quotes. Step or play | `{preset: "mix"\|"space"\|"brace-trap"\|"quotes", step: 0–6}` |
| `bvq-env` | Shell vs environment variables: parent shell card and child process card. `export`, run `bash -c` (sees only exported), one-shot `VAR=x cmd`, child sets a var (parent unchanged → why `cd`/`export` are builtins) | `{exported: ["HOME"], show: "city"}` |
| `bsm-stepper` | "Will this script stop?": step a small script line by line with set -e / set -u / pipefail toggles; per-line `$?`, ignored failures (set -e holes), where it stops and with what status | `{script: "deploy"\|"holes"\|"pipes", e: false, u: false, pipefail: false, run: false}` |
| `bsm-pipestatus` | Pipeline stages with clickable exit codes → `$?` without pipefail (last stage) vs with (rightmost failure) + PIPESTATUS. Game mode: random pipeline, guess both | `{codes: [1, 0], game: false}` |
| `bsm-andor` | The `A && B \|\| C` trap: toggle A/B success, see which commands run vs a real if/else | `{a: 0, b: 1}` |
| `bsm-exitcode` | `exit N` → N mod 256 as 8 bits, plus the meaning (0, 1, 2, 126, 127, 128 + N signal names), with presets | `{n: 300}` |
| `bcf-test-tester` | `[ $x … ]` vs `[ "$x" … ]` vs `[[ $x … ]]` for x = "", hello, "a b", *, 10, abc and tests `= hello`, `-eq 10`, `-n`, `-z`, `< 9`, `== h*`: the arguments `[` receives (after splitting/globbing), exit status and bash's real error message (all 108 cases precomputed in real bash), plus a why-line | `{x: "a b", op: "eq_str"\|"eq_num"\|"n"\|"z"\|"lt"\|"glob"}` |
| `bcf-scope` | Step through function calls with a call-stack view (frames + globals, highlighted lookup). Scenarios: the shared loop-counter `i` bug, dynamic scoping (callee sees the caller's local), `$( )` subshell throwing away changes. Toggle `local` | `{scenario: "loop"\|"dynamic"\|"capture", local: false}` |
| `bcf-case` | `case` tries patterns top to bottom (animated), first match wins, `\|` alternatives, `*)` default. Presets: file extensions, yes/no prompt, first-match-wins trap | `{preset: "files"\|"yesno"\|"order", value}` |
