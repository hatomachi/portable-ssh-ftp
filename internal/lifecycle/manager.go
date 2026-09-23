package lifecycle

import (
	"context"
	"log"
	"sync"
	"time"
)

// Manager handles the application lifecycle, including heartbeat tracking
// and auto-shutdown when all browser windows are closed.
type Manager struct {
	mu             sync.Mutex
	enabled        bool
	lastHeartbeat  time.Time
	lastCheck      time.Time
	hasConnected   bool
	gracePeriod    time.Duration
	fastGrace      time.Duration
	checkInterval  time.Duration
	shutdownChan   chan struct{}
	shutdownOnce   sync.Once
	isShuttingDown bool
}

// NewManager creates a new LifecycleManager.
func NewManager(enabled bool, gracePeriod time.Duration) *Manager {
	if gracePeriod <= 0 {
		gracePeriod = 30 * time.Second
	}
	checkInt := 1 * time.Second
	if gracePeriod < 1*time.Second {
		checkInt = gracePeriod / 2
		if checkInt <= 0 {
			checkInt = 10 * time.Millisecond
		}
	}
	fastGrace := 5 * time.Second
	if gracePeriod < fastGrace {
		fastGrace = gracePeriod / 2
	}
	return &Manager{
		enabled:       enabled,
		gracePeriod:   gracePeriod,
		fastGrace:     fastGrace,
		checkInterval: checkInt,
		shutdownChan:  make(chan struct{}),
	}
}

// RecordHeartbeat records a keepalive ping from the frontend.
func (m *Manager) RecordHeartbeat() {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.lastHeartbeat = time.Now()
	m.hasConnected = true
}

// FastShutdownNotice is called when the frontend is about to unload (beforeunload).
// Sets the grace period to a safe short duration (5s) to close promptly,
// while still allowing reload (F5) or accidental unloads to recover if another heartbeat arrives.
func (m *Manager) FastShutdownNotice() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.hasConnected || !m.enabled {
		return
	}
	// Shift lastHeartbeat back so expiration happens fastGrace after now
	m.lastHeartbeat = time.Now().Add(-m.gracePeriod + m.fastGrace)
}

// TriggerShutdown initiates an immediate shutdown.
func (m *Manager) TriggerShutdown() {
	m.shutdownOnce.Do(func() {
		m.mu.Lock()
		m.isShuttingDown = true
		m.mu.Unlock()
		log.Println("[Lifecycle] Shutdown requested.")
		close(m.shutdownChan)
	})
}

// ShutdownChan returns the channel that closes when shutdown is triggered.
func (m *Manager) ShutdownChan() <-chan struct{} {
	return m.shutdownChan
}

// StartMonitoring starts a background goroutine to monitor heartbeats.
func (m *Manager) StartMonitoring(ctx context.Context) {
	if !m.enabled {
		log.Println("[Lifecycle] Auto-shutdown disabled.")
		return
	}

	m.mu.Lock()
	m.lastCheck = time.Now()
	m.mu.Unlock()

	ticker := time.NewTicker(m.checkInterval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-m.shutdownChan:
				return
			case <-ticker.C:
				m.checkTimeout()
			}
		}
	}()
}

func (m *Manager) checkTimeout() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.enabled || !m.hasConnected || m.isShuttingDown {
		return
	}

	now := time.Now()
	// Detect sleep/suspend or massive system time jump
	if !m.lastCheck.IsZero() {
		elapsedCheck := now.Sub(m.lastCheck)
		// If more than 3x the check interval elapsed and at least 2 seconds, system was likely sleeping or suspended
		if elapsedCheck > 3*m.checkInterval && elapsedCheck > 2*time.Second {
			log.Printf("[Lifecycle] System resume from sleep/suspend detected (gap: %v). Resetting heartbeat grace period.\n", elapsedCheck.Round(time.Millisecond))
			m.lastHeartbeat = now
		}
	}
	m.lastCheck = now

	elapsed := now.Sub(m.lastHeartbeat)
	if elapsed > m.gracePeriod {
		m.mu.Unlock()
		log.Printf("[Lifecycle] No heartbeat received for %v (browser closed). Auto-shutting down...\n", elapsed.Round(time.Millisecond))
		m.TriggerShutdown()
		m.mu.Lock()
	}
}
