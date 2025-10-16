// Monaco AMD loader path
require.config({ paths: { 'vs': 'https://unpkg.com/monaco-editor@0.52.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
  // 言語登録と語境界
  monaco.languages.register({ id: 'kanji-esperanto' });
  monaco.languages.setLanguageConfiguration('kanji-esperanto', {
    wordPattern: /([a-zA-Z]+)|([\u3400-\u9fff々〻]+)/g
  });

  // 遅延読込用のシンプルキャッシュ（先頭文字 → アイテム配列）
  const cache = new Map();
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get('debug') === '1';
  const SUGGEST_LIMIT = 100;

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
      if (DEBUG) console.log('[ke] loaded bucket', key, 'size', arr.length);
      return arr;
    } catch (_) {
      return [];
    }
  }

  let allCache = null;
  async function loadAllIfNeeded() {
    if (allCache) return allCache;
    try {
      const res = await fetch('./all.json', { cache: 'force-cache' });
      if (!res.ok) return null;
      const json = await res.json();
      allCache = Array.isArray(json.items) ? json.items : null;
      if (DEBUG) console.log('[ke] loaded all.json size', allCache?.length || 0);
      return allCache;
    } catch {
      return null;
    }
  }

  function findAsciiPrefixLeft(line, caret0) {
    let i = caret0 - 1;
    while (i >= 0 && /[A-Za-z]/.test(line[i])) i--;
    return i; // ASCII 以外で止まった位置
  }

  monaco.languages.registerCompletionItemProvider('kanji-esperanto', {
    triggerCharacters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    provideCompletionItems: async (model, position) => {
      const line = model.getLineContent(position.lineNumber);
      const col0 = position.column - 1; // 0-based caret index
      const leftIdx = findAsciiPrefixLeft(line, col0);
      const prefix = line.slice(leftIdx + 1, col0);
      if (!prefix || prefix.length < 2) return { suggestions: [] }; // 2文字以上のみ
      const preLower = prefix.toLowerCase();

      let source = [];
      // まずは lazy bucket を試す
      const bucket = await loadBucket(prefix[0]);
      if (bucket && bucket.length) {
        source = bucket;
      } else if (Array.isArray(window.KE_SNIPPETS)) {
        // フォールバック: 直埋めスニペット
        source = window.KE_SNIPPETS;
      }

      let items = source
        .filter(s => s.prefix && String(s.prefix).toLowerCase().startsWith(preLower))
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

      // 追加フォールバック: バケツ内にヒットが無い/少ない場合は all.json を参照
      if (items.length === 0) {
        const all = await loadAllIfNeeded();
        if (Array.isArray(all) && all.length) {
          items = all
            .filter(s => s.prefix && String(s.prefix).toLowerCase().startsWith(preLower))
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
          if (DEBUG) console.log('[ke] all.json fallback hits', items.length, 'for', prefix);
        }
      }

      if (DEBUG) console.log('[ke] prefix', prefix, 'bucket', prefix[0]?.toLowerCase(), 'items', items.length);

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

  // Backspace/Delete 後に候補再表示
  editor.onKeyDown((e) => {
    if (e.keyCode === monaco.KeyCode.Backspace || e.keyCode === monaco.KeyCode.Delete) {
      // 編集反映後にサジェスト再起動
      setTimeout(() => editor.trigger('ke', 'editor.action.triggerSuggest', {}), 0);
    }
  });
});
