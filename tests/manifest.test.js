import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("manifest declares APIs used by the service worker", () => {
  assert.equal(manifest.permissions.includes("alarms"), true);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.background.type, "module");
});

test("manifest declares keyboard shortcuts handled by the service worker", () => {
  assert.ok(manifest.commands._execute_action.suggested_key.default);
  assert.ok(manifest.commands["toggle-focus-pause"].suggested_key.default);
});

test("manifest exposes only the redirect page to websites", () => {
  assert.deepEqual(manifest.web_accessible_resources, [
    {
      resources: ["blocked.html"],
      matches: ["http://*/*", "https://*/*"],
    },
  ]);
});

test("manifest does not register the obsolete static ruleset", () => {
  assert.equal("declarative_net_request" in manifest, false);
});

test("manifest keeps broad host access for user-selected blocking", () => {
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
});

test("manifest metadata is ready for Chrome Web Store releases", () => {
  assert.ok(manifest.description.length <= 132);
  assert.equal(packageJson.version, manifest.version);
});

test("extension pages load packaged fonts instead of remote stylesheets", async () => {
  const [popupHtml, blockedHtml, fontStyles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/blocked.html", import.meta.url), "utf8"),
    readFile(new URL("../public/fonts/fonts.css", import.meta.url), "utf8"),
  ]);

  assert.equal(popupHtml.includes("fonts.googleapis.com"), false);
  assert.equal(blockedHtml.includes("fonts.googleapis.com"), false);
  assert.match(popupHtml, /fonts\/fonts\.css/);
  assert.match(blockedHtml, /fonts\/fonts\.css/);
  assert.match(fontStyles, /Anton-Regular\.ttf/);
  assert.match(fontStyles, /Outfit-Variable\.ttf/);
  assert.match(fontStyles, /JetBrainsMono-Variable\.ttf/);
});
