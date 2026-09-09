import { readFileSync, writeFileSync } from 'node:fs';

const KEYWORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);
const ATOMS = new Set([')', ']', '"', "'", '`', 'string', 'regex']);
const REGEX_OK_OPS = '=([!&|?,:;{}~^%+-*<>';

function isIdent(ch) { return ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch === '_' || ch === '$'; }

function lineStartOf(src, i) {
  let k = i - 1;
  while (k >= 0 && src[k] !== '\n') k--;
  return k + 1;
}

function canStartRegex(frame) {
  const s = frame.lastSig;
  if (s === 'kw') return true;
  if (s === 'word') return false;
  if (s === '') return true;
  if (ATOMS.has(s)) return false;
  return REGEX_OK_OPS.includes(s);
}

export function stripAllComments(src) {
  let out = '';
  let lineOutStart = 0;
  let i = 0;
  const n = src.length;
  const stack = [{ mode: 'code', expr: false, depth: 0, lastSig: '', word: '' }];
  let removed = 0;
  const top = () => stack[stack.length - 1];

  while (i < n) {
    const f = top();
    const c = src[i];

    if (f.mode === 'str') {
      out += c;
      if (c === '\\') { if (src[i + 1] !== undefined) { out += src[i + 1]; i += 2; continue; } }
      else if (c === f.quote) { stack.pop(); top().lastSig = 'string'; top().word = ''; }
      else if (c === '\n') { lineOutStart = out.length; }
      i++;
      continue;
    }

    if (f.mode === 'tpl') {
      out += c;
      if (c === '\\') { if (src[i + 1] !== undefined) { out += src[i + 1]; i += 2; continue; } }
      else if (c === '`') { stack.pop(); top().lastSig = 'string'; top().word = ''; }
      else if (c === '$' && src[i + 1] === '{') {
        out += '{';
        stack.push({ mode: 'code', expr: true, depth: 0, lastSig: '', word: '' });
        i += 2;
        continue;
      }
      else if (c === '\n') { lineOutStart = out.length; }
      i++;
      continue;
    }

    if (f.expr && c === '}' && f.depth === 0) {
      out += c;
      stack.pop();
      i++;
      continue;
    }
    if (c === '{') { f.depth++; out += c; i++; continue; }
    if (c === '}') { f.depth--; out += c; i++; continue; }

    if (c === '\n') {
      out += c;
      lineOutStart = out.length;
      f.lastSig = ''; f.word = '';
      i++;
      continue;
    }

    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      removed++;
      const before = src.slice(lineStartOf(src, i), i);
      if (/^\s*$/.test(before)) {
        out = out.slice(0, lineOutStart);
        i = j < n ? j + 1 : j;
        if (j < n) lineOutStart = out.length;
      } else {
        out = out.slice(0, lineOutStart) + out.slice(lineOutStart).replace(/\s+$/, '');
        i = j;
      }
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      const close = Math.min(j + 2, n);
      const block = src.slice(i, close);
      if (!block.includes('\n')) {
        removed++;
        const before = src.slice(lineStartOf(src, i), i);
        if (/^\s*$/.test(before)) {
          let k = i;
          while (k < n && src[k] !== '\n') k++;
          out = out.slice(0, lineOutStart);
          i = k < n ? k + 1 : k;
          if (i < n) lineOutStart = out.length;
        } else {
          out = out.slice(0, lineOutStart) + out.slice(lineOutStart).replace(/\s+$/, '');
          i = close;
        }
        continue;
      }
      removed++;
      const before = src.slice(lineStartOf(src, i), i);
      let nl = close;
      while (nl < n && src[nl] !== '\n') nl++;
      const after = src.slice(close, nl);
      const beforeWs = before.trim() === '';
      const afterWs = after.trim() === '';
      if (beforeWs && afterWs) {
        out = out.slice(0, lineOutStart);
        i = nl < n ? nl + 1 : nl;
        if (i < n) lineOutStart = out.length;
      } else if (!beforeWs && !afterWs) {
        const ws = after.match(/^\s*/)[0];
        out = out.slice(0, lineOutStart)
          + out.slice(lineOutStart).replace(/\s+$/, '')
          + (ws || ' ');
        i = close + ws.length;
      } else if (!beforeWs) {
        out = out.slice(0, lineOutStart) + out.slice(lineOutStart).replace(/\s+$/, '');
        if (nl < n) out += '\n';
        i = nl < n ? nl + 1 : nl;
        lineOutStart = out.length;
      } else {
        const ws = after.match(/^\s*/)[0];
        out = out.slice(0, lineOutStart) + ws;
        i = close + ws.length;
      }
      continue;
    }

    if (c === "'" || c === '"') {
      out += c;
      stack.push({ mode: 'str', quote: c });
      f.lastSig = c;
      f.word = '';
      i++;
      continue;
    }
    if (c === '`') {
      out += c;
      stack.push({ mode: 'tpl' });
      f.lastSig = '`';
      f.word = '';
      i++;
      continue;
    }

    if (c === '/') {
      if (f.word) { f.lastSig = KEYWORDS_BEFORE_REGEX.has(f.word) ? 'kw' : 'word'; f.word = ''; }
      let j = -1;
      if (canStartRegex(f)) {
        j = i + 1;
        let inClass = false;
        while (j < n) {
          const rj = src[j];
          if (rj === '\\') { j += 2; continue; }
          if (inClass) { if (rj === ']') inClass = false; }
          else if (rj === '[') { inClass = true; }
          else if (rj === '/') { break; }
          else if (rj === '\n') { break; }
          j++;
        }
        if (!(j < n && src[j] === '/')) j = -1;
      }
      if (j >= 0) {
        out += src.slice(i, j + 1);
        let k = j + 1;
        while (k < n && isIdent(src[k])) { out += src[k]; k++; }
        f.lastSig = 'regex'; f.word = '';
        i = k;
        continue;
      }
    }

    out += c;
    if (isIdent(c)) { f.word += c; }
    else {
      if (f.word) { f.lastSig = KEYWORDS_BEFORE_REGEX.has(f.word) ? 'kw' : 'word'; f.word = ''; }
      if (!/\s/.test(c)) f.lastSig = c;
    }
    i++;
  }

  return { out, removed };
}

if (process.argv[1] && process.argv[1].endsWith('strip-bundle-comments.mjs')) {
  const write = process.argv.includes('--write');
  const files = process.argv.slice(2).filter((a) => a !== '--write');
  let total = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const { out, removed } = stripAllComments(src);
    total += removed;
    if (write && out !== src) writeFileSync(file, out, 'utf8');
    console.log(`${file}  removed=${removed}${write && out !== src ? '  [written]' : out === src ? '  (no change)' : '  [dry-run]'}`);
  }
  console.log(`total removed: ${total}`);
}
