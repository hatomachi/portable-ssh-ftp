# 📑 Feature 03: セッション複製 ＆ タブ管理 (Duplicate Session & Tabs)

> **セッション目的**: 接続済みのセッション情報（ホスト・ポート・ユーザー・認証情報）を再利用し、ワンクリックで同じホストに新規タブを開いて並行作業（ログ監視＋操作）を可能にする。

---

## 🎯 このセッションで達成すること
1. **バックエンドでの接続プロファイル保持と複製API**:
   - 既存セッションの接続パラメータから新規セッション（別PTY）を即座に生成する `POST /api/session/{id}/duplicate` の実装。
2. **フロントエンドでのタブ管理UI**:
   - ヘッダーまたはターミナル上部にタブバー（`[Session 1: web01] [+]`）を配置。
   - `+` または「複製」アイコンで同サーバーの別タブを瞬時に生成。
   - タブごとのセッション独立管理と切り替え。

---

## 🏗️ 変更対象ファイル一覧

### バックエンド (Go)
- `internal/session/manager.go`:
  - セッション情報に再接続用コンフィグを一時保持、`DuplicateSession(id string)` メソッドを追加。
- `internal/api/handler.go`:
  - `POST /api/session/{id}/duplicate` エンドポイント。

### フロントエンド (React / TypeScript)
- `frontend/src/components/TabBar.tsx` [NEW]:
  - タブの追加・切り替え・閉じる操作。
- `frontend/src/App.tsx`:
  - 単一セッション管理から複数アクティブセッション管理への状態更新。

---

## 🧪 検証シナリオ
1. SSHでサーバーに接続。
2. タブバーの「複製（＋）」ボタンをクリック。
3. 認証情報の再入力なしで瞬時に「タブ2」が開き、独立したシェルが立ち上がる。
4. タブ1で `tail -f /var/log/messages` を流しつつ、タブ2で別コマンドが実行できる。

---

## 🤖 新セッション開始用キックオフ指示（プロンプト）
```markdown
docs/features/03_duplicate_session_tabs.md の設計書に従い、
Feature 03: セッション複製＆タブ管理（Duplicate Session & Tabs）の実装を行ってください。
ワンクリックで認証情報を再入力せず同じホストに新規タブを開けるようにしてください。
```
