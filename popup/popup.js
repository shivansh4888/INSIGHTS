// popup.js — Full UI controller for PageMind extension

(async function () {
  "use strict";

  // ─── State ────────────────────────────────────────────────────────────────────

  let currentTab = null;
  let apiKey = null;
  let selectedModel = "llama3-70b-8192";
  let pageIndexed = false;
  let isLoading = false;
  let summaryText = "";

  // ─── DOM Refs ─────────────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);

  const panels = {
    setup: $("panel-setup"),
    summary: $("panel-summary"),
    chat: $("panel-chat"),
    settings: $("panel-settings"),
  };

  const statusDot = $("status-dot");
  const statusText = $("status-text");
  const wordCount = $("word-count");
  const summaryContent = $("summary-content");
  const chatMessages = $("chat-messages");
  const chatInput = $("chat-input");
  const suggestedQs = $("suggested-qs");
  const toast = $("toast");

  // ─── Init ─────────────────────────────────────────────────────────────────────

  async function init() {
    // Load saved settings
    const stored = await chrome.storage.local.get(["groqApiKey", "selectedModel"]);
    apiKey = stored.groqApiKey || null;
    selectedModel = stored.selectedModel || "llama3-70b-8192";

    // Update model selector UI
    updateModelUI();

    if (!apiKey) {
      showPanel("setup");
      setStatus("idle", "Enter your Groq API key to start");
      return;
    }

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    // Hide tabs initially
    showPanel("summary");
    setStatus("loading", "Scanning page…");

    await extractAndIndex();
  }

  // ─── Page Extraction & Indexing ───────────────────────────────────────────────

  async function extractAndIndex() {
    if (!currentTab) return;

    setStatus("loading", "Extracting content…");
    pageIndexed = false;

    try {
      // Inject content script if needed
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ["content/content.js"],
      }).catch(() => {}); // May already be injected

      // Extract content from page
      const response = await chrome.tabs.sendMessage(currentTab.id, {
        type: "EXTRACT_CONTENT",
      });

      if (!response?.success || !response.content) {
        throw new Error("Could not extract page content. Try refreshing the page.");
      }

      const content = response.content;

      // Index in background worker
      const indexResp = await chrome.runtime.sendMessage({
        type: "INDEX_CONTENT",
        tabId: currentTab.id,
        pageData: content,
        apiKey,
      });

      if (!indexResp?.success) {
        throw new Error(indexResp?.error || "Failed to index content");
      }

      pageIndexed = true;
      const wc = content.wordCount || 0;
      wordCount.textContent = `${wc.toLocaleString()} words`;
      setStatus("ready", `Ready — ${indexResp.chunkCount} chunks indexed`);

      // Show suggested questions
      showSuggestedQuestions(content.title, content.metaDescription);

    } catch (err) {
      setStatus("error", err.message);
      wordCount.textContent = "";
      showToast(err.message, "error");
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────────

  async function generateSummary() {
    if (!pageIndexed) {
      showToast("Page not indexed yet. Please wait.", "error");
      return;
    }
    if (isLoading) return;

    isLoading = true;
    $("btn-summarize").disabled = true;
    $("btn-summarize").textContent = "⏳ Analyzing…";

    summaryContent.innerHTML = `
      <div style="padding: 8px 0;">
        <div class="skeleton" style="width:60%"></div>
        <div class="skeleton" style="width:100%"></div>
        <div class="skeleton" style="width:80%"></div>
        <div style="height:12px"></div>
        <div class="skeleton" style="width:40%"></div>
        <div class="skeleton" style="width:90%"></div>
        <div class="skeleton" style="width:70%"></div>
        <div class="skeleton" style="width:85%"></div>
      </div>`;

    try {
      const resp = await chrome.runtime.sendMessage({
        type: "SUMMARIZE",
        apiKey,
        tabId: currentTab.id,
        model: selectedModel,
      });

      if (!resp?.success) throw new Error(resp?.error || "Summary failed");

      summaryText = resp.summary;
      summaryContent.innerHTML = `<div class="summary-md">${renderMarkdown(resp.summary)}</div>`;

      if (resp.cached) showToast("Loaded cached summary");

    } catch (err) {
      summaryContent.innerHTML = `
        <div class="summary-placeholder">
          <div class="ph-icon">⚠️</div>
          <p style="color:var(--red)">${escapeHtml(err.message)}</p>
        </div>`;
      showToast(err.message, "error");
    } finally {
      isLoading = false;
      $("btn-summarize").disabled = false;
      $("btn-summarize").innerHTML = "✨ Generate Summary";
    }
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────────

  let firstMessage = true;

  async function sendMessage() {
    const question = chatInput.value.trim();
    if (!question || isLoading) return;

    if (!pageIndexed) {
      showToast("Page not indexed yet.", "error");
      return;
    }

    if (firstMessage) {
      chatMessages.innerHTML = "";
      suggestedQs.style.display = "none";
      firstMessage = false;
    }

    // Add user message
    appendMessage("user", question);
    chatInput.value = "";
    autoResizeTextarea(chatInput);
    isLoading = true;
    $("btn-send").disabled = true;

    // Add typing indicator
    const typingEl = document.createElement("div");
    typingEl.className = "message assistant";
    typingEl.innerHTML = `
      <div class="message-role">PageMind</div>
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>`;
    chatMessages.appendChild(typingEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      const resp = await chrome.runtime.sendMessage({
        type: "ASK_QUESTION",
        question,
        apiKey,
        tabId: currentTab.id,
        model: selectedModel,
      });

      chatMessages.removeChild(typingEl);

      if (!resp?.success) throw new Error(resp?.error || "Failed to get answer");

      appendMessage("assistant", resp.answer);

    } catch (err) {
      chatMessages.removeChild(typingEl);
      appendMessage("assistant", `❌ ${err.message}`);
    } finally {
      isLoading = false;
      $("btn-send").disabled = false;
      chatInput.focus();
    }
  }

  function appendMessage(role, text) {
    const msgEl = document.createElement("div");
    msgEl.className = `message ${role}`;
    msgEl.innerHTML = `
      <div class="message-role">${role === "user" ? "You" : "PageMind"}</div>
      <div class="message-bubble">${role === "assistant" ? renderMarkdown(text) : escapeHtml(text)}</div>`;
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ─── Suggested Questions ──────────────────────────────────────────────────────

  function showSuggestedQuestions(title, description) {
    const questions = generateSuggestedQuestions(title, description);
    if (questions.length === 0) return;

    suggestedQs.style.display = "flex";
    // Clear existing chips except label
    const existing = suggestedQs.querySelectorAll(".sq-chip");
    existing.forEach((e) => e.remove());

    questions.forEach((q) => {
      const chip = document.createElement("button");
      chip.className = "sq-chip";
      chip.textContent = q;
      chip.addEventListener("click", () => {
        chatInput.value = q;
        switchTab("chat");
        sendMessage();
      });
      suggestedQs.appendChild(chip);
    });
  }

  function generateSuggestedQuestions(title, description) {
    const generic = [
      "What is the main topic of this page?",
      "Summarize the key points in 3 bullets",
      "What are the most important facts mentioned?",
    ];
    return generic;
  }

  // ─── Tab Switching ────────────────────────────────────────────────────────────

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    Object.entries(panels).forEach(([key, panel]) => {
      panel.classList.toggle("active", key === name);
    });
  }

  function showPanel(name) {
    Object.values(panels).forEach((p) => p.classList.remove("active"));
    if (panels[name]) panels[name].classList.add("active");
  }

  // ─── Status ───────────────────────────────────────────────────────────────────

  function setStatus(state, text) {
    statusDot.className = "status-dot";
    if (state === "ready") statusDot.classList.add("ready");
    else if (state === "loading") statusDot.classList.add("loading");
    else if (state === "error") statusDot.classList.add("error");
    statusText.textContent = text;
  }

  // ─── Toast ────────────────────────────────────────────────────────────────────

  let toastTimer;
  function showToast(message, type = "") {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = "toast show" + (type ? " " + type : "");
    toastTimer = setTimeout(() => (toast.className = "toast"), 2500);
  }

  // ─── Markdown Renderer (minimal) ──────────────────────────────────────────────

  function renderMarkdown(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Headers
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Inline code
      .replace(/`(.+?)`/g, "<code>$1</code>")
      // Bullet lists
      .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>")
      // Paragraphs
      .replace(/\n\n(?!<)/g, "</p><p>")
      .replace(/^(?!<)(.+)/, "<p>$1")
      .replace(/(?!>)(.+)$/, "$1</p>")
      // Clean up
      .replace(/<p><\/p>/g, "")
      .replace(/<p>(<h[23]>)/g, "$1")
      .replace(/(<\/h[23]>)<\/p>/g, "$1")
      .replace(/<p>(<ul>)/g, "$1")
      .replace(/(<\/ul>)<\/p>/g, "$1");
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ─── Model UI ─────────────────────────────────────────────────────────────────

  function updateModelUI() {
    document.querySelectorAll(".model-card").forEach((card) => {
      card.classList.toggle("selected", card.dataset.model === selectedModel);
    });
  }

  // ─── Textarea Auto-resize ─────────────────────────────────────────────────────

  function autoResizeTextarea(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 80) + "px";
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────────

  // Tab switching
  document.querySelectorAll(".tab[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Setup: save API key
  $("btn-save-key").addEventListener("click", async () => {
    const key = $("api-key-input").value.trim();
    if (!key || !key.startsWith("gsk_")) {
      showToast("Invalid key format. Should start with gsk_", "error");
      return;
    }

    $("btn-save-key").textContent = "Validating…";
    $("btn-save-key").disabled = true;

    const resp = await chrome.runtime.sendMessage({ type: "VALIDATE_KEY", apiKey: key });

    if (!resp?.success) {
      showToast(resp?.error || "Invalid API key", "error");
      $("btn-save-key").textContent = "✓ Save & Connect";
      $("btn-save-key").disabled = false;
      return;
    }

    await chrome.storage.local.set({ groqApiKey: key });
    apiKey = key;
    showToast("Connected! ✓", "success");

    showPanel("summary");
    switchTab("summary");
    await extractAndIndex();
  });

  // Summarize button
  $("btn-summarize").addEventListener("click", generateSummary);

  // Copy summary
  $("btn-copy-summary").addEventListener("click", () => {
    if (!summaryText) { showToast("Nothing to copy", "error"); return; }
    navigator.clipboard.writeText(summaryText).then(() => showToast("Copied!", "success"));
  });

  // Refresh
  $("btn-refresh").addEventListener("click", async () => {
    if (isLoading) return;
    await extractAndIndex();
  });

  // Settings toggle
  $("btn-settings-toggle").addEventListener("click", () => {
    const isSettings = panels.settings.classList.contains("active");
    if (isSettings) switchTab("summary");
    else switchTab("settings");
  });

  // Chat send
  $("btn-send").addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  chatInput.addEventListener("input", () => autoResizeTextarea(chatInput));

  // Model selection
  document.querySelectorAll(".model-card").forEach((card) => {
    card.addEventListener("click", async () => {
      selectedModel = card.dataset.model;
      await chrome.storage.local.set({ selectedModel });
      updateModelUI();
      showToast(`Model: ${card.querySelector(".model-card-name").textContent}`);
    });
  });

  // Update API key in settings
  $("btn-update-key").addEventListener("click", async () => {
    const key = $("settings-key-input").value.trim();
    if (!key || !key.startsWith("gsk_")) {
      showToast("Invalid key format", "error");
      return;
    }
    await chrome.storage.local.set({ groqApiKey: key });
    apiKey = key;
    showToast("API key updated!", "success");
    $("settings-key-input").value = "";
  });

  // Clear chat
  $("btn-clear-chat").addEventListener("click", async () => {
    if (currentTab) {
      await chrome.runtime.sendMessage({ type: "CLEAR_STATE", tabId: currentTab.id });
    }
    chatMessages.innerHTML = `
      <div class="chat-empty">
        <div class="ph-icon">💬</div>
        <p>Ask anything about this page.<br/>RAG retrieves the most relevant context.</p>
      </div>`;
    firstMessage = true;
    showToast("Chat cleared");
  });

  // ─── Boot ─────────────────────────────────────────────────────────────────────

  await init();
})();
