package web

import (
	"io/fs"
	"net/http"
	"strings"
)

type SPAHandler struct {
	staticFS http.FileSystem
}

func NewSPAHandler(staticFS fs.FS) http.Handler {
	return &SPAHandler{
		staticFS: http.FS(staticFS),
	}
}

func (h *SPAHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}

	// Check if file exists
	f, err := h.staticFS.Open(path)
	if err == nil {
		defer f.Close()
		stat, err := f.Stat()
		if err == nil && !stat.IsDir() {
			// Serve static file
			http.FileServer(h.staticFS).ServeHTTP(w, r)
			return
		}
	}

	// Fallback to index.html for SPA client-side routing
	indexFile, err := h.staticFS.Open("index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer indexFile.Close()

	stat, err := indexFile.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	http.ServeContent(w, r, "index.html", stat.ModTime(), indexFile)
}
