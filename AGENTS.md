# Portable SSH & FTP (portable-ssh-ftp)

> **インストール不要・単一exeで動く、PuTTY & FFFTPの痒いところを直した閉域本番操作用モダンツール**

---

## 🗺️ 作戦ノート（個人作戦ボード連携）
本プロジェクトの全体構想、現在地、Next Actions、フィードバックログは、以下の `personal-vault` 作戦ノートにて一元管理されています。

- **作戦ノート**: [/Users/s-ikari/work/personal-vault/10_職人・発明家/portable-ssh-ftp.md](file:///Users/s-ikari/work/personal-vault/10_職人・発明家/portable-ssh-ftp.md)
- **総合ダッシュボード**: [/Users/s-ikari/work/personal-vault/00_Dashboard.md](file:///Users/s-ikari/work/personal-vault/00_Dashboard.md)
- **開発ロードマップと構想**: [/Users/s-ikari/work/personal-vault/10_職人・発明家/00_開発ロードマップとAI活用構想.md](file:///Users/s-ikari/work/personal-vault/10_職人・発明家/00_開発ロードマップとAI活用構想.md)

---

## 🎯 プロジェクトの目的と概要
- **対象環境**: 閉域・社内ネットワーク上の本番操作用Windowsホスト（インストール制限あり・PuTTY/FFFTP使用環境）
- **目指す姿**:
  - 管理者権限不要、レジストリ書き込み不要のポータブル単一 `.exe`（約10〜15MB）。
  - exeを叩くとEdge/Chromeブラウザが開き、1画面で「SSHターミナル操作」と「FTPファイルツリー」がシームレスに使える。
  - セッション設定はポータブルなJSON管理。
  - Shift-JIS / EUC-JP / UTF-8 文字コード対応。
  - Macだけで100%開発・ローカル検証・Windowsクロスコンパイルが完結する。

---

## 🏗️ アーキテクチャ構成
```
[ユーザーの操作]
   │ (ブラウザ: http://localhost:PORT)
   ▼
[フロントエンド: frontend/]
   ・React 19 + TypeScript + Vite + Tailwind CSS + Lucide Icons
   ・xterm.js (ターミナル描画) + 2ペイン/ツリー型ファイルマネージャー
   │ WebSocket / REST API
   ▼
[バックエンド: backend/ (Go)]
   ・net/http + go:embed (ビルド済みフロント静的ファイルを単一バイナリに内包)
   ・gorilla/websocket (ターミナル入出力の双方向ストリーミング)
   ・golang.org/x/crypto/ssh (SSHクライアント・PTY割り当て)
   ・github.com/jlaffaye/ftp (FTPファイル操作: PASV/EPSV, 文字コード変換)
   │ SSH (TCP 22) / FTP (TCP 21 + PASV)
   ▼
[接続先サーバー (Linux / 各種ホスト)]
```

---

## 🚀 開発・ビルド手順（Mac環境）

### 1. 前提ツールのインストール
```bash
# Go のインストール (Homebrew)
brew install go

# Node.js (Vite / Reactビルド用)
# ※ 既にインストール済み
```

### 2. ローカル開発（ホットリロード）
```bash
# フロントエンド起動 (localhost:5173)
cd frontend && npm run dev

# バックエンド起動 (localhost:8080)
go run main.go
```

### 3. Windows向けポータブル単一exeのビルド (Mac上で完結)
```bash
# フロントエンドのビルド
cd frontend && npm run build

# Pure Go による Windows exe クロスコンパイル（CGO不要）
cd ..
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o portable-ssh-ftp.exe .
```
生成された `portable-ssh-ftp.exe` をWindows機に持参し、ダブルクリックするだけで起動します。

---

## 📦 機能実装・修正完了時のデプロイ規範（GitHub Actions自動ビルド＆リリース）
**【超重要】ユーザーへの完了報告前に、必ずリモートへのプッシュ・ビルドトリガーまで完了させること**

機能実装やバグ修正が完了した際は、ローカル検証（単体テスト・フロントエンドビルド・クロスコンパイル）だけで終わらせず、必ず以下のステップを完遂してください。

1. **Git コミット**:
   - 変更内容を意味のあるコミットメッセージでコミットする（Conventional Commits 推奨）。
2. **リリースタグ付与**:
   - セマンティックバージョニングに従い、適切なタグを付与する（例: `git tag -a v0.10.1 -m "Release v0.10.1: ..."`）。
3. **リモートプッシュ (main & tags)**:
   - `git push origin main --tags` を実行。
   - これにより、GitHub Actions の Release ワークフローが起動し、Windows exe（通常版・コンソール版）、macOS、Linux 用のバイナリがクラウド上で自動ビルドされ、GitHub Releases に即座に配置されます。
4. **作戦ノート同期**:
   - `personal-vault` の作戦ノートおよび `00_Dashboard.md` を更新・コミット・プッシュする。
5. **完了報告**:
   - GitHub Releases（https://github.com/hatomachi/portable-ssh-ftp/releases）の最新アセットが自動生成される旨をユーザーに報告する。

