package lifecycle

import (
	"context"
	"testing"
	"time"
)

func TestLifecycleManager_ExplicitShutdown(t *testing.T) {
	mgr := NewManager(true, 5*time.Second)
	ch := mgr.ShutdownChan()

	select {
	case <-ch:
		t.Fatal("shutdownChan should not be closed initially")
	default:
	}

	mgr.TriggerShutdown()

	select {
	case <-ch:
		// success
	case <-time.After(1 * time.Second):
		t.Fatal("shutdownChan was not closed after TriggerShutdown")
	}

	// Idempotent TriggerShutdown
	mgr.TriggerShutdown()
}

func TestLifecycleManager_TimeoutAutoShutdown(t *testing.T) {
	mgr := NewManager(true, 100*time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mgr.StartMonitoring(ctx)
	ch := mgr.ShutdownChan()

	// Before any heartbeat, should not shutdown
	time.Sleep(150 * time.Millisecond)
	select {
	case <-ch:
		t.Fatal("should not shutdown before first heartbeat")
	default:
	}

	// First heartbeat
	mgr.RecordHeartbeat()

	// Now wait for timeout
	select {
	case <-ch:
		// success
	case <-time.After(300 * time.Millisecond):
		t.Fatal("expected auto-shutdown after heartbeat timeout")
	}
}

func TestLifecycleManager_DefaultTimeouts(t *testing.T) {
	mgr := NewManager(true, 0)
	if mgr.gracePeriod != 30*time.Second {
		t.Errorf("expected default gracePeriod to be 30s, got %v", mgr.gracePeriod)
	}
	if mgr.fastGrace != 5*time.Second {
		t.Errorf("expected default fastGrace to be 5s, got %v", mgr.fastGrace)
	}
}

func TestLifecycleManager_ResumeFromSleep(t *testing.T) {
	mgr := NewManager(true, 500*time.Millisecond)
	mgr.RecordHeartbeat()

	// Simulate system sleep: lastCheck was 5 seconds ago, and lastHeartbeat was 5 seconds ago
	past := time.Now().Add(-5 * time.Second)
	mgr.mu.Lock()
	mgr.lastCheck = past
	mgr.lastHeartbeat = past
	mgr.mu.Unlock()

	// checkTimeout should detect gap > 3*checkInterval (and > 2s) and reset lastHeartbeat instead of shutting down!
	mgr.checkTimeout()

	ch := mgr.ShutdownChan()
	select {
	case <-ch:
		t.Fatal("should NOT shutdown immediately after sleep resume; grace period should be reset")
	default:
		// Success: shutdown was prevented because heartbeat was reset
	}

	// Verify lastHeartbeat was updated to near time.Now()
	mgr.mu.Lock()
	gap := time.Since(mgr.lastHeartbeat)
	mgr.mu.Unlock()

	if gap > 100*time.Millisecond {
		t.Errorf("lastHeartbeat was not reset properly: gap = %v", gap)
	}
}

func TestLifecycleManager_FastShutdown(t *testing.T) {
	mgr := NewManager(true, 500*time.Millisecond)
	mgr.fastGrace = 50 * time.Millisecond
	mgr.RecordHeartbeat()

	mgr.FastShutdownNotice()

	// Sleep slightly past fastGrace
	time.Sleep(70 * time.Millisecond)
	mgr.checkTimeout()

	ch := mgr.ShutdownChan()
	select {
	case <-ch:
		// Success: should shut down quickly after fast grace
	default:
		t.Fatal("expected shutdown after FastShutdownNotice")
	}
}
