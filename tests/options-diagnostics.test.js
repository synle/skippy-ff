/** Real options DOM interactions for local diagnostic export and clear. */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setImmediate as settle } from "node:timers/promises";

const { document } = globalThis;
const html = readFileSync("src/pages/options/options.html", "utf8");
let sendMessage;

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = html;
  sendMessage = vi.fn(async () => ({ ok: true, report: { schemaVersion: 1, events: [] } }));
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  await import("../src/pages/options/diagnostics.js");
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("exports copyable JSON without network or clipboard access", async () => {
  document.getElementById("diagnostics-export").click();
  await settle();
  expect(sendMessage).toHaveBeenCalledWith({ type: "SKIPPY_DIAGNOSTICS", action: "export" });
  expect(JSON.parse(document.getElementById("diagnostics-output").value)).toMatchInlineSnapshot(`
    {
      "events": [],
      "schemaVersion": 1,
    }
  `);
  expect(document.getElementById("diagnostics-output-label").hidden).toBe(false);
  expect(document.getElementById("diagnostics-status").textContent).toContain(
    "Native crash cause remains unknown",
  );
});

it("clears the displayed export only after worker confirmation", async () => {
  document.getElementById("diagnostics-export").click();
  await settle();
  document.getElementById("diagnostics-clear").click();
  await settle();
  expect(sendMessage).toHaveBeenLastCalledWith({ type: "SKIPPY_DIAGNOSTICS", action: "clear" });
  expect(document.getElementById("diagnostics-output").value).toBe("");
  expect(document.getElementById("diagnostics-output-label").hidden).toBe(true);
  expect(document.getElementById("diagnostics-status").textContent).toContain(
    "settings are unchanged",
  );
});

it.each([undefined, { ok: false, error: "diagnostics_storage_unavailable" }])(
  "surfaces failure without a false success or stale JSON: %j",
  async (response) => {
    sendMessage.mockResolvedValueOnce(response);
    document.getElementById("diagnostics-export").click();
    await settle();
    expect(document.getElementById("diagnostics-output-label").hidden).toBe(true);
    expect(document.getElementById("diagnostics-status").textContent).toContain(
      "Diagnostics unavailable",
    );
    expect(document.getElementById("diagnostics-export").disabled).toBe(false);
    expect(document.getElementById("diagnostics-clear").disabled).toBe(false);
  },
);

it("disables concurrent actions and recovers after a transport rejection", async () => {
  sendMessage.mockRejectedValueOnce(new Error("unavailable"));
  document.getElementById("diagnostics-export").click();
  expect(document.getElementById("diagnostics-clear").disabled).toBe(true);
  await settle();
  expect(document.getElementById("diagnostics-status").textContent).toContain(
    "Could not reach Skippy diagnostics",
  );
  expect(document.getElementById("diagnostics-export").disabled).toBe(false);
});
