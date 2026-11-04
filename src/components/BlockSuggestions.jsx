import { useEffect, useState } from "react";
import { BLOCK_PRESETS, normalizeDomain } from "../core/blocking";

/* global chrome */

// Offers one-click additions: the active tab's domain and a few starter lists.
// The tab URL is readable thanks to the existing <all_urls> host permission; nothing is stored unless clicked.
function BlockSuggestions({ blockedUrls, onAdd, disabled = false }) {
  const [currentDomain, setCurrentDomain] = useState(null);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.tabs?.query) return;
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setCurrentDomain(normalizeDomain(tab?.url ?? "")))
      .catch(() => {});
  }, []);

  const blocked = new Set(blockedUrls.map((item) => item.url));
  const canBlockCurrent = currentDomain && !blocked.has(currentDomain);
  const presets = BLOCK_PRESETS.filter((preset) =>
    preset.domains.some((domain) => !blocked.has(domain)),
  );

  if (!canBlockCurrent && presets.length === 0) return null;

  return (
    <div className="mb-8 -mt-4 flex flex-wrap gap-2">
      {canBlockCurrent && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAdd([currentDomain])}
          className="bg-crimson text-paper brutal-border font-mono text-xs font-bold uppercase px-2 py-1 hover:bg-ink transition-colors disabled:opacity-50"
        >
          + Block this tab ({currentDomain})
        </button>
      )}
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          disabled={disabled}
          title={preset.domains.join(", ")}
          onClick={() => onAdd(preset.domains)}
          className="bg-paper text-ink brutal-border font-mono text-xs font-bold uppercase px-2 py-1 hover:bg-canvas transition-colors disabled:opacity-50"
        >
          + {preset.label}
        </button>
      ))}
    </div>
  );
}

export default BlockSuggestions;
