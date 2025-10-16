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
  const SUGGEST_LIMIT = 100;
  // Preload buckets once to avoid fetch timing differences (no behavior change)
  (async () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    try { await Promise.all(letters.map(ch => loadBucket(ch))); } catch {}
  })();

  async function loadBucket(ch) {
    const key = (ch || '').toLowerCase();
    if (!key || key.length !== 1) return [];
    if (cache.has(key)) return cache.get(key);
    try {
      const res = await fetch(`./data/ke-${key}.json`, { cache: 'force-cache' });
      if (!res.ok) return [];
      const json = await res.json();
      const arr = Array.isArray(json.items) ? json.items : [];
      cache.set(key, arr);
      return arr;
    } catch (_) {
      return [];
    }
  }

  // NOTE: No global fallback (all.json) — use only the active bucket or inline snippets

  function findAsciiPrefixLeft(line, caret0) {
    let i = caret0 - 1;
    while (i >= 0 && /[A-Za-z]/.test(line[i])) i--;
    return i; // ASCII 以外で止まった位置
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
        range: new monaco.Range(position.lineNumber, leftIdx + 2, position.lineNumber, col0 + 1),
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
      const leftIdx = findAsciiPrefixLeft(line, col0);
      const prefix = line.slice(leftIdx + 1, col0);
      if (!prefix || prefix.length < 2) return { suggestions: [] }; // 2文字以上のみ
      const items = await buildItemsForPrefix(prefix, position, leftIdx, col0);
      return { suggestions: items };
    }
  });

  // エディタ作成
  const editor = monaco.editor.create(document.getElementById('editor'), {
    value: '更bon\n',
    language: 'kanji-esperanto',
    theme: 'vs',
    fontSize: 16,
    minimap: { enabled: false },
    automaticLayout: true
  });

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
  // 変更イベントでの自動サジェストは行わない
});
