import test from "node:test";
import assert from "node:assert/strict";

import {
  addDomainsToBlocklist,
  applyBlockingRules,
  BLOCK_PRESETS,
  buildBlockingRules,
  normalizeDomain,
  updateBlockingConfiguration,
} from "../src/core/blocking.js";

test("normalizeDomain accepts bare domains that begin with http", () => {
  assert.equal(normalizeDomain("httpbin.org"), "httpbin.org");
  assert.equal(normalizeDomain("http.cat"), "http.cat");
});

test("normalizeDomain removes URL details and normalizes the hostname", () => {
  assert.equal(
    normalizeDomain("HTTPS://WWW.YouTube.com/watch?v=1"),
    "youtube.com",
  );
  assert.equal(normalizeDomain("example.com."), "example.com");
  assert.equal(
    normalizeDomain("https://münich.example/path"),
    "xn--mnich-kva.example",
  );
});

test("normalizeDomain rejects unsafe or malformed values", () => {
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain("localhost"), null);
  assert.equal(normalizeDomain("https://user:password@example.com"), null);
  assert.equal(normalizeDomain("javascript:alert(1)"), null);
  assert.equal(normalizeDomain("-bad.example"), null);
});

test("buildBlockingRules creates one boundary-aware rule per unique domain", () => {
  const rules = buildBlockingRules([
    { id: 1, url: "youtube.com" },
    { id: 2, url: "https://www.youtube.com/watch?v=1" },
    { id: 3, url: "news.example.com" },
  ]);

  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0].condition.requestDomains, ["youtube.com"]);
  assert.deepEqual(rules[1].condition.requestDomains, ["news.example.com"]);
  assert.deepEqual(rules[0].condition.resourceTypes, ["main_frame"]);
  assert.deepEqual(rules[0].action.redirect, {
    extensionPath: "/blocked.html?domain=youtube.com",
  });
  assert.equal("urlFilter" in rules[0].condition, false);
});

test("applyBlockingRules removes and adds dynamic rules atomically", async () => {
  const calls = [];
  const declarativeNetRequest = {
    async getDynamicRules() {
      return [{ id: 42 }];
    },
    async updateDynamicRules(update) {
      calls.push(update);
    },
  };

  const result = await applyBlockingRules(declarativeNetRequest, true, [
    { url: "youtube.com" },
  ]);

  assert.equal(result.ruleCount, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].removeRuleIds, [42]);
  assert.equal(calls[0].addRules.length, 1);
});

test("updateBlockingConfiguration persists only after DNR succeeds", async () => {
  const events = [];
  const chromeApi = {
    declarativeNetRequest: {
      async getDynamicRules() {
        return [];
      },
      async updateDynamicRules() {
        events.push("rules");
      },
    },
    storage: {
      local: {
        async get() {
          return { isBlocking: false, blockedUrls: [] };
        },
        async set(value) {
          events.push(["storage", value]);
        },
      },
    },
  };

  const result = await updateBlockingConfiguration(chromeApi, true, [
    {
      id: 1,
      url: "https://www.YouTube.com/watch?v=1",
      createdAt: "2026-01-01",
    },
  ]);

  assert.equal(result.success, true);
  assert.deepEqual(
    events.map((event) => (Array.isArray(event) ? event[0] : event)),
    ["rules", "storage"],
  );
  assert.equal(result.blockedUrls[0].url, "youtube.com");
});

test("updateBlockingConfiguration leaves storage unchanged when DNR fails", async () => {
  let storageWrites = 0;
  const chromeApi = {
    declarativeNetRequest: {
      async getDynamicRules() {
        return [];
      },
      async updateDynamicRules() {
        throw new Error("DNR unavailable");
      },
    },
    storage: {
      local: {
        async get() {
          return { isBlocking: false, blockedUrls: [] };
        },
        async set() {
          storageWrites += 1;
        },
      },
    },
  };

  await assert.rejects(
    updateBlockingConfiguration(chromeApi, true, [
      { id: 1, url: "youtube.com" },
    ]),
    /DNR unavailable/,
  );
  assert.equal(storageWrites, 0);
});

test("addDomainsToBlocklist prepends only new, valid domains", () => {
  const existing = [{ id: "yt", url: "youtube.com", createdAt: "2026-01-01" }];

  const result = addDomainsToBlocklist(existing, [
    "https://www.reddit.com/r/all",
    "youtube.com",
    "not a domain",
    "reddit.com",
  ]);

  assert.deepEqual(
    result.map((item) => item.url),
    ["reddit.com", "youtube.com"],
  );
  assert.equal(result[1], existing[0]);
});

test("addDomainsToBlocklist returns the same list when nothing is new", () => {
  const existing = [{ id: "yt", url: "youtube.com" }];
  assert.equal(addDomainsToBlocklist(existing, ["www.youtube.com"]), existing);
});

test("block presets contain only normalized domains", () => {
  assert.ok(BLOCK_PRESETS.length > 0);
  for (const preset of BLOCK_PRESETS) {
    assert.ok(preset.domains.length > 0);
    for (const domain of preset.domains) {
      assert.equal(normalizeDomain(domain), domain);
    }
  }
});
