import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "packages/maio-tokens/tokens.css"), "utf8");
const fonts = readFileSync(join(root, "packages/maio-tokens/fonts.css"), "utf8");
const tokens = JSON.parse(readFileSync(join(root, "packages/maio-tokens/tokens.json"), "utf8"));

test("tokens.css carries every frozen colour and alias", () => {
  for (const [name, value] of Object.entries(tokens.color) as [string, string][]) {
    assert.match(css, new RegExp(`${name}:\\s*${value}`));
  }
  for (const [name, value] of Object.entries(tokens.alias) as [string, string][]) {
    assert.match(css, new RegExp(`${name}:\\s*${value.replace(/[()]/g, "\\$&")}`));
  }
  assert.equal(css.includes("#6c7b59"), false);
  assert.match(css, /--fs-label:\s*12px/);
});

test("dark theme provides the complete documented palette", () => {
  const dark = css.slice(css.indexOf('[data-theme="dark"]'));
  const block = dark.slice(0, dark.indexOf("}") + 1);
  assert.match(block, /color-scheme:\s*dark/);
  for (const [name, value] of Object.entries(tokens.dark)) {
    assert.ok(block.includes(`${name}: ${value};`));
  }
});

test("fonts.css declares PP Neue Montreal at 400 and 500", () => {
  assert.match(fonts, /font-weight:\s*400/);
  assert.match(fonts, /font-weight:\s*500/);
  assert.match(fonts, /PPNeueMontreal-Regular\.woff2/);
  assert.match(fonts, /PPNeueMontreal-Medium\.woff2/);
});

test("dark text, controls and focus colours have accessible contrast", () => {
  function luminance(hex: string) {
    const rgb = hex.slice(1).match(/../g)!.map(value => {
      const channel = parseInt(value, 16) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  }
  for (const [foreground, background] of [
    ["ink", "paper"], ["muted", "paper"], ["text-data", "surface-data"],
    ["chip-fg", "chip-bg"], ["estimate-fg", "estimate-bg"],
    ["error", "error-bg"], ["link", "paper"], ["focus", "paper"],
  ]) {
    const a = luminance(tokens.dark[`--maio-${foreground}`]);
    const b = luminance(tokens.dark[`--maio-${background}`]);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${foreground} on ${background}`);
  }
});
