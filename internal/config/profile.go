package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Profile represents a saved server connection configuration.
type Profile struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Host          string    `json:"host"`
	SSHPort       int       `json:"sshPort"`
	SSHUsername   string    `json:"sshUsername"`
	SSHAuthType   string    `json:"sshAuthType"` // "password" or "key"
	SSHPassword   string    `json:"sshPassword,omitempty"`
	SSHPrivateKey string    `json:"sshPrivateKey,omitempty"`
	SSHPassphrase string    `json:"sshPassphrase,omitempty"`
	FTPPort       int       `json:"ftpPort"`
	FTPUsername   string    `json:"ftpUsername"`
	FTPPassword   string    `json:"ftpPassword,omitempty"`
	FTPPassive    bool      `json:"ftpPassive"`
	FTPCharset    string    `json:"ftpCharset"`
	EnableSSH     bool      `json:"enableSsh"`
	EnableFTP     bool      `json:"enableFtp"`
	EnableLogging bool      `json:"enableLogging"`
	LogTimestamp  bool      `json:"logTimestamp"`
	SavePassword  bool      `json:"savePassword"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// ProfileStore manages reading and writing connection profiles to a portable JSON file.
type ProfileStore struct {
	filePath string
	mu       sync.RWMutex
}

// DefaultConfigPath returns the default location for profiles.json next to the executable.
func DefaultConfigPath() string {
	exePath, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exePath)
		// If running via `go run` in a temp directory, fallback to current directory
		if !strings.Contains(dir, "go-build") && !strings.Contains(dir, "/var/folders") && !strings.Contains(dir, "AppData\\Local\\Temp") {
			return filepath.Join(dir, "profiles.json")
		}
	}
	return "profiles.json"
}

// NewProfileStore creates a new ProfileStore with the specified file path, or default path if empty.
func NewProfileStore(path string) *ProfileStore {
	if path == "" {
		path = DefaultConfigPath()
	}
	return &ProfileStore{
		filePath: path,
	}
}

// List returns all saved profiles sorted by updated time descending.
func (s *ProfileStore) List() ([]Profile, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.loadUnlocked()
}

// Get finds a profile by ID.
func (s *ProfileStore) Get(id string) (*Profile, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	profiles, err := s.loadUnlocked()
	if err != nil {
		return nil, err
	}

	for _, p := range profiles {
		if p.ID == id {
			return &p, nil
		}
	}
	return nil, fmt.Errorf("profile with ID %s not found", id)
}

// Save inserts or updates a profile in the store.
func (s *ProfileStore) Save(p Profile) (*Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	profiles, err := s.loadUnlocked()
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	if p.ID == "" {
		p.ID = generateID()
	}
	p.UpdatedAt = time.Now()

	// Clear passwords if SavePassword is false
	if !p.SavePassword {
		p.SSHPassword = ""
		p.FTPPassword = ""
		p.SSHPassphrase = ""
	}

	found := false
	for i, existing := range profiles {
		if existing.ID == p.ID {
			profiles[i] = p
			found = true
			break
		}
	}

	if !found {
		profiles = append(profiles, p)
	}

	if err := s.saveUnlocked(profiles); err != nil {
		return nil, err
	}

	return &p, nil
}

// Delete removes a profile by ID.
func (s *ProfileStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	profiles, err := s.loadUnlocked()
	if err != nil {
		return err
	}

	filtered := make([]Profile, 0, len(profiles))
	found := false
	for _, p := range profiles {
		if p.ID == id {
			found = true
			continue
		}
		filtered = append(filtered, p)
	}

	if !found {
		return fmt.Errorf("profile with ID %s not found", id)
	}

	return s.saveUnlocked(filtered)
}

func (s *ProfileStore) loadUnlocked() ([]Profile, error) {
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []Profile{}, nil
		}
		return nil, err
	}

	if len(data) == 0 {
		return []Profile{}, nil
	}

	var profiles []Profile
	if err := json.Unmarshal(data, &profiles); err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", s.filePath, err)
	}

	return profiles, nil
}

func (s *ProfileStore) saveUnlocked(profiles []Profile) error {
	dir := filepath.Dir(s.filePath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}

	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode profiles: %w", err)
	}

	return os.WriteFile(s.filePath, data, 0600)
}

func generateID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
