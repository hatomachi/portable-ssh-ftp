package main

import (
	"embed"
	"io/fs"
)

//go:embed all:frontend/dist
var distFS embed.FS

func getStaticFS() (fs.FS, error) {
	return fs.Sub(distFS, "frontend/dist")
}
