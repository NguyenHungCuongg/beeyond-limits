import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import BlockedURL from "../components/BlockedURL";
import BlockerStats from "../components/BlockerStats";
import BlockSuggestions from "../components/BlockSuggestions";
import {
  addDomainsToBlocklist,
  normalizeDomain,
  sanitizeBlockedUrls,
} from "../core/blocking";
import { ChevronLeft, ShieldCheck, Globe, Loader, Home } from "../components/Icons";

/* global chrome */

const DEFAULT_BLOCKED_URLS = [
  { id: 1, url: "youtube.com", createdAt: new Date().toISOString() },
  { id: 2, url: "facebook.com", createdAt: new Date().toISOString() },
  { id: 3, url: "tiktok.com", createdAt: new Date().toISOString() },
];

const hasExtensionStorage =
  typeof chrome !== "undefined" && Boolean(chrome.storage?.local);

function WebsiteBlocker({ onNavigate, focusSession }) {
  const [blockedUrls, setBlockedUrls] = useState([]);
  const [isBlocking, setIsBlocking] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function loadConfiguration() {
      try {
        if (hasExtensionStorage) {
          const stored = await chrome.storage.local.get([
            "blockedUrls",
            "isBlocking",
          ]);
          setBlockedUrls(
            Array.isArray(stored.blockedUrls)
              ? sanitizeBlockedUrls(stored.blockedUrls)
              : DEFAULT_BLOCKED_URLS,
          );
          setIsBlocking(Boolean(stored.isBlocking));
        } else {
          const storedUrls = localStorage.getItem("beeyond-blocked-urls");
          setBlockedUrls(
            storedUrls
              ? sanitizeBlockedUrls(JSON.parse(storedUrls))
              : DEFAULT_BLOCKED_URLS,
          );
          setIsBlocking(
            localStorage.getItem("beeyond-blocking-status") === "true",
          );
        }
      } catch (error) {
        console.error("Unable to load website blocker configuration:", error);
        toast.error("Could not load your blocklist");
      } finally {
        setIsLoading(false);
      }
    }

    loadConfiguration();
  }, []);

  async function persistConfiguration(nextIsBlocking, nextBlockedUrls) {
    const normalizedUrls = sanitizeBlockedUrls(nextBlockedUrls);
    setIsSaving(true);

    try {
      if (hasExtensionStorage) {
        const response = await chrome.runtime.sendMessage({
          type: "UPDATE_BLOCKING_RULES",
          isBlocking: nextIsBlocking,
          blockedUrls: normalizedUrls,
        });

        if (!response?.success) {
          throw new Error(response?.error || "Unable to update blocking rules");
        }

        setIsBlocking(response.isBlocking);
        setBlockedUrls(response.blockedUrls);
      } else {
        localStorage.setItem(
          "beeyond-blocked-urls",
          JSON.stringify(normalizedUrls),
        );
        localStorage.setItem("beeyond-blocking-status", String(nextIsBlocking));
        setIsBlocking(nextIsBlocking);
        setBlockedUrls(normalizedUrls);
      }

      return true;
    } catch (error) {
      console.error("Unable to update website blocker:", error);
      toast.error(error.message || "Could not update website blocking");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function addBlockedUrl(event) {
    event.preventDefault();
    const domain = normalizeDomain(newUrl);
    if (!domain) {
      toast.error("Enter a valid domain, for example youtube.com");
      return;
    }

    if (blockedUrls.some((item) => item.url === domain)) {
      toast.error("This website is already in your blocklist");
      return;
    }

    const nextBlockedUrls = [
      {
        id: globalThis.crypto?.randomUUID?.() ?? Date.now(),
        url: domain,
        createdAt: new Date().toISOString(),
      },
      ...blockedUrls,
    ];

    if (await persistConfiguration(isBlocking, nextBlockedUrls)) {
      setNewUrl("");
    }
  }

  async function removeBlockedUrl(urlId) {
    await persistConfiguration(
      isBlocking,
      blockedUrls.filter((item) => item.id !== urlId),
    );
  }

  async function clearAllBlocked() {
    if (
      window.confirm("Are you sure you want to remove all blocked websites?")
    ) {
      await persistConfiguration(isBlocking, []);
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink p-5 overflow-auto">
      <div className="mb-6 flex flex-col items-start">
        <button
          type="button"
          onClick={() => onNavigate("home")}
          aria-label="Back to home"
          className="flex items-center gap-1.5 text-ink font-mono uppercase font-bold hover:bg-ink hover:text-canvas px-2 py-1 border-[3px] border-transparent hover:border-ink transition-colors mb-4"
        >
          <ChevronLeft size={16} /> Back
        </button>
        <h1 className="font-display text-6xl uppercase tracking-tight leading-none mb-2 text-ink">
          Blocker
        </h1>
      </div>

      {focusSession?.activeSession && (
        <div className="bg-mustard text-ink brutal-border p-3 mb-6 font-mono text-sm font-bold uppercase">
          Focus Session is controlling website blocking. Changes here will apply after the session.
        </div>
      )}

      <div className="bg-paper brutal-border brutal-shadow p-4 flex justify-between items-center mb-6">
        <div className="flex items-center space-x-3">
          <ShieldCheck size={24} className="text-ink" />
          <h2 className="font-display text-2xl uppercase">
            {focusSession?.activeSession ? "Manual State (Inactive)" : "Blocking Status"}
          </h2>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isBlocking}
          aria-label="Website blocking"
          disabled={isSaving}
          onClick={() => persistConfiguration(!isBlocking, blockedUrls)}
          className={`brutal-border w-14 h-8 p-1 rounded-full relative transition-colors focus-visible:outline-none disabled:cursor-wait disabled:opacity-60 ${
            isBlocking ? "bg-emerald" : "bg-paper"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-1 left-1 w-5 h-5 bg-ink rounded-full transition-transform ${
              isBlocking ? "translate-x-6" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <BlockerStats
        blockedUrls={blockedUrls}
        isBlocking={isBlocking}
        blocksToday={0}
      />

      <form
        onSubmit={addBlockedUrl}
        className="mb-8 flex gap-2"
      >
        <label htmlFor="blocked-domain" className="sr-only">
          Website domain to block
        </label>
        <input
          id="blocked-domain"
          type="text"
          inputMode="url"
          value={newUrl}
          onChange={(event) => setNewUrl(event.target.value)}
          placeholder="youtube.com"
          className="flex-1 brutal-border brutal-shadow-sm bg-paper px-3 py-2 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-ink"
        />
        <button
          type="submit"
          disabled={!newUrl.trim() || isSaving}
          className="bg-crimson text-paper brutal-border brutal-shadow-sm font-display text-2xl px-4 uppercase hover:bg-ink hover:text-canvas transition-colors disabled:opacity-50"
        >
          Block
        </button>
      </form>

      {!isLoading && (
        <BlockSuggestions
          blockedUrls={blockedUrls}
          disabled={isSaving}
          onAdd={(domains) => {
            const next = addDomainsToBlocklist(blockedUrls, domains);
            if (next !== blockedUrls) persistConfiguration(isBlocking, next);
          }}
        />
      )}

      <div className="mb-6 space-y-3">
        {isLoading ? (
          <div className="py-12 flex justify-center text-ink" role="status">
            <Loader className="animate-spin" size={32} />
          </div>
        ) : blockedUrls.length > 0 ? (
          <>
            <div className="mb-4 flex items-center justify-between border-b-[3px] border-ink pb-2">
              <h2 className="font-display text-3xl uppercase">
                Blocked Sites
              </h2>
              <button
                type="button"
                disabled={isSaving}
                onClick={clearAllBlocked}
                className="font-mono text-sm font-bold uppercase bg-paper px-2 py-1 brutal-border hover:bg-crimson hover:text-white transition-colors"
              >
                Clear All
              </button>
            </div>
            <div className="space-y-3">
              {blockedUrls.map((blockedUrl) => (
                <BlockedURL
                  key={blockedUrl.id}
                  blockedUrl={blockedUrl}
                  onRemove={removeBlockedUrl}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="py-12 text-center border-[3px] border-ink border-dashed bg-paper">
            <Globe size={48} className="text-ink mx-auto mb-4" />
            <h2 className="mb-2 font-display text-3xl uppercase text-ink">
              List Empty
            </h2>
            <p className="font-mono text-sm font-bold uppercase">
              Add websites above
            </p>
          </div>
        )}
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={() => onNavigate("home")}
          className="bg-paper text-ink brutal-border font-display text-2xl uppercase py-3 w-full flex items-center justify-center gap-2 hover:bg-emerald hover:brutal-shadow-sm transition-all"
        >
          <Home size={20} /> Home
        </button>
      </div>
    </div>
  );
}

export default WebsiteBlocker;
