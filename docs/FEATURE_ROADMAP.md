# 🗺️ 機能実装ロードマップ（1機能1セッション進行用）

本プロジェクトでは、コンテキスト溢れを防止し、高品質かつ堅牢な実装を継続するために、**「1つのセッションで1つの独立した機能を集中的に実装・検証する」** 方式を採用しています。

新セッションを開始する際は、該当する機能の「キックオフ指示」をAIエージェントにそのまま貼り付けて開始してください。

---

## 📋 セッション別機能一覧

| # | 機能名 | 主要な価値 | 設計仕様書 | 推奨開始プロンプト |
| :---: | :--- | :--- | :--- | :--- |
| **01** | **SSHリモートエクスプローラ** | FTP未接続でもSSHだけでファイル一覧・ソート・パスコピー・プレビュー・cd連動 | [01_ssh_file_explorer.md](./features/01_ssh_file_explorer.md) | `docs/features/01_ssh_file_explorer.md に従ってFeature 01を実装してください` |
| **02** | **セーフティ・コマンドバー** | 改行コピペ事故防止、確認付き送信、1行ずつステップ実行 | [02_safety_command_bar.md](./features/02_safety_command_bar.md) | `docs/features/02_safety_command_bar.md に従ってFeature 02を実装してください` |
| **03** | **セッション複製＆タブ管理** | 認証情報再入力不要で同ホストに新タブ（別PTY）をワンクリック増殖 | [03_duplicate_session_tabs.md](./features/03_duplicate_session_tabs.md) | `docs/features/03_duplicate_session_tabs.md に従ってFeature 03を実装してください` |
| **04** | **エビデンスコピー＆自動ログ** | 直前コマンド＋出力のMarkdown即時コピー、タイムスタンプ付き自動ローカル保存 | [04_evidence_and_logging.md](./features/04_evidence_and_logging.md) | `docs/features/04_evidence_and_logging.md に従ってFeature 04を実装してください` |
| **05** | **パラメータ付きスニペット** | よく使う調査コマンドの登録・`{{param}}` 穴埋め実行 | [05_snippet_palette.md](./features/05_snippet_palette.md) | `docs/features/05_snippet_palette.md に従ってFeature 05を実装してください` |

---

## 🛠️ 各セッションの共通開発・検証コマンド
```bash
# フロントエンド起動 (確認用)
cd frontend && npm run dev

# Windowsクロスコンパイル検証
cd ..
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o bin/portable-ssh-ftp.exe .
```
