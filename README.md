# LINE LIFF 仮予約システム

LINE LIFF で動作する歯科・クリニック向けの仮予約 Web フォームです。
GitHub Pages（静的 HTML）＋ Google Apps Script（バックエンド）の構成で、ビルド不要で動作します。

---

## 構成

```
liff-reservation/
├── index.html          # LIFF フォーム（GitHub Pages 配信）
├── gas/
│   ├── main.gs         # GAS バックエンド
│   ├── appsscript.json # GAS マニフェスト
│   └── .clasp.json     # clasp 設定（.gitignore 対象）
└── README.md
```

---

## セットアップ手順

### 1. スプレッドシートの準備

1. Google スプレッドシート（ID: `1ZbYP9a2Ff8yxoGPeWEpB77Pi-AHIJASs7LZU2wylHGU`）を開く
2. GAS エディタで `gas/main.gs` をコピー＆ペーストし、`setupSpreadsheet()` を1回実行
   → `clinics` シート・`reservations` シートとヘッダーが自動作成されます

### 2. GAS スクリプトプロパティの設定

GAS エディタ → [プロジェクトの設定] → [スクリプトプロパティ] に以下を追加:

| プロパティ名 | 値 |
|---|---|
| `SPREADSHEET_ID` | `1ZbYP9a2Ff8yxoGPeWEpB77Pi-AHIJASs7LZU2wylHGU` |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE チャネルのアクセストークン |
| `ADMIN_EMAIL` | 予約通知を受け取るメールアドレス |

### 3. GAS ウェブアプリをデプロイ

1. GAS エディタ → [デプロイ] → [新しいデプロイ]
2. 種類: **ウェブアプリ**
3. 実行ユーザー: **自分**
4. アクセスできるユーザー: **全員（匿名を含む）**
5. デプロイ → **ウェブアプリ URL をコピー**

### 4. LIFF アプリの作成

1. [LINE Developers Console](https://developers.line.biz/) でチャネル（Messaging API）を作成
2. LIFF タブ → LIFF アプリを追加
   - サイズ: `Full`
   - エンドポイント URL: `https://あなたのGitHubPages URL/index.html`
3. **LIFF ID をコピー**

### 5. index.html の設定を書き換え

`index.html` 冒頭の CONFIG を編集:

```js
const CONFIG = {
  LIFF_ID      : '1234567890-abcdefgh',        // ← LIFF ID に書き換え
  GAS_ENDPOINT : 'https://script.google.com/macros/s/xxxxx/exec', // ← GAS URL に書き換え
};
```

### 6. GitHub Pages で公開

```bash
git add .
git commit -m "initial commit"
git push origin main
```

GitHub リポジトリ設定 → Pages → Source: `main` ブランチ の `/ (root)` を選択

### 7. LIFF からアクセス

```
https://liff.line.me/{LIFF_ID}?clinic_id=clinic001
```

---

## clinics シートの列仕様

| 列名 | 内容 | 例 |
|---|---|---|
| `clinic_id` | 医院ID（一意） | `clinic001` |
| `name` | 医院名 | `サンプル歯科` |
| `address` | 住所 | `東京都渋谷区…` |
| `phone` | 電話番号 | `03-1234-5678` |
| `hp_url` | ホームページURL | `https://example.com` |
| `closed_days` | 休診曜日（0=日〜6=土）カンマ区切り | `0,6` |
| `schedule` | 診療時間 `開始-終了` カンマ区切り（昼休み対応） | `9:00-13:00,14:30-19:00` |
| `treatments` | 診療科目コード カンマ区切り | `general,preventive,other` |

### 診療科目コード

| コード | 表示名 |
|---|---|
| `general` | 一般診療 |
| `preventive` | 予防・クリーニング |
| `orthodontics` | 矯正歯科 |
| `oral_surgery` | 口腔外科 |
| `pediatric` | 小児歯科 |
| `whitening` | ホワイトニング |
| `implant` | インプラント |
| `other` | その他 |

---

## clasp でのデプロイ（任意）

```bash
npm install -g @google/clasp
clasp login
cd gas
# gas/.clasp.json の scriptId を実際のスクリプトIDに書き換え
clasp push
```

---

## 注意事項

- `gas/.clasp.json` にはスクリプト ID が含まれるため `.gitignore` 対象にしています
- `.clasprc.json`（認証情報）は絶対にコミットしないでください
- LINE チャネルアクセストークンは GAS スクリプトプロパティで管理し、ソースコードに直接書かないでください
