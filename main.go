package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"portable-ssh-ftp/internal/api"
	"portable-ssh-ftp/internal/browser"
	"portable-ssh-ftp/internal/config"
	"portable-ssh-ftp/internal/lifecycle"
	"portable-ssh-ftp/internal/session"
	"portable-ssh-ftp/internal/terminal"
	"portable-ssh-ftp/internal/web"
)

func main() {
	port := flag.Int("port", 8080, "Port to listen on")
	noBrowser := flag.Bool("no-browser", false, "Do not open browser automatically")
	appMode := flag.Bool("app", true, "Open in standalone application window mode (Edge/Chrome)")
	noAutoclose := flag.Bool("no-autoclose", false, "Disable auto-shutdown when browser window is closed")
	flag.Parse()

	// Find available port if default is occupied
	listener, actualPort, err := listenOnPort(*port)
	if err != nil {
		log.Fatalf("Failed to bind port: %v", err)
	}

	sessionMgr := session.NewManager()
	profileStore := config.NewProfileStore("")
	apiHandler := api.NewAPI(sessionMgr, profileStore)
	termHandler := terminal.NewHandler(sessionMgr)

	// Lifecycle & Auto-Shutdown management
	lifecycleMgr := lifecycle.NewManager(!*noAutoclose, 6*time.Second)
	apiHandler.SetLifecycleManager(lifecycleMgr)

	monitorCtx, cancelMonitor := context.WithCancel(context.Background())
	defer cancelMonitor()
	lifecycleMgr.StartMonitoring(monitorCtx)

	staticFS, err := getStaticFS()
	if err != nil {
		log.Fatalf("Failed to load embedded static filesystem: %v", err)
	}
	spaHandler := web.NewSPAHandler(staticFS)

	mux := http.NewServeMux()

	// Register API routes
	apiHandler.RegisterRoutes(mux)

	// Register Terminal WebSocket
	mux.Handle("/ws/terminal", termHandler)

	// Fallback to SPA handler
	mux.Handle("/", spaHandler)

	// Wrap with CORS & Logging middleware
	handler := corsMiddleware(mux)

	server := &http.Server{
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // Streaming / WebSocket requires no write timeout
		IdleTimeout:  60 * time.Second,
	}

	appURL := fmt.Sprintf("http://localhost:%d", actualPort)
	fmt.Printf("\n🚀 Portable SSH & FTP is running!\n")
	fmt.Printf("👉 Access URL: %s\n\n", appURL)

	if !*noBrowser {
		go func() {
			time.Sleep(200 * time.Millisecond)
			if err := browser.Open(appURL, *appMode); err != nil {
				log.Printf("[Browser] Failed to open browser: %v\n", err)
			}
		}()
	}

	// Graceful shutdown handling
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	select {
	case sig := <-stop:
		fmt.Printf("\nReceived signal %v, shutting down server...\n", sig)
	case <-lifecycleMgr.ShutdownChan():
		fmt.Println("\nBrowser window closed or shutdown requested. Shutting down server...")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown failed: %v", err)
	}
	fmt.Println("Server gracefully stopped.")
}

func listenOnPort(startPort int) (net.Listener, int, error) {
	for port := startPort; port < startPort+100; port++ {
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			return l, port, nil
		}
	}
	return nil, 0, fmt.Errorf("could not find an open port starting from %d", startPort)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
