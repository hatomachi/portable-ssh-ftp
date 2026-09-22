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
