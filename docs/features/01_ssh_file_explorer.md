# 📁 Feature 01: SSHリモートエクスプローラ (SSH-backed File Explorer)

> **セッション目的**: FTPが使えないサーバーでも、SSH接続（ポート22）1本だけでファイルツリー・一覧を表示し、ソート・パスコピー・プレビュー・cd連動を可能にする。

---

## 🎯 このセッションで達成すること
1. **SSH経由のファイル一覧・閲覧APIの実装（Goバックエンド）**:
   - SFTPサブシステム（利用可能な場合）または SSH exec（`ls -la --time-style=+%s` / `head`）による軽量フォールバック。
   - サーバー側に専用デーモン不要で100%動作する仕組み。
2. **モダンなファイルエクスプローラUIの実装（Reactフロントエンド）**:
   - パスパンくずリスト（階層ワープ）。
   - ファイル名・更新日時・サイズによる昇順/降順ソート。
   - ワンクリック「フルパスをクリップボードにコピー」および「ターミナルへパス挿入」。
   - 右クリックまたはボタン「ここで cd」（ターミナルへ `cd <path>` を自動送信）。
   - テキスト・ログファイルのクイックプレビュー（モーダルまたはサイドパネル）。
3. **既存のFTPブラウザとの統合**:
   - 接続状態に応じて「SSH Explorer」または「FTP Explorer」をシームレスに切り替え。

---

## 🏗️ 変更対象ファイル一覧

### バックエンド (Go)
- `internal/ssh/client.go` または `internal/ssh/explorer.go` [NEW]:
  - `ListFiles(path string) ([]FileInfo, error)`: ディレクトリ一覧取得
  - `ReadFileHead(path string, maxBytes int64) (string, error)`: プレビュー用ファイル読み込み
- `internal/api/handler.go`:
  - `GET /api/session/{id}/ssh/files?path=...`: ファイル一覧API
  - `GET /api/session/{id}/ssh/file/view?path=...`: プレビューAPI
- `internal/session/manager.go`:
  - SSHセッションの参照ヘルパー

### フロントエンド (React / TypeScript)
- `frontend/src/components/RemoteExplorer.tsx` [NEW / リファクタ]:
  - `FtpBrowser.tsx` の上位互換となる汎用リモートエクスプローラコンポーネント。
- `frontend/src/components/FilePreviewModal.tsx` [NEW]:
  - ログや設定ファイルの即時プレビュー用モーダル。
- `frontend/src/api/client.ts`:
  - SSHファイル操作APIの追加（`fetchSshFiles`, `viewSshFile`）。
- `frontend/src/App.tsx`:
  - SSH接続時にもエクスプローラペインを表示できるようにレイアウト条件を更新。

---

## 🧪 検証シナリオ
1. SSHのみで接続（FTPなし）。
2. 左ペインにリモートエクスプローラが表示され、ホームディレクトリのファイル一覧が描画される。
3. 更新日時やサイズでソートできる。
4. ファイルをクリックして「パスをコピー」できる。
5. ディレクトリを右クリックして「ここでcd」を押すと、右ペインのSSHターミナルで `cd <dir>` が実行される。
6. `.log` や設定ファイルをダブルクリックして中身がプレビュー表示される。

---

## 🤖 新セッション開始用キックオフ指示（プロンプト）
```markdown
docs/features/01_ssh_file_explorer.md の設計書に従い、
Feature 01: SSHリモートエクスプローラ（SSH-backed File Explorer）の実装を行ってください。
FTPが未接続でもSSH接続だけでファイルツリー一覧・ソート・パスコピー・プレビュー・cd連動が動くようにし、動作確認とビルド検証まで完了させてください。
```
