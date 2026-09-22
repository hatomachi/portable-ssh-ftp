package browser

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Open launches the given URL. If asAppWindow is true, it attempts to open
// the URL in an independent application window (using Edge, Chrome, etc. with --app).
// If no supported browser is found or if asAppWindow is false, it falls back
// to the system's default browser.
func Open(url string, asAppWindow bool) error {
	if asAppWindow {
		if err := openInAppMode(url); err == nil {
			return nil
		}
		log.Printf("[Browser] Could not launch app window mode, falling back to default browser.")
	}

	return openDefault(url)
}

func openInAppMode(url string) error {
	var candidates []string

	switch runtime.GOOS {
	case "windows":
		candidates = getWindowsBrowserPaths()
	case "darwin":
		candidates = getDarwinBrowserPaths()
	default:
		candidates = getLinuxBrowserExecutables()
	}

	for _, browserPath := range candidates {
		if browserPath == "" {
			continue
		}

		// Check if file exists or can be resolved
		if resolvedPath, err := resolveExecutable(browserPath); err == nil {
			log.Printf("[Browser] Launching app window via: %s\n", resolvedPath)
			cmd := exec.Command(resolvedPath, fmt.Sprintf("--app=%s", url))
			if err := cmd.Start(); err == nil {
				return nil
			}
		}
	}

	return fmt.Errorf("no suitable browser found for app mode")
}

func openDefault(url string) error {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	case "darwin":
		cmd = "open"
		args = []string{url}
	default:
		cmd = "xdg-open"
		args = []string{url}
	}

	return exec.Command(cmd, args...).Start()
}

func resolveExecutable(path string) (string, error) {
	if filepath.IsAbs(path) {
		if fi, err := os.Stat(path); err == nil && !fi.IsDir() {
			return path, nil
		}
		return "", os.ErrNotExist
	}
	return exec.LookPath(path)
}

func getWindowsBrowserPaths() []string {
	programFilesX86 := os.Getenv("ProgramFiles(x86)")
	programFiles := os.Getenv("ProgramFiles")
	localAppData := os.Getenv("LOCALAPPDATA")

	paths := []string{
		// Microsoft Edge (Standard in Win10/Win11)
		filepath.Join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
		"msedge.exe",

		// Google Chrome
		filepath.Join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
		"chrome.exe",

		// Brave Browser
		filepath.Join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
		filepath.Join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
	}

	return paths
}

func getDarwinBrowserPaths() []string {
	home := os.Getenv("HOME")
	return []string{
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		filepath.Join(home, "Applications", "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
		filepath.Join(home, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
	}
}

func getLinuxBrowserExecutables() []string {
	return []string{
		"google-chrome",
		"microsoft-edge",
		"google-chrome-stable",
		"chromium-browser",
		"chromium",
		"brave-browser",
	}
}
