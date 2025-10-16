// Monaco AMD loader path
require.config({ paths: { 'vs': 'https://unpkg.com/monaco-editor@0.52.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
  // 言語登録と語境界
  monaco.languages.register({ id: 'kanji-esperanto' });
  monaco.languages.setLanguageConfiguration('kanji-esperanto', {
    // No global flag to avoid stateful RegExp interactions
    wordPattern: /([a-zA-Z]+)|([\u3400-\u9fff々〻]+)/
  });

  // 遅延読込用のシンプルキャッシュ（先頭文字 → アイテム配列）
  const cache = new Map();
  const inflight = new Map();
  const SUGGEST_LIMIT = 100;

  async function loadBucket(ch) {
    const key = (ch || '').toLowerCase();
    if (!key || key.length !== 1) return [];
    if (cache.has(key)) return cache.get(key);
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const url = `./data/ke-${key}.json`;
        let res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) {
          // one retry with cache busting to avoid transient 404/opaque
          res = await fetch(url + `?v=${Date.now()}`);
        }
        if (!res.ok) return [];
        const json = await res.json();
        const arr = Array.isArray(json.items) ? json.items : [];
        cache.set(key, arr);
        return arr;
      } catch {
        return [];
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  // NOTE: No global fallback (all.json) — use only the active bucket or inline snippets

  function extractAsciiPrefix(line, caret0) {
    // 直前の ASCII 連続語を厳格に抽出（実装差異や IME の影響を最小化）
    const left = line.slice(0, caret0);
    const m = left.match(/[A-Za-z]{2,}$/);
    return m ? m[0] : '';
  }

  async function buildItemsForPrefix(prefix, position, leftIdx, col0) {
    let source = [];
    const bucket = await loadBucket(prefix[0]);
    if (bucket && bucket.length) {
      source = bucket;
    } else if (Array.isArray(window.KE_SNIPPETS)) {
      source = window.KE_SNIPPETS;
    }

    let items = source
      .filter(s => s.prefix && String(s.prefix).startsWith(prefix))
      .slice(0, SUGGEST_LIMIT)
      .map(s => ({
        label: (s.label || (s.prefix + ' → ' + s.body)),
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: s.body,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range: new monaco.Range(position.lineNumber, col0 - prefix.length + 1, position.lineNumber, col0 + 1),
        detail: s.detail || '',
        documentation: s.documentation || undefined,
        sortText: ('0' + (s.sortText || s.prefix))
      }));
    return items;
  }

  // No test hooks or debug endpoints in production — keep behavior minimal/explicit

  monaco.languages.registerCompletionItemProvider('kanji-esperanto', {
    triggerCharacters: 'abcdefghijklmnopqrstuvwxyz'.split(''),
    provideCompletionItems: async (model, position) => {
      const line = model.getLineContent(position.lineNumber);
      const col0 = position.column - 1; // 0-based caret index
      const prefix = extractAsciiPrefix(line, col0);
      if (!prefix || prefix.length < 2) return { suggestions: [] }; // 2文字以上のみ
      const items = await buildItemsForPrefix(prefix, position, col0 - prefix.length - 1, col0);
      return { suggestions: items };
    }
  });

  // エディタ作成
  const host = document.getElementById('editor');
  let extraOpts = {};
  try { extraOpts = JSON.parse(host.getAttribute('data-options') || '{}'); } catch {}
  const editor = monaco.editor.create(host, Object.assign({
    value: '更bon\n',
    language: 'kanji-esperanto',
    theme: 'vs',
    fontSize: 16,
    minimap: { enabled: false },
    automaticLayout: true
  }, extraOpts));

  // Ctrl+Space で常に候補を表示
  editor.addAction({
    id: 'ke-trigger-suggest',
    label: 'Kanji Esperanto: Trigger Suggest',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
    run: () => editor.trigger('ke', 'editor.action.triggerSuggest', {})
  });

  // Backspace/Delete 後に候補再表示（ローカルに寄せた最小挙動）
  editor.onKeyDown((e) => {
    if (e.keyCode === monaco.KeyCode.Backspace || e.keyCode === monaco.KeyCode.Delete) {
      setTimeout(() => editor.trigger('ke', 'editor.action.triggerSuggest', {}), 0);
    }
  });
  // 文字入力（a-z）直後にも確実にサジェストを起動（IMEや環境差の影響を避ける）
  editor.onDidType((text) => {
    if (/^[a-z]$/.test(text)) {
      try {
        const model = editor.getModel();
        const pos = editor.getPosition();
        const col0 = pos.column - 1;
        // 直近の ASCII 連続語（1文字以上）
        const left = model.getLineContent(pos.lineNumber).slice(0, col0);
        const m = left.match(/[A-Za-z]+$/);
        const seg = m ? m[0] : '';
        if (seg) {
          // 先頭文字のバケツを先行ロード（次キーで遅延無しに）
          loadBucket(seg[0]);
        }
      } catch {}
      // 編集反映後にサジェスト起動
      setTimeout(() => editor.trigger('ke', 'editor.action.triggerSuggest', {}), 0);
    }
  });
  // 変更イベントでの自動サジェストは行わない
});
