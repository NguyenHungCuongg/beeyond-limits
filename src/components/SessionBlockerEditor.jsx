import { useState } from "react";
import toast from "react-hot-toast";
import BlockedURL from "./BlockedURL";
import BlockSuggestions from "./BlockSuggestions";
import {
  addDomainsToBlocklist,
  normalizeDomain,
  sanitizeBlockedUrls,
} from "../core/blocking";
import { ChevronLeft, ShieldCheck, Globe } from "./Icons";

function SessionBlockerEditor({ blockedUrls, onUpdate, onClose }) {
  const [newUrl, setNewUrl] = useState("");

  function addBlockedUrl(event) {
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

    const nextBlockedUrls = sanitizeBlockedUrls([
      {
        id: globalThis.crypto?.randomUUID?.() ?? Date.now(),
        url: domain,
        createdAt: new Date().toISOString(),
      },
      ...blockedUrls,
    ]);

    onUpdate(nextBlockedUrls);
    setNewUrl("");
  }

  function removeBlockedUrl(urlId) {
    onUpdate(blockedUrls.filter((item) => item.id !== urlId));
  }

  function clearAllBlocked() {
    if (window.confirm("Are you sure you want to remove all blocked websites from this session?")) {
      onUpdate([]);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6 flex flex-col items-start">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to setup"
          className="flex items-center gap-1.5 text-ink font-mono uppercase font-bold hover:bg-ink hover:text-canvas px-2 py-1 border-[3px] border-transparent hover:border-ink transition-colors mb-4"
        >
          <ChevronLeft size={16} /> Back
        </button>
        <h1 className="font-display text-5xl uppercase tracking-tight leading-none mb-2 text-ink">
          Session Sites
        </h1>
      </div>

      <div className="bg-paper brutal-border brutal-shadow-sm p-4 flex justify-between items-center mb-6">
        <div className="flex items-center space-x-3 text-ink">
          <ShieldCheck size={24} />
          <p className="font-mono text-sm font-bold uppercase leading-tight">
            These sites will be blocked only during this session.
          </p>
        </div>
      </div>

      <form onSubmit={addBlockedUrl} className="mb-8 flex gap-2">
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
          disabled={!newUrl.trim()}
          className="bg-crimson text-paper brutal-border brutal-shadow-sm font-display text-2xl px-4 uppercase hover:bg-ink hover:text-canvas transition-colors disabled:opacity-50"
        >
          Block
        </button>
      </form>

      <BlockSuggestions
        blockedUrls={blockedUrls}
        onAdd={(domains) => {
          const next = addDomainsToBlocklist(blockedUrls, domains);
          if (next !== blockedUrls) onUpdate(next);
        }}
      />

      <div className="mb-6 space-y-3 pb-20">
        {blockedUrls.length > 0 ? (
          <>
            <div className="mb-4 flex items-center justify-between border-b-[3px] border-ink pb-2">
              <h2 className="font-display text-2xl uppercase">
                Session Blocklist
              </h2>
              <button
                type="button"
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
            <h2 className="mb-2 font-display text-2xl uppercase text-ink">
              List Empty
            </h2>
            <p className="font-mono text-xs font-bold uppercase">
              Add websites above
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionBlockerEditor;
