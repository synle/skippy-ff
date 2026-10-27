/** Bounded, local-only evidence collection. Native browser crashes remain unobservable here. */
(() => {
  const KEY = "skippyDiagnostics";
  const MESSAGE = "SKIPPY_DIAGNOSTICS";
  // Capture while the context is valid; exception reporting must survive extension reloads.
  const extensionRoot = chrome.runtime.getURL("");
  const MAX_EVENTS = 80;
  const MAX_PENDING = 20;
  const RATE_WINDOW_MS = 60_000;
  const MAX_PER_WINDOW = 20;
  const KINDS = new Set([
    "worker_start",
    "content_start",
    "error",
    "unhandled_rejection",
    "settings_error",
    "adapter_error",
    "menu_error",
    "menu_ready",
    "poll_paused",
    "poll_resumed",
  ]);
  const ERROR_NAMES = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "URIError",
    "EvalError",
    "AggregateError",
  ]);
  const METRICS = ["menuItems", "pollIntervalMs", "pendingTimers"];
  const FRAME =
    /^(background\.js|(?:content|helpers)\/[a-z-]+\.js|pages\/options\/options\.js|chunks\/[a-zA-Z0-9_-]+\.js):[0-9]{1,7}:[0-9]{1,7}$/;
  let context;
  let queue = Promise.resolve();
  let pending = 0;
  let windowStart = 0;
  let accepted = 0;
  let dropped = 0;
  let writeFailed = false;
  let failedWrites = 0;

  /**
   * Enforce one shared per-context event budget before messaging or writing.
   * @returns {boolean} Whether another event may be recorded; updates counters without timers.
   */
  function admit() {
    const now = Date.now();
    if (now - windowStart >= RATE_WINDOW_MS) {
      windowStart = now;
      accepted = 0;
    }
    if (accepted >= MAX_PER_WINDOW || pending >= MAX_PENDING) {
      dropped = Math.min(dropped + 1, 1_000_000);
      return false;
    }
    accepted += 1;
    return true;
  }

  /**
   * Keep only this extension's bounded file/line frames; discard messages, functions and foreign URLs.
   * @param {unknown} error Error-like value, never stringified.
   * @returns {{name: string|null, frames: string[]}} Sanitized error evidence; does not throw for primitive reasons.
   */
  function describeError(error) {
    if (!error || typeof error !== "object") return { name: null, frames: [] };
    const root = extensionRoot;
    const stack = typeof error.stack === "string" ? error.stack.slice(0, 8192) : "";
    const frames = stack
      .split("\n")
      .flatMap((line) => {
        const start = line.indexOf(root);
        if (start < 0) return [];
        const frame = line
          .slice(start + root.length)
          .replace(/\)\s*$/, "")
          .trim();
        return FRAME.test(frame) ? [frame] : [];
      })
      .slice(0, 8);
    return { name: ERROR_NAMES.has(error.name) ? error.name : "Error", frames };
  }

  /**
   * Validate both local records and untrusted message/storage data using the same closed schema.
   * @param {unknown} value Candidate event.
   * @returns {object|null} Bounded event fields, or null without side effects for malformed input.
   */
  function normalize(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !KINDS.has(value.kind))
      return null;
    if (value.name !== null && !ERROR_NAMES.has(value.name)) return null;
    if (
      !Array.isArray(value.frames) ||
      value.frames.length > 8 ||
      !value.frames.every(
        (frame) => typeof frame === "string" && frame.length <= 160 && FRAME.test(frame),
      )
    )
      return null;
    const result = { kind: value.kind, name: value.name, frames: [...value.frames] };
    for (const key of METRICS) {
      if (typeof value[key] === "number" && Number.isFinite(value[key])) {
        result[key] = Math.max(0, Math.min(1_000_000, Math.round(value[key])));
      }
    }
    return result;
  }

  /**
   * Serialize worker-owned storage operations; one rejection cannot poison later writes.
   * @param {() => Promise<unknown>} operation Storage operation.
   * @returns {Promise<unknown>} Its result or rejection; releases queue capacity on either outcome.
   */
  function serialize(operation) {
    pending += 1;
    const result = queue.then(operation);
    queue = result.then(
      () => {
        pending -= 1;
      },
      () => {
        pending -= 1;
      },
    );
    return result;
  }

  /**
   * Read back only bounded, validated evidence, including after reload or malformed local storage.
   * @returns {Promise<object[]>} Sanitized records; rejects when local storage is unavailable.
   */
  async function readEvents() {
    const data = await chrome.storage.local.get(KEY);
    if (!Array.isArray(data[KEY])) return [];
    return data[KEY].slice(-MAX_EVENTS).flatMap((entry) => {
      const event = normalize(entry);
      if (
        !event ||
        !["background", "content"].includes(entry.context) ||
        !Number.isSafeInteger(entry.timestamp) ||
        entry.timestamp < 0
      )
        return [];
      const site =
        globalThis.SkippyStorage.SKIPPY_SITES.find((item) => item.host === entry.site)?.host ??
        null;
      return [{ ...event, context: entry.context, site, timestamp: entry.timestamp }];
    });
  }

  /**
   * Append one admitted event through the single writer; storage failures remain visible in exports.
   * @param {object} event Validated event.
   * @param {string} source Background or content context.
   * @param {string|null} site Supported site key, never a browsing URL.
   * @returns {void} Schedules a bounded write; never retries or reports its own failure recursively.
   */
  function append(event, source, site) {
    const timestamp = Date.now();
    void serialize(async () => {
      const events = await readEvents();
      events.push({ ...event, context: source, site, timestamp });
      await chrome.storage.local.set({ [KEY]: events.slice(-MAX_EVENTS) });
      writeFailed = false;
    }).catch(() => {
      writeFailed = true;
      failedWrites = Math.min(failedWrites + 1, 1_000_000);
      globalThis.SkippyCore?.skippyLog("[Skippy] diagnostics storage unavailable");
    });
  }

  /**
   * Record a known operation or caught exception without retaining arbitrary exception text.
   * @param {string} kind Closed event category.
   * @param {unknown} [error] Caught error; messages are intentionally omitted for privacy.
   * @param {object} [metrics] Allowed bounded numerical counters.
   * @returns {void} Emits at most 20 events/minute per context; no timer, retry, or network upload.
   */
  function record(kind, error, metrics = {}) {
    const event = normalize({ ...metrics, kind, ...describeError(error) });
    if (!event || !admit()) return;
    if (context === "background") {
      append(event, context, null);
      return;
    }
    try {
      void chrome.runtime.sendMessage({ type: MESSAGE, action: "record", event }).catch(() => {
        globalThis.SkippyCore?.skippyLog(
          "[Skippy] diagnostics delivery unavailable; evidence may be incomplete",
        );
      });
    } catch {
      // An invalidated extension context cannot persist evidence; do not retry every poll.
      globalThis.SkippyCore?.skippyLog("[Skippy] diagnostics context unavailable; reload this tab");
    }
  }

  /**
   * Authenticate senders and serialize export/clear with writes, avoiding lost concurrent records.
   * @param {unknown} message Runtime message.
   * @param {object} sender Browser-supplied identity.
   * @param {(value: object) => void} respond Reply callback.
   * @returns {boolean} True only when an authenticated asynchronous reply is pending.
   */
  function onMessage(message, sender, respond) {
    if (
      !message ||
      typeof message !== "object" ||
      message.type !== MESSAGE ||
      sender.id !== chrome.runtime.id
    )
      return false;
    const options = sender.url === chrome.runtime.getURL("pages/options/options.html");
    if (message.action === "record") {
      if (!sender.tab || typeof sender.url !== "string") return false;
      const sites = globalThis.SkippyStorage.SKIPPY_SITES;
      const index = globalThis.SkippyMenu.buildSkippySiteVisibilityUpdates(
        sites,
        sender.url,
      ).findIndex((item) => item.visible);
      const event = normalize(message.event);
      if (index < 0 || !event || !admit()) return false;
      append(event, "content", sites[index].host);
      respond({ ok: true, status: "queued" });
      return false;
    }
    if (!options || !["export", "clear"].includes(message.action)) return false;
    if (pending >= MAX_PENDING) {
      respond({ ok: false, error: "diagnostics_busy", retrySafe: true });
      return false;
    }
    void serialize(async () => {
      if (message.action === "clear") {
        await chrome.storage.local.remove(KEY);
        dropped = 0;
        failedWrites = 0;
        writeFailed = false;
        return { ok: true };
      }
      return {
        ok: true,
        report: {
          schemaVersion: 1,
          attribution:
            "unknown; JavaScript errors and lifecycle events do not prove a native crash cause",
          limitations:
            "No native dumps, OOM/GPU detection, or other-extension visibility. Final events may be lost on termination. Worker starts are normal.",
          extensionVersion: chrome.runtime.getManifest().version,
          userAgent: navigator.userAgent.slice(0, 512),
          exportedAt: new Date().toISOString(),
          droppedSinceWorkerStart: dropped,
          failedWritesSinceWorkerStart: failedWrites,
          lastWriteFailed: writeFailed,
          events: await readEvents(),
        },
      };
    }).then(respond, () =>
      respond({ ok: false, error: "diagnostics_storage_unavailable", retrySafe: true }),
    );
    return true;
  }

  /**
   * Install own-context hooks exactly once; worker listener registration stays synchronous.
   * @param {"background"|"content"} source Execution context.
   * @returns {void} Registers two error listeners and, in the worker, one message listener; no keepalive.
   */
  function init(source) {
    if (context || !["background", "content"].includes(source)) return;
    context = source;
    globalThis.addEventListener("error", (event) => {
      const error = event.error || { stack: `${event.filename}:${event.lineno}:${event.colno}` };
      if (source === "content" && describeError(error).frames.length === 0) return;
      record("error", error);
    });
    globalThis.addEventListener("unhandledrejection", (event) => {
      if (source === "content" && describeError(event.reason).frames.length === 0) return;
      record("unhandled_rejection", event.reason);
    });
    if (source === "background") chrome.runtime.onMessage.addListener(onMessage);
    record(source === "background" ? "worker_start" : "content_start");
  }

  globalThis.SkippyDiagnostics = { init, record };
})();
