.PHONY: all dev build build-windows clean

APP_NAME := portable-ssh-ftp

# デフォルトビルド（現在のOS向け）
build:
	cd frontend && npm run build
	go build -ldflags="-s -w" -o bin/$(APP_NAME) .

# Windows向けポータブル単一exeのクロスコンパイル（Mac上で実行可能）
build-windows:
	cd frontend && npm run build
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o bin/$(APP_NAME).exe .

# 開発用（バックエンド）
dev-backend:
	go run main.go

# 開発用（フロントエンド）
dev-frontend:
	cd frontend && npm run dev

# クリーンアップ
clean:
	rm -rf bin/ frontend/dist/
