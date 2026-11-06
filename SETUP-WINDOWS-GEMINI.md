# Help me install "Learning Quiz" on my Windows computer

**Note to the AI assistant reading this:** I'm not technical. Please walk me through installing the app below, **one step at a time**:
- Give me one step per message, in simple words. Wait until I say it worked before going on.
- When I need to type or paste something, put it in its own code block so I can copy it exactly.
- If something goes wrong, ask me to copy the exact text from the screen (or send a screenshot), then use the "If something goes wrong" section below.
- Never ask for my passwords. Signing in to Google happens in my browser, not here.

Everything you need to know is in this document. Start with "Step 1" and tell me what to do.

---

## What we're installing

**Learning Quiz** is a personal study app that runs on my own computer and opens in the web browser. It has quizzes with spaced repetition, an AI teacher that gives lessons, and mock interviews. Its AI is **Google Gemini**, used through Google's free **Gemini CLI** program, which signs in with my Google account. No API key and no payment are needed. A free Google account works. A Google AI Pro subscription on the same account gives higher daily limits.

The setup is one command that does everything:
1. It installs **Node.js** (the engine the app runs on) if it's missing. Windows may ask "Do you want to allow this app to make changes?": click **Yes**.
2. It installs the **Gemini CLI** (`npm install -g @google/gemini-cli`).
3. It downloads the app into `C:\Users\<me>\LearningQuiz`.
4. It puts a **Learning Quiz** shortcut on the desktop.
5. It asks me to **sign in to Gemini with Google** (once).
6. It opens the app in the browser at **http://localhost:4747**.

Needs Windows 10 or 11 and about 10 minutes.

---

## Step 1: Open PowerShell

Press the **Windows key**, type **PowerShell**, and click **Windows PowerShell**. It doesn't need "Run as administrator". A window with a blinking cursor opens.

(Make sure it's PowerShell and not "Command Prompt": the line should start with `PS C:\Users\...`.)

## Step 2: Paste the install command

Copy this line, click inside the PowerShell window, **right-click** to paste (Ctrl+V also works), and press **Enter**:

```powershell
irm https://raw.githubusercontent.com/Matan-Morduch/learning-quiz/main/install-windows.ps1 | iex
```

It prints its progress in blue lines starting with `==>`. Installing Node.js and the Gemini CLI takes a few minutes.

## Step 3: Sign in to Gemini (when the setup asks)

The setup stops and shows these instructions, then press **Enter**:
1. Gemini opens inside the PowerShell window. If it asks whether to **trust the folder**, pick **Trust folder**.
2. Pick **Sign in with Google** (arrow keys, then Enter). The browser opens.
3. Choose the Google account (the one with the Gemini plan, if there is one) and click **Sign in / Allow**.
4. Back in PowerShell, when a box to type in appears, type `/quit` and press **Enter**.

The setup then continues by itself.

## Step 4: The app opens

- A **black window** called "Learning Quiz" opens. **Keep it open** while using the app; closing it stops the app. It can be minimized.
- The browser opens **http://localhost:4747**. The bottom bar should say **Gemini ready**.
- To double-check: click the **gear icon** (top left, next to "Learning Quiz") → **AI** → under Gemini click **Test**. It should answer within a few seconds.

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
| `winget is missing` | Install Node.js by hand: go to https://nodejs.org, click the big **LTS** download button, run the file, click Next until Finish. Then close PowerShell, open it again, and run the Step 2 command again. |
| `node` or `gemini` "is not recognized" after it was installed | Close PowerShell, open a new one, run the Step 2 command again. Already installed parts are skipped. |
| `running scripts is disabled on this system` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer `Y`, then run the Step 2 command again. |
| npm errors like `EACCES`, `EPERM` or network errors | Check the internet connection, close other PowerShell windows, run the Step 2 command again. |
| Sign-in: the browser didn't open | Gemini prints a long link in PowerShell. Copy it into the browser by hand, sign in, then go back to PowerShell. |
| Sign-in fails with a message about `GOOGLE_CLOUD_PROJECT`, or "not eligible" | That Google account is a work or school (Workspace) account. Use a personal Gmail account instead: in the Gemini window type `/auth` to switch accounts. |
| The app says **"Gemini CLI is not signed in"** | In PowerShell run `gemini`, pick **Sign in with Google**, finish in the browser, type `/quit`. Then in the app: gear icon → **AI** → **Check again**. |
| The app says **"Gemini usage limit reached"** | The daily free limit was used up. Wait until tomorrow, or switch to a lighter model: gear icon → **Teacher** → pick **Flash** (or **Flash-Lite**) instead of **Pro**. A Google AI Pro subscription raises the limit. |
| Browser says **"This site can't be reached"** at localhost:4747 | The black window is closed. Double-click **Learning Quiz** on the desktop. |
| Black window says **"Port 4747 is already in use"** | The app is already running in another black window. Just open http://localhost:4747 in the browser. |
| **"Windows protected your PC"** when opening the shortcut | Click **More info** → **Run anyway** (it's the app's start file). |
| A Windows Firewall question about Node.js | Either answer is fine: the app only talks to this computer. |
| Lessons or answers look strange or broken | Gear icon → **Teacher** → try **Pro** (the strongest model) if it was on Flash. |

**What doesn't work on Windows:** the **Labs** (practice terminals), running code inside mock interviews, and voice dictation. Everything else (lessons, quizzes, AI grading, reviews, interviews) works.

**Switching to Claude later:** the app can also use Claude (gear icon → **AI**), with a paid Claude plan. The easiest way to set it up is to run `$env:LQ_AI='claude';` followed by the Step 2 command, all on one line.

**Where things are:**
- The app: `C:\Users\<me>\LearningQuiz`
- My questions and notes: its `Learning` folder (plain text files)
- My progress: its `data` folder

**To uninstall:** delete the `LearningQuiz` folder and the desktop shortcut. To also remove Gemini CLI: `npm uninstall -g @google/gemini-cli`.
