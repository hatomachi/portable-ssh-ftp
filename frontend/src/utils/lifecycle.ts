import { sendHeartbeat, sendShutdownBeacon, requestShutdown } from '../api/client';

/**
 * Initializes the client-side lifecycle management.
 * Sends regular heartbeats to the Go backend and signals shutdown on beforeunload.
 * Returns a cleanup function.
 */
export function initLifecycle(): () => void {
  // Initial ping
  sendHeartbeat();

  // Send heartbeat every 3 seconds (server timeout is now 30 seconds)
  const intervalId = setInterval(() => {
    sendHeartbeat();
  }, 3000);

  // Send heartbeat immediately when returning from sleep, focus, or network reconnection
  const handleWakeOrFocus = () => {
    sendHeartbeat();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      sendHeartbeat();
    }
  };

  const handleBeforeUnload = () => {
    sendShutdownBeacon();
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
  window.addEventListener('focus', handleWakeOrFocus);
  window.addEventListener('online', handleWakeOrFocus);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    clearInterval(intervalId);
    window.removeEventListener('beforeunload', handleBeforeUnload);
    window.removeEventListener('focus', handleWakeOrFocus);
    window.removeEventListener('online', handleWakeOrFocus);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

/**
 * Gracefully shuts down the backend and attempts to close the window.
 */
export async function exitApplication(): Promise<void> {
  try {
    await requestShutdown();
  } catch (e) {
    console.error('Failed to notify backend of shutdown:', e);
  }

  // Attempt to close the window
  setTimeout(() => {
    window.close();
  }, 100);
}
