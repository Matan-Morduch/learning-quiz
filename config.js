// Where things live, shared by every server module. All optional: with no env set, the app behaves
// as it always did on the Mac (Learning folder = the parent of _quiz, claude on PATH, localhost only).
//   QUIZ_LEARNING_DIR  the vault's Learning folder (default: the folder above this checkout). "~/" is expanded,
//                      since systemd's Environment= doesn't do it.
//   QUIZ_CLAUDE_BIN    the Claude Code CLI (default: `claude` on PATH, else ~/.local/bin/claude and the other
//                      usual install spots: a systemd service gets a minimal PATH).
//   QUIZ_HOST          the address the standalone server binds (default 127.0.0.1).
const fs = require('fs');
const os = require('os');
const path = require('path');

const expandHome = (p) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

const LEARNING_DIR = process.env.QUIZ_LEARNING_DIR
  ? path.resolve(expandHome(process.env.QUIZ_LEARNING_DIR))
  : path.resolve(__dirname, '..');

const HOST = process.env.QUIZ_HOST || '127.0.0.1';

function isExec(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; }
}

// First executable `name` on PATH, then in `extra` dirs. A name with a slash is checked as given.
function findBin(name, extra = []) {
  if (name.includes('/') || name.includes(path.sep)) return isExec(name) ? name : null;
  const dirs = [...(process.env.PATH || '').split(path.delimiter).filter(Boolean), ...extra];
  // Windows: `gemini` is gemini.cmd, `claude` is claude.exe (npm's extensionless shim next to them is for Git Bash).
  const exts = process.platform === 'win32' ? [...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean).map((x) => x.toLowerCase()), ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (isExec(p)) return p;
    }
  }
  return null;
}

const CLAUDE_DIRS = [
  path.join(os.homedir(), '.local', 'bin'),            // the native installer (Linux and Mac)
  path.join(os.homedir(), '.claude', 'local'),         // older "local" installs
  path.join(os.homedir(), '.npm-global', 'bin'),
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
];
// Resolved once at startup. Not found: plain 'claude', so spawn fails the way it always did and
// isAvailable() reports false.
const CLAUDE_BIN = process.env.QUIZ_CLAUDE_BIN
  ? expandHome(process.env.QUIZ_CLAUDE_BIN)
  : findBin('claude', CLAUDE_DIRS) || 'claude';

// path.relative with "/" on every OS: question files, ids and links use "/" (Windows' path.relative gives "\\").
const posixRel = (from, to) => path.relative(from, to).split(path.sep).join('/');

module.exports = { LEARNING_DIR, HOST, CLAUDE_BIN, findBin, isExec, expandHome, posixRel };
