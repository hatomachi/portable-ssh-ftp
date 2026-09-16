# 🧰 Portable SSH & SFTP (portable-ssh-ftp)

インストール不要でWindowsで動く、軽量SSH/SFTP操作ツール。  
PuTTYとFFFTPの「痒いところ」を解消し、閉域本番操作ホストでの快適な作業を実現します。

## ✨ 特徴
- **インストール不要・単一exe**: 約10〜15MBの `.exe` 1個をポン置きしてダブルクリックするだけ。
- **SSH ＋ SFTP 統合画面**: 1回の接続で、左にSFTPツリー、右にSSHターミナルを展開。
- **ポータブル設定管理**: レジストリ不要。セッションや設定はローカルJSONで管理。
- **Mac完結開発**: Pure Go + React により、Mac上で開発・検証し、コマンド1発でWindows exeを生成可能。

## 📁 ディレクトリ構成（予定）
```
portable-ssh-ftp/
├── AGENTS.md               # 個人作戦ノートとの連携定義
├── README.md               # 本ドキュメント
├── Makefile                # ビルド＆開発コマンド群
├── main.go                 # Goエントリーポイント（HTTP + embed）
├── go.mod / go.sum         # Goモジュール定義
├── internal/               # Goバックエンド内部実装
│   ├── server/             # HTTP / WebSocket サーバー & ブラウザ自動起動
│   ├── ssh/                # SSH接続・ターミナルPTY中継
│   └── sftp/               # SFTPファイル一覧・送受信
└── frontend/               # React 19 + TypeScript + Vite + Tailwind
    ├── src/
    │   ├── components/     # Terminal(xterm), FileTree, SessionModal等
    │   └── App.tsx
    ├── package.json
    └── vite.config.ts
```

## 🛠️ クイックスタート
詳細は [AGENTS.md](AGENTS.md) を参照してください。
