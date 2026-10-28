const INDENT_UNIT = '　';
const PREFIX_RE = /^([ 　\t]*)((?:[・■□●○◆◇※→]|[-*＊](?=[ 　])|(?:\d{1,3}|[０-９]{1,3})[.．)）](?![0-9０-９])|[（(](?:\d{1,3}|[０-９]{1,3})[)）])[ 　]?)?/;
const NUMBER_RE = /^(\d{1,3}|[０-９]{1,3})([.．)）])$/;
const NO_CONTINUE = new Set(['■', '□']);

export const MARKERS = ['・', '■', '1.', '→', '※'];

function toHalfDigits(s) {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

export function parseLine(line) {
  const text = String(line ?? '');
  const m = PREFIX_RE.exec(text);
  const indent = m ? m[1] : '';
  const markerWithSpace = m && m[2] ? m[2] : '';
  const marker = markerWithSpace.trim().replace(/[　]+$/, '');
  return {
    indent,
    marker,
    prefix: indent + markerWithSpace,
    rest: text.slice(indent.length + markerWithSpace.length),
  };
}

export function continuationPrefix(line) {
  const { indent, marker, prefix } = parseLine(line);
  if (!marker) return indent;
  if (NO_CONTINUE.has(marker)) return indent;
  const num = NUMBER_RE.exec(marker);
  if (num) {
    const next = String(Number(toHalfDigits(num[1])) + 1);
    const tail = prefix.slice(indent.length + marker.length);
    return `${indent}${next}${num[2]}${tail}`;
  }
  return prefix;
}

function markerKind(marker) {
  if (!marker) return '';
  if (NUMBER_RE.test(marker) || /^[（(]/.test(marker)) return '1.';
  return marker;
}

export function toggleMarker(line, marker) {
  const { indent, marker: current, rest } = parseLine(line);
  if (current && markerKind(current) === markerKind(marker)) return `${indent}${rest}`;
  const head = marker === '1.' ? '1. ' : marker;
  return `${indent}${head}${rest}`;
}

export function indentLine(line) {
  return INDENT_UNIT + String(line ?? '');
}

export function outdentLine(line) {
  const text = String(line ?? '');
  if (text.startsWith(INDENT_UNIT) || text.startsWith('\t')) return text.slice(1);
  if (text.startsWith('  ')) return text.slice(2);
  if (text.startsWith(' ')) return text.slice(1);
  return text;
}

let measureCtx = null;

function fontOf(node) {
  const cs = getComputedStyle(node);
  return cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

function measure(text, node) {
  if (!text) return 0;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = fontOf(node);
  return measureCtx.measureText(text).width;
}

function lineText(div) {
  return div.textContent.replace(/ /g, ' ');
}

function decorateLine(div) {
  const text = lineText(div);
  const { prefix, marker } = parseLine(text);
  div.classList.add('le-line');
  div.classList.toggle('le-heading', marker === '■' || marker === '□');
  if (div.dataset.prefix === prefix && div.dataset.hang) return;
  div.dataset.prefix = prefix;
  const width = Math.round(measure(prefix, div) * 100) / 100;
  div.dataset.hang = String(width);
  div.style.setProperty('--hang', `${width}px`);
}

export function refreshHangs(container) {
  for (const div of container.querySelectorAll('.le-line')) {
    delete div.dataset.prefix;
    decorateLine(div);
  }
}

function makeLine(text) {
  const div = document.createElement('div');
  div.className = 'le-line';
  if (text) div.textContent = text;
  else div.append(document.createElement('br'));
  return div;
}

export function renderFormatted(text, className = '') {
  const box = document.createElement('div');
  box.className = `le-view ${className}`.trim();
  for (const line of String(text || '').split('\n')) box.append(makeLine(line));
  return box;
}

function lines(root) {
  return Array.from(root.children);
}

function caretInfo(root) {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const all = lines(root);
  const pos = (node, offset) => {
    let line = node;
    while (line && line.parentNode !== root) line = line.parentNode;
    const index = line ? all.indexOf(line) : (offset >= all.length ? all.length - 1 : offset);
    if (!line) return { index: Math.max(0, index), offset: 0 };
    const r = document.createRange();
    r.selectNodeContents(line);
    r.setEnd(node, offset);
    return { index, offset: r.toString().length };
  };
  return { start: pos(range.startContainer, range.startOffset), end: pos(range.endContainer, range.endOffset) };
}

function locate(line, offset) {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let rest = offset;
  let node = walker.nextNode();
  let last = null;
  while (node) {
    const len = node.data.length;
    if (rest <= len) return [node, rest];
    rest -= len;
    last = node;
    node = walker.nextNode();
  }
  if (last) return [last, last.data.length];
  return [line, 0];
}

function setCaret(root, index, offset, endIndex = index, endOffset = offset) {
  const all = lines(root);
  if (!all.length) return;
  const a = all[Math.min(index, all.length - 1)];
  const b = all[Math.min(endIndex, all.length - 1)];
  const range = document.createRange();
  range.setStart(...locate(a, offset));
  range.setEnd(...locate(b, endOffset));
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function exec(command, value) {
  return document.execCommand(command, false, value);
}

export function createLineEditor({ value = '', placeholder = '', label = '', key = '', className = '', onChange } = {}) {
  const root = document.createElement('div');
  root.className = `line-editor ${className}`.trim();
  root.contentEditable = 'true';
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  if (label) root.setAttribute('aria-label', label);
  if (placeholder) root.dataset.placeholder = placeholder;
  if (key) root.dataset.key = key;
  root.spellcheck = false;

  let composing = false;
  let internal = false;
  let savedRange = null;
  let shiftDown = false;

  const getValue = () => lines(root).map(lineText).join('\n');

  const updateEmpty = () => {
    root.classList.toggle('is-empty', getValue() === '');
  };

  const setValue = (text) => {
    root.replaceChildren(...String(text || '').split('\n').map(makeLine));
    updateEmpty();
    if (root.isConnected) refreshHangs(root);
  };

  const normalize = () => {
    const caret = caretInfo(root);
    let changed = false;
    let pending = [];
    const flush = (before) => {
      if (!pending.length) return;
      const div = document.createElement('div');
      div.className = 'le-line';
      root.insertBefore(div, before);
      for (const n of pending) div.append(n);
      pending = [];
      changed = true;
    };
    for (const node of Array.from(root.childNodes)) {
      if (node.nodeType === 1 && node.tagName === 'DIV') {
        flush(node);
        continue;
      }
      if (node.nodeType === 3 && !node.data && !pending.length) {
        node.remove();
        continue;
      }
      pending.push(node);
    }
    flush(null);
    for (const div of lines(root)) {
      for (const el of Array.from(div.querySelectorAll('*'))) {
        if (el.tagName === 'BR') continue;
        el.replaceWith(...el.childNodes);
        changed = true;
      }
      if (div.hasAttribute('style') && !div.style.getPropertyValue('--hang')) {
        div.removeAttribute('style');
        delete div.dataset.prefix;
      }
      if (!div.textContent && !div.querySelector('br')) {
        div.append(document.createElement('br'));
        changed = true;
      }
      if (div.textContent && div.querySelector('br')) {
        for (const br of div.querySelectorAll('br')) br.remove();
        changed = true;
      }
    }
    if (!root.children.length) {
      root.append(makeLine(''));
      changed = true;
    }
    if (changed && caret) setCaret(root, caret.start.index, caret.start.offset, caret.end.index, caret.end.offset);
  };

  const sync = () => {
    if (!composing) {
      normalize();
      for (const div of lines(root)) decorateLine(div);
    }
    updateEmpty();
    if (typeof onChange === 'function') onChange(getValue());
  };

  const currentLine = () => {
    const c = caretInfo(root);
    if (!c) return null;
    const div = lines(root)[c.start.index];
    return div ? { c, div, text: lineText(div) } : null;
  };

  const replacePrefix = (index, oldLen, newPrefix, caret) => {
    const div = lines(root)[index];
    if (!div) return;
    internal = true;
    try {
      setCaret(root, index, 0, index, oldLen);
      if (newPrefix) exec('insertText', newPrefix);
      else if (oldLen) exec('delete');
    } finally {
      internal = false;
    }
    if (caret) {
      const shift = newPrefix.length - oldLen;
      const fix = (o) => (o >= oldLen ? o + shift : Math.min(o, newPrefix.length));
      setCaret(root, caret.start.index, caret.start.index === index ? fix(caret.start.offset) : caret.start.offset,
        caret.end.index, caret.end.index === index ? fix(caret.end.offset) : caret.end.offset);
    }
    sync();
  };

  const transformLines = (fn) => {
    const c = caretInfo(root);
    if (!c) return;
    for (let i = c.start.index; i <= c.end.index; i += 1) {
      const div = lines(root)[i];
      if (!div) continue;
      const text = lineText(div);
      const next = fn(text);
      if (next === text) continue;
      const before = parseLine(text);
      const after = parseLine(next);
      const oldLen = text.length - before.rest.length;
      const newPrefix = next.slice(0, next.length - after.rest.length);
      if (after.rest !== before.rest) continue;
      const caret = caretInfo(root);
      replacePrefix(i, oldLen, newPrefix, caret);
    }
  };

  const newLine = (withPrefix) => {
    const info = currentLine();
    internal = true;
    try {
      if (withPrefix && info) {
        const { marker, rest, indent } = parseLine(info.text);
        const atEnd = info.c.start.offset === info.text.length && info.c.end.index === info.c.start.index;
        if (marker && !rest.trim() && atEnd) {
          internal = false;
          replacePrefix(info.c.start.index, info.text.length, indent, null);
          setCaret(root, info.c.start.index, indent.length);
          return;
        }
        const before = info.text.slice(0, info.c.start.offset);
        const cont = before.length >= parseLine(info.text).prefix.length ? continuationPrefix(info.text) : '';
        exec('insertParagraph');
        if (cont) exec('insertText', cont);
      } else {
        exec('insertParagraph');
      }
    } finally {
      internal = false;
    }
    sync();
  };

  const insertPlain = (text) => {
    const parts = String(text).replace(/\r\n?/g, '\n').split('\n');
    internal = true;
    try {
      parts.forEach((part, i) => {
        if (i > 0) exec('insertParagraph');
        if (part) exec('insertText', part);
      });
    } finally {
      internal = false;
    }
    sync();
  };

  const restoreSelection = () => {
    root.focus({ preventScroll: true });
    if (savedRange && root.contains(savedRange.startContainer)) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
      return;
    }
    const all = lines(root);
    setCaret(root, all.length - 1, lineText(all[all.length - 1] || root).length);
  };

  root.addEventListener('keydown', (e) => {
    shiftDown = e.shiftKey;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      transformLines(e.shiftKey ? outdentLine : indentLine);
    }
  });
  root.addEventListener('keyup', (e) => {
    shiftDown = e.shiftKey;
  });
  root.addEventListener('beforeinput', (e) => {
    if (internal) return;
    const t = e.inputType || '';
    if (t.startsWith('format')) {
      e.preventDefault();
      return;
    }
    if ((t === 'insertParagraph' || t === 'insertLineBreak') && !composing && !e.isComposing) {
      e.preventDefault();
      newLine(t === 'insertParagraph' && !shiftDown);
    }
  });
  root.addEventListener('paste', (e) => {
    e.preventDefault();
    insertPlain(e.clipboardData?.getData('text/plain') || '');
  });
  root.addEventListener('drop', (e) => e.preventDefault());
  root.addEventListener('compositionstart', () => {
    composing = true;
  });
  root.addEventListener('compositionend', () => {
    composing = false;
    sync();
  });
  root.addEventListener('input', (e) => {
    if (internal) return;
    if (e.isComposing) composing = true;
    sync();
  });
  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (sel && sel.rangeCount && root.contains(sel.getRangeAt(0).startContainer)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  });

  const api = {
    getValue,
    setValue,
    focusEnd() {
      savedRange = null;
      restoreSelection();
    },
    insertText(text) {
      if (!text) return;
      if (document.activeElement !== root) restoreSelection();
      insertPlain(text);
    },
    toggleMarker(marker) {
      if (document.activeElement !== root) restoreSelection();
      transformLines((line) => toggleMarker(line, marker));
    },
    indent() {
      if (document.activeElement !== root) restoreSelection();
      transformLines(indentLine);
    },
    outdent() {
      if (document.activeElement !== root) restoreSelection();
      transformLines(outdentLine);
    },
    getCaretOffset() {
      const c = caretInfo(root);
      if (!c) return null;
      const all = lines(root).map(lineText);
      const abs = (p) => all.slice(0, p.index).reduce((n, t) => n + t.length + 1, 0) + p.offset;
      return [abs(c.start), abs(c.end)];
    },
    setCaretOffset(start, end = start) {
      const all = lines(root).map(lineText);
      const rel = (n) => {
        let i = 0;
        while (i < all.length - 1 && n > all[i].length) {
          n -= all[i].length + 1;
          i += 1;
        }
        return [i, Math.min(n, all[i].length)];
      };
      const [si, so] = rel(start);
      const [ei, eo] = rel(end);
      setCaret(root, si, so, ei, eo);
    },
  };
  root.lineEditor = api;
  setValue(value);
  return root;
}

export function initLineEditors() {
  try {
    document.execCommand('defaultParagraphSeparator', false, 'div');
  } catch {}
}
