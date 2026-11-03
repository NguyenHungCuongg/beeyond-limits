const DYNAMIC_RULE_ID_START = 1000;
const MAX_BLOCKED_DOMAINS = 5000;
const HTTP_SCHEME = /^https?:\/\//i;
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function isValidHostname(hostname) {
  if (!hostname || hostname.length > 253 || !hostname.includes(".")) {
    return false;
  }

  return hostname.split(".").every((label) => {
    return (
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    );
  });
}

export function normalizeDomain(input) {
  if (typeof input !== "string") {
    return null;
  }

  const value = input.trim();
  if (!value) {
    return null;
  }

  if (EXPLICIT_SCHEME.test(value) && !HTTP_SCHEME.test(value)) {
    return null;
  }

  try {
    const parsed = new URL(
      HTTP_SCHEME.test(value) ? value : `https://${value}`,
    );
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }

    let hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }

    return isValidHostname(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

export function sanitizeBlockedUrls(blockedUrls) {
  if (!Array.isArray(blockedUrls)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  for (const item of blockedUrls) {
    const domain = normalizeDomain(typeof item === "string" ? item : item?.url);
    if (!domain || seen.has(domain)) {
      continue;
    }

    seen.add(domain);
    normalized.push({
      ...(typeof item === "object" && item !== null ? item : {}),
      id: typeof item === "object" && item?.id != null ? item.id : domain,
      url: domain,
      createdAt:
        typeof item === "object" && item?.createdAt
          ? item.createdAt
          : new Date().toISOString(),
    });

    if (normalized.length >= MAX_BLOCKED_DOMAINS) {
      break;
    }
  }

  return normalized;
}

export function buildBlockingRules(blockedUrls) {
  return sanitizeBlockedUrls(blockedUrls).map((blockedUrl, index) => ({
    id: DYNAMIC_RULE_ID_START + index,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        extensionPath: "/blocked.html",
      },
    },
    condition: {
      requestDomains: [blockedUrl.url],
      resourceTypes: ["main_frame"],
    },
  }));
}

export async function applyBlockingRules(
  declarativeNetRequest,
  isBlocking,
  blockedUrls,
) {
  const existingRules = await declarativeNetRequest.getDynamicRules();
  const addRules = isBlocking ? buildBlockingRules(blockedUrls) : [];

  await declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map((rule) => rule.id),
    addRules,
  });

  return { ruleCount: addRules.length };
}

export async function updateBlockingConfiguration(
  chromeApi,
  isBlocking,
  blockedUrls,
  { applyRules = true } = {},
) {
  const normalizedUrls = sanitizeBlockedUrls(blockedUrls);
  const enabled = Boolean(isBlocking);
  const previous = await chromeApi.storage.local.get([
    "blockedUrls",
    "isBlocking",
  ]);

  if (applyRules) {
    await applyBlockingRules(
      chromeApi.declarativeNetRequest,
      enabled,
      normalizedUrls,
    );
  }

  try {
    await chromeApi.storage.local.set({
      blockedUrls: normalizedUrls,
      isBlocking: enabled,
    });
  } catch (error) {
    if (!applyRules) throw error;
    try {
      await applyBlockingRules(
        chromeApi.declarativeNetRequest,
        Boolean(previous.isBlocking),
        previous.blockedUrls ?? [],
      );
    } catch {
      // Preserve the original storage error; startup synchronization will repair DNR state.
    }
    throw error;
  }

  return {
    success: true,
    isBlocking: enabled,
    blockedUrls: normalizedUrls,
    ruleCount: enabled ? buildBlockingRules(normalizedUrls).length : 0,
  };
}

export async function syncBlockingRulesFromStorage(chromeApi) {
  const stored = await chromeApi.storage.local.get([
    "blockedUrls",
    "isBlocking",
  ]);
  const normalizedUrls = sanitizeBlockedUrls(stored.blockedUrls ?? []);
  const enabled = Boolean(stored.isBlocking);
  const result = await applyBlockingRules(
    chromeApi.declarativeNetRequest,
    enabled,
    normalizedUrls,
  );

  return {
    success: true,
    isBlocking: enabled,
    blockedUrls: normalizedUrls,
    ruleCount: result.ruleCount,
  };
}
