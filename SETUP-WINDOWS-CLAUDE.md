# Help me install "Learning Quiz" (with Claude) on my Windows computer

**Note to the AI assistant reading this:** I'm not technical. Please walk me through installing the app below, **one step at a time**:
- Give me one step per message, in simple words. Wait until I say it worked before going on.
- When I need to type or paste something, put it in its own code block so I can copy it exactly.
- If something goes wrong, ask me to copy the exact text from the screen (or send a screenshot), then use the "If something goes wrong" section below.
- Never ask for my passwords. Signing in to Claude happens in my browser, not here.

Everything you need to know is in this document. Start with "Step 1" and tell me what to do.

---

## What we're installing

**Learning Quiz** is a personal study app that runs on my own computer and opens in the web browser. It has quizzes with spaced repetition, an AI teacher that gives lessons, and mock interviews. Its AI is **Claude**, used through Anthropic's **Claude Code** program, which signs in with my Claude account. **This needs a paid Claude plan (Pro or Max)**; the app uses that plan, so no API key or extra payment is needed.

The setup is one command that does everything:
1. It installs **Node.js** (the engine the app runs on) if it's missing. Windows may ask "Do you want to allow this app to make changes?": click **Yes**.
2. It installs **Git for Windows** (Claude Code needs it) if it's missing. Again, click **Yes** if Windows asks.
3. It installs **Claude Code** (from claude.ai).
4. It downloads the app into `C:\Users\<me>\LearningQuiz`.
5. It puts a **Learning Quiz** shortcut on the desktop.
6. It asks me to **sign in to Claude** (once).
7. It opens the app in the browser at **http://localhost:4747**.

Needs Windows 10 or 11 and about 10 minutes.

---

## Step 1: Open PowerShell

Press the **Windows key**, type **PowerShell**, and click **Windows PowerShell**. It doesn't need "Run as administrator". A window with a blinking cursor opens.

(Make sure it's PowerShell and not "Command Prompt": the line should start with `PS C:\Users\...`.)

## Step 2: Paste the install command

Copy this line, click inside the PowerShell window, **right-click** to paste (Ctrl+V also works), and press **Enter**:

```powershell
$env:LQ_AI='claude'; irm https://raw.githubusercontent.com/Matan-Morduch/learning-quiz/main/install-windows.ps1 | iex
```

It prints its progress in blue lines starting with `==>`. Installing everything takes a few minutes.

## Step 3: Sign in to Claude (when the setup asks)

The setup stops and shows these instructions, then press **Enter**:
1. Claude Code opens inside the PowerShell window. Press **Enter** to accept the text style it suggests.
2. Pick **Claude account with subscription** (arrow keys, then Enter). The browser opens.
3. Sign in to claude.ai in the browser and click **Authorize**.
4. Back in PowerShell, press **Enter** through any notes. If it asks whether to trust the folder, pick **Yes**.
5. When a box to type in appears, type `/exit` and press **Enter**.

The setup checks that Claude answers, then continues by itself.

## Step 4: The app opens

- A **black window** called "Learning Quiz" opens. **Keep it open** while using the app; closing it stops the app. It can be minimized.
- The browser opens **http://localhost:4747**. The bottom bar should say **Claude ready**.
- To double-check: click the **gear icon** (top left, next to "Learning Quiz") → **AI** → under Claude click **Test**. It should answer within a few seconds.

## Step 5: Start learning

- **Home → "Start a lesson"**: type a topic (for example "how does the internet work") and click **Start lesson**. The AI teacher asks a few questions first, then teaches step by step.
- At the end of a lesson the teacher offers to **save questions**. Those become quizzes, and **Quick review** brings them back at the right time (spaced repetition).
- **To Learn**: a list of topics to learn next. **Interview**: mock interviews with an AI interviewer.
- The app starts empty: all questions come from lessons.

## Every day after that

- Double-click **Learning Quiz** on the desktop. The black window opens, then the app in the browser.
- **To update** the app: open PowerShell and run the same command from Step 2 again. My progress and questions are kept.

---

## If something goes wrong (for the AI assistant)

| What the screen says | What to do |
|---|---|
| `irm : The term 'irm' is not recognized` or `'irm' is not recognized as an internal or external command` | This is Command Prompt, not PowerShell. Close it and do Step 1 again. |
| A red line starting with `STOPPED:` | The setup explains the problem in that line. Do what it says (usually: close PowerShell, open it again, run the Step 2 command again). |
| `winget is missing` | Install the missing program by hand. **Node.js:** https://nodejs.org, click the big **LTS** button, run the file, Next until Finish. **Git:** https://git-scm.com/download/win, run the file, Next until Finish. Then close PowerShell, open it again, and run the Step 2 command again. |
| `node`, `git` or `claude` "is not recognized" after it was installed | Close PowerShell, open a new one, run the Step 2 command again. Already installed parts are skipped. |
| `running scripts is disabled on this system` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer `Y`, then run the Step 2 command again. |
| `STOPPED: Claude does not answer yet` | Either the sign-in didn't finish, or the Claude account is on the free plan (Claude Code needs Pro or Max). Check the plan at claude.ai → Settings → Billing, then run the Step 2 command again. |
| Sign-in: the browser didn't open | Claude Code prints a long link in PowerShell. Copy it into the browser by hand, sign in, and paste the code it shows back into PowerShell. |
| Claude Code says it needs **Git Bash** | Git for Windows is missing or not found. Install it from https://git-scm.com/download/win, then close PowerShell, open a new one, and run the Step 2 command again. |
| The app says **"Claude Code CLI not found"** | Claude Code was installed after the app started. Close the black window and double-click **Learning Quiz** again. |
| The app shows errors saying Claude is **not logged in** | In PowerShell run `claude`, type `/login`, finish in the browser, then type `/exit`. |
| The app says Claude hit a **usage limit** | The Claude plan's limit for the current few hours was used up. Wait a while, or use a lighter model: gear icon → **Teacher** → pick **Sonnet** or **Haiku** instead of **Opus**. |
| Browser says **"This site can't be reached"** at localhost:4747 | The black window is closed. Double-click **Learning Quiz** on the desktop. |
| Black window says **"Port 4747 is already in use"** | The app is already running in another black window. Just open http://localhost:4747 in the browser. |
| **"Windows protected your PC"** when opening the shortcut | Click **More info** → **Run anyway** (it's the app's start file). |
| A Windows Firewall question about Node.js | Either answer is fine: the app only talks to this computer. |

**What doesn't work on Windows:** the **Labs** (practice terminals), running code inside mock interviews, and voice dictation. Everything else (lessons, quizzes, AI grading, reviews, interviews) works.

**Switching to Gemini later:** the app can also use Google Gemini (gear icon → **AI**). The easiest way to set it up is to run the Step 2 command with `'gemini'` instead of `'claude'`.

**Where things are:**
- The app: `C:\Users\<me>\LearningQuiz`
- My questions and notes: its `Learning` folder (plain text files)
- My progress: its `data` folder

**To uninstall:** delete the `LearningQuiz` folder and the desktop shortcut. Claude Code can stay (it's a normal program from Anthropic).
