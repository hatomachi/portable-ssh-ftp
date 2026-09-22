import { sendHeartbeat, sendShutdownBeacon, requestShutdown } from '../api/client';

/**
 * Initializes the client-side lifecycle management.
 * Sends regular heartbeats to the Go backend and signals shutdown on beforeunload.
 * Returns a cleanup function.
 */
export function initLifecycle(): () => void {
  // Initial ping
  sendHeartbeat();

  // Send heartbeat every 2.5 seconds (server timeout is 6 seconds)
  const intervalId = setInterval(() => {
    sendHeartbeat();
  }, 2500);

  const handleBeforeUnload = () => {
    sendShutdownBeacon();
  };

  window.addEventListener('beforeunload', handleBeforeUnload);

  return () => {
    clearInterval(intervalId);
    window.removeEventListener('beforeunload', handleBeforeUnload);
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
