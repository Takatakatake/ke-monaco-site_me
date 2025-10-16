# ke-monaco-site

Monaco Editor を使った「漢字化エスペラント」最小デモサイト。URL 一発で `更bon` → 「好」の入力体験を提供します。大辞書は分割＆遅延読み込み対応。

## 使い方（ローカル）
1. このフォルダを静的ホスティングで配信するか、簡易サーバで開きます。
   - 例: `python3 -m http.server -d ke-monaco-site 5173`
   - 例: `npx serve ke-monaco-site`
2. ブラウザで `http://localhost:5173/` を開く（初回から決定的にするには `?strict=1` を付与: `http://localhost:5173/?strict=1`）。
3. エディタに `更bon` と入力 → 候補「好」が表示。Enter で確定。

## フォルダ構成
```
ke-monaco-site/
├─ index.html       # 画面と Monaco ローダ
├─ app.js           # 言語登録・補完・キーバインド
├─ ke-snippets.js   # 小規模辞書（直埋め）
├─ data/            # 大辞書用の分割 JSON（任意）
└─ tools/           # 大辞書を分割する補助スクリプト
```

## 大辞書（分割・遅延読込）
- `data/ke-a.json`, `data/ke-b.json`, ... に `{ items: [{ prefix, body, detail? }] }` 形式で保存。
- `app.js` が先頭文字のバケツのみ `fetch()` し、キャッシュします。
- 1文字未満では補完を出さないため、体感を軽く保ちます（ローカル仕様に合わせて 1 文字から候補を出します）。

分割支援:
```
node tools/split-dictionary.mjs ./all.json ./data
```

`.ke.txt` からの変換（例）:
```
node tools/ke-txt-to-all.mjs /path/to/dictionary.ke.txt ./all.json
node tools/split-dictionary.mjs ./all.json ./data
```

`all.json` 例:
```json
{ "items": [ { "prefix": "bon", "body": "好", "detail": "bon → 好" } ] }
```

## デプロイ手順
### GitHub Pages（簡単）
1. GitHub 上の `ke-monaco-site` リポに、このフォルダの中身を配置。
2. Settings → Pages → Source: `Deploy from a branch`、Branch: `main` を選び保存。
3. 公開 URL 例: `https://<user>.github.io/ke-monaco-site/`

Actions による自動デプロイ（同梱）:
- `.github/workflows/pages.yml` を同梱しています。`main` に push すると自動で Pages に公開されます。

### Vercel / Cloudflare Pages（CDN）
- リポを import → Build Command/Output Directory は空欄（静的サイト）。
- 即時デプロイ＋カスタムドメインも簡単です。

## 仕様のポイント
- Monaco worker は data URL で自己完結（CDN 金輪際に依存、サーバ側設定不要）
- `wordPattern` は ASCII 語根と CJK(々/〻) の語境界を想定
- Backspace/Delete 後に候補を自動再表示、Ctrl+Space で強制表示
- 大辞書は 1 文字バケツで遅延読込（更に大規模なら 2 文字バケツや Trie を検討）

## ライセンス
- Monaco Editor: MIT（© Microsoft）
- 本テンプレート: MIT
- 辞書データの著作権/ライセンスは同梱ファイルや README に明記してください（例: CC BY-SA）。
