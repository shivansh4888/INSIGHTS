// content.js — Extracts structured content from any webpage

(function () {
  "use strict";

  /**
   * Extract all meaningful text from the page, organized into chunks
   * for RAG processing.
   */
  function extractPageContent() {
    const data = {
      url: window.location.href,
      title: document.title,
      metaDescription: "",
      chunks: [],
      rawText: "",
      timestamp: Date.now(),
    };

    // Meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) data.metaDescription = metaDesc.getAttribute("content") || "";

    // Open Graph data
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogTitle) data.ogTitle = ogTitle.getAttribute("content") || "";
    if (ogDesc) data.ogDescription = ogDesc.getAttribute("content") || "";

    // Extract chunks from semantic HTML elements
    const chunkSelectors = [
      { sel: "h1", type: "heading1" },
      { sel: "h2", type: "heading2" },
      { sel: "h3", type: "heading3" },
      { sel: "h4, h5, h6", type: "heading" },
      { sel: "p", type: "paragraph" },
      { sel: "li", type: "list_item" },
      { sel: "blockquote", type: "quote" },
      { sel: "td, th", type: "table_cell" },
      { sel: "figcaption", type: "caption" },
      { sel: "article", type: "article" },
      { sel: "section", type: "section" },
    ];

    const seenTexts = new Set();
    let chunkIndex = 0;

    // Skip invisible/noisy elements
    const skipTags = new Set([
      "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG",
      "NAV", "FOOTER", "HEADER", "ASIDE"
    ]);

    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        el.offsetParent !== null
      );
    }

    function isInsideSkipped(el) {
      let cur = el.parentElement;
      while (cur) {
        if (skipTags.has(cur.tagName)) return true;
        cur = cur.parentElement;
      }
      return false;
    }

    chunkSelectors.forEach(({ sel, type }) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (!isVisible(el) || isInsideSkipped(el)) return;
        const text = el.innerText?.trim();
        if (!text || text.length < 10 || seenTexts.has(text)) return;
        seenTexts.add(text);

        data.chunks.push({
          id: chunkIndex++,
          type,
          text,
          length: text.length,
        });
      });
    });

    // Fallback: body text if chunks are sparse
    if (data.chunks.length < 3) {
      const bodyText = document.body?.innerText?.trim() || "";
      if (bodyText.length > 50) {
        // Split into ~500 char paragraphs
        const sentences = bodyText.match(/[^.!?\n]{20,500}[.!?\n]*/g) || [bodyText];
        sentences.forEach((s) => {
          const clean = s.trim();
          if (clean.length > 20 && !seenTexts.has(clean)) {
            seenTexts.add(clean);
            data.chunks.push({
              id: chunkIndex++,
              type: "body",
              text: clean,
              length: clean.length,
            });
          }
        });
      }
    }

    // Build raw text for full context
    data.rawText = data.chunks.map((c) => c.text).join("\n\n");
    data.chunkCount = data.chunks.length;
    data.wordCount = data.rawText.split(/\s+/).filter(Boolean).length;

    return data;
  }

  // Listen for extraction requests from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "EXTRACT_CONTENT") {
      try {
        const content = extractPageContent();
        sendResponse({ success: true, content });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true; // async
    }

    if (msg.type === "PING") {
      sendResponse({ alive: true });
      return true;
    }
  });
})();
