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
  const params = new URLSearchParams(location.search);
  const STRICT = params.get('strict') === '1';
  const STORAGE_KEY = 'ke-doc-v1';
  const HISTORY_KEY = 'ke-doc-hist-v1';
  const HISTORY_LIMIT = 50;

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
    // カーソル直前の連続したアルファベットのみを抽出
    // スペースや漢字の後ろのアルファベットだけを取得
    const left = line.slice(0, caret0);
    const m = left.match(/[A-Za-z]+$/);
    return m ? m[0] : '';
  }

  function currentPrefix(model, position) {
    const line = model.getLineContent(position.lineNumber);
    const col0 = position.column - 1;
    return extractAsciiPrefix(line, col0);
  }

  async function buildItemsForPrefix(prefix, position, col0) {
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
        // 入力したprefixと完全一致する長さを優先してソート
        sortText: ('0'.repeat(10 - Math.abs(String(s.prefix).length - prefix.length)) + (s.sortText || s.prefix))
      }));
    return items;
  }

  // No test hooks or debug endpoints in production — keep behavior minimal/explicit

  function preloadAllBucketsIfStrict() {
    if (!STRICT) return Promise.resolve();
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    return Promise.all(letters.map(ch => loadBucket(ch)));
  }

  function registerProvider() {
    monaco.languages.registerCompletionItemProvider('kanji-esperanto', {
      // 通常入力（a-z）でも補完を自動発火させる
      // onDidType での明示トリガーも併用し、どちらからでも開くように冗長化
      triggerCharacters: 'abcdefghijklmnopqrstuvwxyz'.split(''),
      provideCompletionItems: async (model, position, _context, token) => {
        const line = model.getLineContent(position.lineNumber);
        const col0 = position.column - 1; // 0-based caret index
        const prefix = extractAsciiPrefix(line, col0);
        if (!prefix || prefix.length < 1) return { suggestions: [] }; // 1文字以上で候補
        let items = await buildItemsForPrefix(prefix, position, col0);
        // exact match がある場合はそれだけに限定（ローカル神仕様に寄せる）
        const exact = items.filter(i => i.label && String(i.label).startsWith(prefix + ' '));
        if (exact.length) items = exact;
        // レース防止: 返却直前のプレフィクスが当初と異なる場合は結果を捨てる
        try {
          if (token && token.isCancellationRequested) return { suggestions: [] };
          const nowPrefix = currentPrefix(model, editor.getPosition());
          if (nowPrefix !== prefix) return { suggestions: [] };
        } catch {}
        // まれに辞書ロードの直後で空になる揺らぎに対応（1回だけ待って再試行）
        if (!items.length && inflight.has(prefix[0].toLowerCase())) {
          try { await inflight.get(prefix[0].toLowerCase()); } catch {}
          items = await buildItemsForPrefix(prefix, position, col0);
          const exact2 = items.filter(i => i.label && String(i.label).startsWith(prefix + ' '));
          if (exact2.length) items = exact2;
        }
        return { suggestions: items };
      }
    });
  }

  // エディタ作成
  const host = document.getElementById('editor');
  let extraOpts = {};
  try { extraOpts = JSON.parse(host.getAttribute('data-options') || '{}'); } catch {}
  // 直前の内容を復元（ローカル保存）
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch {}

  const editor = monaco.editor.create(host, Object.assign({
    value: saved || '更bon\n',
    language: 'kanji-esperanto',
    theme: 'vs',
    fontSize: 16,
    minimap: { enabled: false },
    automaticLayout: true,
    suggestOnTriggerCharacters: true
  }, extraOpts));

  // Ctrl+Space で常に候補を表示
  editor.addAction({
    id: 'ke-trigger-suggest',
    label: 'Kanji Esperanto: Trigger Suggest',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
    run: () => editor.trigger('ke', 'editor.action.triggerSuggest', {})
  });

  // ローカル保存 & 履歴（簡易スナップショット）
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  const saveNow = () => {
    try {
      const v = editor.getValue();
      localStorage.setItem(STORAGE_KEY, v);
      let hist = [];
      try { hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch {}
      const last = hist[hist.length - 1];
      if (!last || last.v !== v) {
        hist.push({ t: Date.now(), v });
        if (hist.length > HISTORY_LIMIT) hist = hist.slice(-HISTORY_LIMIT);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
      }
    } catch {}
  };
  const saveDebounced = debounce(saveNow, 300);
  editor.onDidChangeModelContent(saveDebounced);

  editor.addAction({
    id: 'ke-restore-last-snapshot',
    label: 'KE: Restore Last Snapshot',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyR],
    run: () => {
      try {
        const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        const last = hist[hist.length - 1];
        if (last && typeof last.v === 'string') {
          editor.setValue(last.v);
          localStorage.setItem(STORAGE_KEY, last.v);
        }
      } catch {}
    }
  });

  editor.addAction({
    id: 'ke-clear-storage',
    label: 'KE: Clear Local Storage',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Backspace],
    run: () => {
      try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(HISTORY_KEY); } catch {}
    }
  });

  function hideSuggest() {
    try {
      editor.trigger('ke', 'hideSuggestWidget', {});
    } catch {}
    try {
      const c = editor.getContribution && editor.getContribution('editor.contrib.suggestController');
      if (c && typeof c.cancel === 'function') c.cancel();
    } catch {}
  }

  // strict モードは全データ読込後に補完プロバイダを登録（初回から決定的）
  preloadAllBucketsIfStrict().then(registerProvider).catch(registerProvider);

  // Backspace/Delete 後に候補再表示（ローカルに寄せた最小挙動）
  editor.onKeyDown((e) => {
    if (e.keyCode === monaco.KeyCode.Backspace || e.keyCode === monaco.KeyCode.Delete) {
      setTimeout(() => editor.trigger('ke', 'editor.action.triggerSuggest', {}), 0);
    }
    if (e.keyCode === monaco.KeyCode.Space) {
      // 空白入力時は候補を閉じる（次の語根に備えてクリーンな状態へ）
      setTimeout(() => hideSuggest(), 0);
    }
  });
  // 文字入力（a-z）直後にも確実にサジェストを起動（IMEや環境差の影響を避ける）
  editor.onDidType((text) => {
    // スペースが入力されたら即座に候補を閉じて終了
    if (/^\s$/.test(text)) {
      hideSuggest();
      return;
    }
    // a-z以外が入力されたら候補を閉じる
    if (!/^[a-z]$/i.test(text)) {
      hideSuggest();
      return;
    }
    // a-zが入力された場合のみ候補を表示
    try {
      const model = editor.getModel();
      const pos = editor.getPosition();
      const col0 = pos.column - 1;
      const line = model.getLineContent(pos.lineNumber);
      const prefix = extractAsciiPrefix(line, col0);
      if (!prefix) { hideSuggest(); return; }
      const maybe = loadBucket(prefix[0]);
      Promise.resolve(maybe).then(() => {
        // 編集反映後に確実に再トリガー（辞書ロード完了後）
        setTimeout(() => editor.trigger('ke', 'editor.action.triggerSuggest', {}), 0);
      });
    } catch {
      // fallback trigger（失敗時は閉じるより提示を優先）
      setTimeout(() => editor.trigger('ke', 'editor.action.triggerSuggest', {}), 0);
    }
  });
  // 変更イベントでの自動サジェストは行わない
});
