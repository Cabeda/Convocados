/**
 * Custom client-side router for the Convocados main app.
 *
 * Why this exists: Astro's built-in `<ClientRouter />` has two issues
 * with this stack (Astro 6 + React 19 + `client:only="react"` + MUI 6):
 *
 *   1. With `client:only`, the iframe-based "render the next page in a
 *      hidden iframe" step leaves the new page's React component
 *      unmounted after the body swap. The new page renders as a blank
 *      `<astro-island>`.
 *   2. With `client:load`, the SSR transform of MUI 6 throws on MUI's
 *      directory-style ESM imports (e.g. `import x from
 *      "@mui/utils/formatMuiErrorMessage"`), because Node 22's ESM
 *      resolver doesn't auto-resolve directories to `index.js`.
 *
 * This router sidesteps both by NOT using Astro's iframe approach and
 * NOT relying on SSR'd React content. Instead it:
 *
 *   - Intercepts same-origin link clicks.
 *   - Uses the browser's `Document.startViewTransition()` API to capture
 *     a snapshot of the current page, fetch the new page's HTML,
 *     swap the body content, and animate the transition. On browsers
 *     without the API, it falls back to a full document load.
 *   - After the body swap, re-executes the new body's `<script>` tags
 *     so the `astro-island` custom element hydrates the React app
 *     (same as a normal page load).
 *
 * Result: a smooth cross-fade between pages, no white blink, and the
 * React app mounts cleanly on every page.
 */

(function () {
  "use strict";

  const isSameOrigin = (url) => url.origin === window.location.origin;
  const isModifiedClick = (e) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
  const isDownload = (a) => a.hasAttribute("download");
  const isExternal = (a) => a.target && a.target !== "" && a.target !== "_self";
  const isHashOnly = (a) => {
    const url = new URL(a.href, window.location.href);
    return url.origin === window.location.origin && url.pathname === window.location.pathname && url.hash;
  };

  function shouldIntercept(a, e) {
    if (!a || !a.href) return false;
    if (a.target === "_blank") return false;
    if (isModifiedClick(e)) return false;
    if (e.button !== undefined && e.button !== 0) return false;
    if (isDownload(a)) return false;
    if (isExternal(a)) return false;
    if (a.hasAttribute("data-astro-reload")) return false;
    let url;
    try { url = new URL(a.href, window.location.href); } catch { return false; }
    if (!isSameOrigin(url)) return false;
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (isHashOnly(a)) return false; // let the browser scroll
    return true;
  }

  /**
   * Parse the new HTML and return just the `<body>`'s innerHTML.
   * Uses DOMParser so the source HTML doesn't execute its `<script>` tags
   * in the parent document.
   */
  function extractBody(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return {
      body: doc.body.innerHTML,
      head: doc.head.innerHTML, // for theme-color / canonical / etc
      title: doc.title,
      // Pass through any view-transition-name set on the new <main>
      mainTransitionName: doc.querySelector("main")?.style?.getPropertyValue("view-transition-name") ?? null,
    };
  }

  /**
   * Re-execute the `<script>` tags in the swapped body. DOMParser doesn't
   * execute scripts; we have to re-create them.
   *
   * The new body carries the `astro-island` hydration script. Without
   * re-executing it, the new `<astro-island>` elements never get their
   * `connectedCallback` and never hydrate.
   */
  function reExecuteScripts(root) {
    const scripts = Array.from(root.querySelectorAll("script"));
    for (const old of scripts) {
      const fresh = document.createElement("script");
      // Copy attributes (src, type, etc) so module scripts load their
      // import map and hydrate the astro-island custom element.
      for (const attr of Array.from(old.attributes)) {
        fresh.setAttribute(attr.name, attr.value);
      }
      // Inline scripts need their text copied too. Module scripts load
      // their source from `src` and don't need text.
      if (!old.src) {
        fresh.textContent = old.textContent;
      }
      // Replace so the old script (which has no impact after parse) is
      // cleared and the new one runs.
      old.replaceWith(fresh);
    }
  }

  /**
   * Update the document's `<head>` with the new page's head. We only
   * touch the meta + link + title tags — we don't replace the whole
   * head (that would clobber the persistent shell and inline scripts
   * like this one).
   */
  function updateHead(newHead) {
    // Title
    if (newHead.title) {
      document.title = newHead.title;
    }
    // Replace meta[name] and link[rel] elements that the new page
    // overrides. We keep elements that the new page doesn't mention
    // (e.g. the manifest.json link, the favicon, view-transition
    // meta tags, our nav.js script).
    const swapTags = ["meta[name]", "link[rel='canonical']"];
    for (const sel of swapTags) {
      const fresh = newHead.querySelectorAll(sel);
      const current = document.head.querySelectorAll(sel);
      // Build a quick key for matching
      const keyOf = (el) => {
        if (el.tagName === "META") return `name:${el.getAttribute("name")}`;
        if (el.tagName === "LINK" && el.getAttribute("rel") === "canonical") {
          return `canonical`;
        }
        return null;
      };
      // Remove current tags that aren't in the new set
      for (const c of current) {
        const k = keyOf(c);
        if (!k) continue;
        const replacement = Array.from(fresh).find((f) => keyOf(f) === k);
        if (replacement) {
          // Replace attribute by attribute
          for (const attr of Array.from(c.attributes)) c.removeAttribute(attr.name);
          for (const attr of Array.from(replacement.attributes)) c.setAttribute(attr.name, attr.value);
        }
        // If no replacement, leave the current one in place (favicon, etc.)
      }
      // Add new tags that don't exist yet
      for (const f of fresh) {
        const k = keyOf(f);
        if (!k) continue;
        const exists = document.head.querySelector(sel + `[${k.startsWith("name:") ? "name" : "rel"}="${k.split(":")[1] || ""}"]`);
        if (!exists) {
          document.head.appendChild(f.cloneNode(true));
        }
      }
    }
  }

  async function navigate(href) {
    if (window.location.href === href) return;
    if (document.startViewTransition) {
      try {
        const transition = document.startViewTransition(async () => {
          try {
            const res = await fetch(href, { headers: { Accept: "text/html" } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const html = await res.text();
            const { body, head, title, mainTransitionName } = extractBody(html);
            // Update head (title, meta, canonical)
            const headDoc = new DOMParser().parseFromString(`<head>${head}</head>`, "text/html");
            updateHead({ title, ...headDoc.head });
            // Swap body
            document.body.innerHTML = body;
            const main = document.querySelector("main");
            if (main && mainTransitionName) {
              main.style.viewTransitionName = mainTransitionName;
            }
            reExecuteScripts(document.body);
            // Update the URL bar
            history.pushState({}, "", href);
            const target = new URL(href).hash;
            if (target) {
              const el = document.querySelector(target);
              if (el) el.scrollIntoView();
            } else {
              window.scrollTo(0, 0);
            }
            document.dispatchEvent(new Event("convocados:navigated"));
          } catch (err) {
            console.error("[nav] navigate inner error", err);
            // Force a full reload as a last resort
            window.location.href = href;
          }
        });
        await transition.ready.catch((err) => {
          console.error("[nav] transition.ready error", err);
        });
        return;
      } catch (err) {
        console.error("[nav] view transition failed, falling back to full load", err);
      }
    }
    // Fallback: full document load.
    window.location.href = href;
  }

  document.addEventListener("click", (e) => {
    // Only left-click without modifiers
    if (e.defaultPrevented) return;
    const a = e.target instanceof Element ? e.target.closest("a") : null;
    if (!a) return;
    if (!shouldIntercept(a, e)) return;
    e.preventDefault();
    navigate(a.href);
  });

  // Handle browser back/forward buttons
  window.addEventListener("popstate", () => {
    // The popstate event fires BEFORE the URL changes. Read it from
    // window.location and reload.
    navigate(window.location.href);
  });
})();
