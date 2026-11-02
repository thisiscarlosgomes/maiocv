import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { THEME_INIT_SCRIPT } from "../lib/theme.ts";

function bootstrap(saved: string | null, systemDark: boolean, blocked = false) {
  const root = { dataset: {} as Record<string, string> };
  const meta = { content: "#ffffff" };
  vm.runInNewContext(THEME_INIT_SCRIPT, {
    document: { documentElement: root, querySelector: () => meta },
    localStorage: { getItem: () => { if (blocked) throw new Error("Storage blocked"); return saved; } },
    matchMedia: () => ({ matches: systemDark }),
  });
  return { theme: root.dataset.theme, color: meta.content };
}
test("saved appearance takes precedence over the operating system before paint", () => {
  assert.deepEqual(bootstrap("dark", false), { theme: "dark", color: "#141416" });
  assert.deepEqual(bootstrap("light", true), { theme: "light", color: "#ffffff" });
});
test("missing and invalid preferences default to dark", () => {
  for (const value of [null, "invalid"]) {
    assert.equal(bootstrap(value, true).theme, "dark");
    assert.equal(bootstrap(value, false).theme, "dark");
  }
});
test("blocked local storage defaults to dark without breaking rendering", () => {
  assert.equal(bootstrap(null, false, true).theme, "dark");
});

test("explicit system preference follows the operating system", () => {
  assert.equal(bootstrap("system", true).theme, "dark");
  assert.equal(bootstrap("system", false).theme, "light");
});
