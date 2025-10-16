// CodeMirror 6 minimal editor with Kanji Esperanto completions
import {EditorState} from 'https://esm.sh/@codemirror/state@6.4.1';
import {EditorView, keymap} from 'https://esm.sh/@codemirror/view@6.34.1';
import {defaultKeymap, history, historyKeymap} from 'https://esm.sh/@codemirror/commands@6.5.0';
import {autocompletion, startCompletion, closeCompletion, completionKeymap} from 'https://esm.sh/@codemirror/autocomplete@6.13.3';

const STORAGE_KEY = 'ke-cm-doc-v1';
const HISTORY_KEY  = 'ke-cm-hist-v1';
const HISTORY_LIMIT = 50;
const SUGGEST_LIMIT = 100;

function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), ms); }; }

// Load dictionary (all.json) from parent folder
async function loadDictionary(){
  try {
    const res = await fetch('../all.json', {cache: 'force-cache'});
    const json = await res.json();
    const items = Array.isArray(json.items) ? json.items : [];
    // Build buckets by first letter for quick filter
    const buckets = new Map();
    for (const it of items){
      const k = (it.prefix?.[0] || '#').toLowerCase();
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(it);
    }
    for (const [,arr] of buckets){
      arr.sort((a,b)=> String(a.prefix).localeCompare(String(b.prefix)));
    }
    return {items, buckets};
  } catch {
    return {items: [], buckets: new Map()};
  }
}

// Extract ASCII root before caret; allow single spaces inside and normalize
function extractPrefix(state, pos){
  const line = state.doc.lineAt(pos);
  const left = line.text.slice(0, pos - line.from);
  const m = left.match(/[A-Za-z](?:\s?[A-Za-z])*$/);
  if (!m) return {raw:'', norm:'', from: pos};
  const raw = m[0];
  const norm = raw.replace(/\s+/g, '');
  // compute logical start index ignoring spaces (walk back until norm length consumed)
  let need = norm.length;
  let i = left.length;
  while (i > 0 && need > 0){
    i--;
    const ch = left[i];
    if (/\s/.test(ch)) continue;
    if (/[A-Za-z]/.test(ch)) need--;
    else break;
  }
  const from = line.from + i + 1;
  return {raw, norm, from};
}

const dict = await loadDictionary();

// Completion source
function keComplete(ctx){
  const {norm, from} = extractPrefix(ctx.state, ctx.pos);
  if (!norm || norm.length < 1) return null;
  const bucket = dict.buckets.get(norm[0].toLowerCase()) || [];
  const options = bucket
    .filter(s => s.prefix && String(s.prefix).startsWith(norm))
    .slice(0, SUGGEST_LIMIT)
    .map(s => ({
      label: (s.prefix + ' → ' + s.body),
      type: 'text',
      apply: s.body
    }));
  if (!options.length) return null;
  return {
    from,
    options,
    // Keep active while user refines ASCII root
    validFor: /[A-Za-z\s]*/
  };
}

// Save & history
function buildPersistence(){
  const onChange = debounce((v) => {
    try {
      localStorage.setItem(STORAGE_KEY, v);
      let hist = [];
      try { hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch {}
      const last = hist[hist.length - 1];
      if (!last || last.v !== v){
        hist.push({t: Date.now(), v});
        if (hist.length > HISTORY_LIMIT) hist = hist.slice(-HISTORY_LIMIT);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
      }
    } catch {}
  }, 250);
  return EditorView.updateListener.of(update => {
    if (update.docChanged) onChange(update.state.doc.toString());
  });
}

// Auto trigger completion on insert/delete
const autoTrigger = EditorView.updateListener.of(update => {
  if (!update.docChanged) return;
  // Close on whitespace-only changes to avoid stale list, then reopen
  const pos = update.state.selection.main.from;
  if (pos <= 0) { startCompletion(update.view); return; }
  const text = update.state.sliceDoc(pos - 1, pos);
  if (/^\s$/.test(text)) { closeCompletion(update.view); return; }
  startCompletion(update.view);
});

// Load initial text
let initial = 'Kiam Okcidento renkontas Orienton kaj surmetis orientan vestaĵon, unu lingvo nun havas du aspektons - ambaŭ belaj, nova kompreno naskiĝas.\n何时 西o 遇as 东方on 和 上置is 东方an 服物on, 一 语o 今 有as 二 观ojn - 两 美aj, 新a 懂o 生成as.\n';
try { initial = localStorage.getItem(STORAGE_KEY) || initial; } catch {}

const view = new EditorView({
  state: EditorState.create({
    doc: initial,
    extensions: [
      history(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        { key: 'Mod-Alt-r', run: (view)=>{
            try {
              const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
              const last = hist[hist.length - 1];
              if (last && typeof last.v === 'string') {
                view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: last.v}});
                return true;
              }
            } catch {}
            return false;
          }
        },
        { key: 'Mod-Alt-Backspace', run: ()=>{ try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(HISTORY_KEY);} catch{} return true; } }
      ]),
      autocompletion({override: [keComplete], defaultKeymap: true, activateOnTyping: true}),
      autoTrigger,
      buildPersistence()
    ]
  }),
  parent: document.getElementById('editor')
});

// Focus the editor for immediate typing
setTimeout(()=> view.focus(), 0);
