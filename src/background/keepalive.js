// Keeps the service worker alive, but only while something is genuinely in flight.
//
// Measured in Chrome for Testing 152 before writing this: a run whose provider call takes 50
// seconds loses its worker between t+35 s and t+40 s. A pending fetch does NOT keep the worker
// alive — the idle timer is reset by extension API activity, not by network activity. A model
// that thinks for forty seconds is ordinary, so without this a normal run dies.
//
// Scoped, never permanent. A heartbeat that runs whether or not there is work is a service
// worker that never sleeps, which is precisely what MV3 exists to prevent, and Chrome Web Store
// review reads it as exactly that.

// Comfortably under Chrome's 30-second idle timeout, and cheap: one API round trip.
const PULSE_MS = 20000;

let holders = 0;
let timer = null;

function pulse() {
  // Any extension API call resets the idle timer. getPlatformInfo touches nothing, needs no
  // permission, and cannot fail in a way that matters here.
  chrome.runtime.getPlatformInfo().catch(() => {});
}

function start() {
  if (timer !== null) return;
  pulse();
  timer = setInterval(pulse, PULSE_MS);
}

function stop() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

// Counted rather than boolean: an agent run and an eval suite can overlap, and the first one to
// finish must not switch the keep-alive off under the other.
export function hold() {
  holders += 1;
  start();
  return () => release();
}

export function release() {
  holders = Math.max(0, holders - 1);
  if (holders === 0) stop();
}

export function keepAliveState() {
  return { holders, running: timer !== null };
}

// Only for tests and for recovery after a restart, where the count is meaningless.
export function resetKeepAlive() {
  holders = 0;
  stop();
}
