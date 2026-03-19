// background.js — Service worker: Groq API + RAG orchestration

importScripts("rag.js");

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";   // ✅ updated model
const FAST_MODEL = "llama-3.1-8b-instant"; // ✅ updated fast model

// Per-tab RAG state
const tabState = new Map();

function getTabRAG(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, {
      rag: new RAGEngine(),
      pageData: null,
      chatHistory: [],
      summary: null,
    });
  }
  return tabState.get(tabId);
}

// ─── Groq API Call ────────────────────────────────────────────────────────────

async function callGroq(apiKey, messages, model = MODEL, stream = false) {
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      err?.error?.message || `Groq API error: ${response.status}`
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Summarization ────────────────────────────────────────────────────────────

async function summarizePage(apiKey, pageData) {
  const contextText = pageData.rawText.slice(0, 4000);

  const systemPrompt = `You are an expert document analyst. Analyze the provided webpage content and return a comprehensive, well-structured summary.

Format your response as follows:
## 📌 Overview
A 2-3 sentence high-level summary.

## 🔑 Key Points
- Bullet points of the most important information (5-8 points)

## 📊 Main Topics
List the primary topics/sections covered.

## 💡 Key Insights
Any notable findings, conclusions, or insights.

## 📝 Quick Facts
Important numbers, dates, names, or statistics mentioned.

Be precise and factual. Only include information present in the content.`;

  const userPrompt = `Analyze this webpage:

**URL**: ${pageData.url}
**Title**: ${pageData.title}
**Word Count**: ~${pageData.wordCount} words

**Content**:
${contextText}`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  return await callGroq(apiKey, messages);
}

// ─── RAG Q&A ──────────────────────────────────────────────────────────────────

async function answerQuestion(apiKey, question, state) {
  const { rag, pageData, chatHistory } = state;

  const context = rag.buildContext(question, 3000);

  const systemPrompt = `You are an intelligent assistant answering questions about a specific webpage. 
Use ONLY the provided context to answer. If the answer isn't in the context, say so clearly.
Be concise, accurate, and helpful. Format with markdown when it improves clarity.

**Page**: ${pageData.title}
**URL**: ${pageData.url}`;

  const recentHistory = chatHistory.slice(-8);

  const finalMessages = [
    { role: "system", content: systemPrompt },
    ...recentHistory,
    {
      role: "user",
      content: `Context:\n\n${context}\n\nQuestion: ${question}`,
    },
  ];

  return await callGroq(apiKey, finalMessages);
}

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = msg.tabId || sender.tab?.id;

  if (msg.type === "INDEX_CONTENT") {
    const { pageData } = msg;
    const state = getTabRAG(tabId);
    state.pageData = pageData;
    state.chatHistory = [];
    state.summary = null;

    try {
      state.rag.buildIndex(pageData.chunks);
      sendResponse({ success: true, chunkCount: pageData.chunks.length });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  if (msg.type === "SUMMARIZE") {
    const { apiKey, tabId: tid } = msg;
    const state = getTabRAG(tid || tabId);

    if (!state.pageData) {
      sendResponse({ success: false, error: "No page indexed yet." });
      return true;
    }

    if (state.summary) {
      sendResponse({ success: true, summary: state.summary, cached: true });
      return true;
    }

    summarizePage(apiKey, state.pageData)
      .then((summary) => {
        state.summary = summary;
        sendResponse({ success: true, summary });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.type === "ASK_QUESTION") {
    const { question, apiKey, tabId: tid } = msg;
    const state = getTabRAG(tid || tabId);

    if (!state.pageData) {
      sendResponse({ success: false, error: "No page indexed yet." });
      return true;
    }

    answerQuestion(apiKey, question, state)
      .then((answer) => {
        state.chatHistory.push(
          { role: "user", content: question },
          { role: "assistant", content: answer }
        );
        if (state.chatHistory.length > 20) {
          state.chatHistory = state.chatHistory.slice(-20);
        }
        sendResponse({ success: true, answer });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.type === "CLEAR_STATE") {
    tabState.delete(msg.tabId || tabId); // ✅ FIXED BUG (tid undefined)
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "GET_HISTORY") {
    const state = getTabRAG(msg.tabId || tabId); // ✅ FIXED BUG
    sendResponse({ success: true, history: state.chatHistory });
    return true;
  }

  if (msg.type === "VALIDATE_KEY") {
    const { apiKey } = msg;
    callGroq(apiKey, [{ role: "user", content: "Hi" }], FAST_MODEL)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});