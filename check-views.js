#!/usr/bin/env node
// Smoke-test answer visuals without a browser.
//   node Learning/_quiz/check-views.js              → every view in views/, with {} input
//   node Learning/_quiz/check-views.js --questions  → also every dv.view(...) call in question files, with its real input
// Each view runs against a permissive fake DOM: this catches syntax errors, typos and
// crashes during the first render. It can't tell you whether it *looks* right.

const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, 'views');
const { LEARNING_DIR: LEARNING } = require('./config');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// A value that tolerates any property access, call, construction or arithmetic.
function fake() {
  const store = {};
  const target = function () {};
  return new Proxy(target, {
    get(_, p) {
      if (p === Symbol.toPrimitive) return (hint) => (hint === 'string' ? '' : 0);
      if (p === Symbol.iterator) return function* () {};
      if (p === 'then') return undefined; // not a promise
      if (p === 'isConnected') return false; // lets timers/animation loops stop themselves
      if (p === 'length' || p === 'width' || p === 'height' || p === 'clientWidth' || p === 'offsetWidth') return 300;
      if (p in store) return store[p];
      return (store[p] = fake());
    },
    set(_, p, v) { store[p] = v; return true; },
    apply() { return fake(); },
    construct() { return fake(); },
  });
}

function sandbox() {
  const g = {
    document: fake(),
    window: fake(),
    performance: { now: () => 0 },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    getComputedStyle: () => fake(),
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  return g;
}

async function runView(name, input) {
  const file = path.join(VIEWS, `${name}.js`);
  if (!fs.existsSync(file)) throw new Error(`missing views/${name}.js`);
  const code = fs.readFileSync(file, 'utf8');
  const g = sandbox();
  const names = Object.keys(g);
  const fn = new AsyncFunction('dv', 'input', ...names, code);
  await fn({ container: fake() }, input, ...names.map((k) => g[k]));
}

function viewCallsInQuestions() {
  const calls = [];
  for (const subject of fs.readdirSync(LEARNING)) {
    const qDir = path.join(LEARNING, subject, 'Questions');
    if (!fs.existsSync(qDir)) continue;
    for (const f of fs.readdirSync(qDir).filter((f) => f.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(qDir, f), 'utf8');
      for (const m of text.matchAll(/dv\.view\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*([^\n]*?))?\)\s*;?\s*$/gm)) {
        calls.push({ where: `${subject}/Questions/${f}`, name: m[1].split('/').pop(), inputSrc: (m[2] || '{}').trim(), path: m[1] });
      }
    }
  }
  return calls;
}

// Replays how the quiz app (index.html) turns an embed into HTML and back: parseView → esc() into a
// data-input="..." attribute → browser decodes the attribute → input is evaluated. Catches escaping bugs.
function quizAppRoundTrip(call) {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const grab = (name) => html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
  const { esc, parseView } = new Function(`${grab('esc')}\n${grab('parseView')}\nreturn { esc, parseView };`)();
  const view = parseView(`await dv.view("${call.path}", ${call.inputSrc})`);
  if (!view) throw new Error('quiz app could not parse this embed');
  const attr = `<div data-input="${esc(view.input)}">`.match(/data-input="([^"]*)"/)[1];
  const decoded = attr.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  if (decoded !== view.input) throw new Error(`quiz app mangles the input: got ${decoded}`);
  return new Function(`return (${decoded});`)();
}

(async () => {
  let failed = 0;
  const views = fs.readdirSync(VIEWS).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));
  for (const name of views) {
    try { await runView(name, {}); console.log(`ok    view ${name}`); }
    catch (e) { failed++; console.log(`FAIL  view ${name}: ${e.message}`); }
  }
  if (process.argv.includes('--questions')) {
    for (const c of viewCallsInQuestions()) {
      try {
        if (!c.path.startsWith('Learning/_quiz/views/')) throw new Error(`path must start with Learning/_quiz/views/ (got ${c.path})`);
        const input = new Function(`return (${c.inputSrc});`)();
        quizAppRoundTrip(c);
        await runView(c.name, input);
        console.log(`ok    ${c.where} → ${c.name} ${c.inputSrc}`);
      } catch (e) { failed++; console.log(`FAIL  ${c.where} → ${c.name} ${c.inputSrc}: ${e.message}`); }
    }
  }
  console.log(failed ? `\n${failed} failure(s)` : '\nall good');
  process.exit(failed ? 1 : 0);
})();
