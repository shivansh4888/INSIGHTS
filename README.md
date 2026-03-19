# 🧠 PageMind — RAG Webpage Summarizer & Chat Extension

A production-grade Chrome extension that uses **Groq AI + TF-IDF RAG** to summarize any webpage and answer questions about it — **100% free, no payment setup required**.

---

## ✨ Features

- **📄 Instant Summaries** — Structured analysis with key points, insights, quick facts
- **💬 RAG-powered Chat** — Ask questions; TF-IDF retrieves the most relevant page chunks as context
- **🧠 LLaMA 3 70B** — Powered by Groq's free API (fastest LLM inference available)
- **🔒 Privacy-first** — API key stored locally in Chrome, never sent anywhere except Groq
- **⚡ Works everywhere** — News articles, documentation, research papers, blogs, wikis
- **4 Model choices** — LLaMA 3 70B, LLaMA 3 8B, Mixtral 8x7B, Gemma 2 9B

---

## 🚀 Installation

### Step 1 — Load the Extension

1. Open Chrome → go to `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **"Load unpacked"**
4. Select the `rag-summarizer-extension` folder

### Step 2 — Get a Free Groq API Key

1. Visit **https://console.groq.com/keys**
2. Sign up (free, no credit card)
3. Create a new API key starting with `gsk_`

### Step 3 — Connect

1. Click the PageMind icon in your Chrome toolbar
2. Paste your API key and click **Save & Connect**
3. Navigate to any webpage and start summarizing!

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
│                                                             │
│  ┌──────────────┐    ┌──────────────────────────────────┐  │
│  │ content.js   │    │         background.js            │  │
│  │              │    │                                  │  │
│  │ • Extract    │───▶│  ┌────────────┐  ┌────────────┐ │  │
│  │   page text  │    │  │  RAG Engine │  │ Groq API  │ │  │
│  │ • Chunk by   │    │  │            │  │           │ │  │
│  │   HTML type  │    │  │ • TF-IDF   │  │ LLaMA 3   │ │  │
│  │ • ~500 word  │    │  │   Indexing │  │ 70B / 8B  │ │  │
│  │   segments   │    │  │ • Cosine   │  │ Mixtral   │ │  │
│  └──────────────┘    │  │   Similarity│  │ Gemma 2   │ │  │
│                      │  │ • Context  │  └────────────┘ │  │
│  ┌──────────────┐    │  │   Builder  │        ▲        │  │
│  │  popup.html  │    │  └────────────┘        │        │  │
│  │  popup.js    │───▶│       │                │        │  │
│  │              │    │       └────────────────┘        │  │
│  │ • Summary UI │    │    Retrieve top-K chunks        │  │
│  │ • Chat UI    │    │    → Build context prompt       │  │
│  │ • Settings   │    │    → Call Groq API              │  │
│  └──────────────┘    └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### RAG Pipeline

1. **Extraction**: `content.js` scrapes page using semantic HTML selectors (`h1-h6`, `p`, `li`, `blockquote`, etc.)
2. **Chunking**: Text split into typed chunks, deduplicated, filtered for visibility
3. **Indexing**: TF-IDF vectors built in-memory per tab (no external vector DB needed)
4. **Retrieval**: Query vectorized → cosine similarity → top-K chunks selected
5. **Generation**: Retrieved context + query → Groq LLaMA 3 70B → streaming response

---

## 📁 File Structure

```
rag-summarizer-extension/
├── manifest.json           # Chrome MV3 manifest
├── content/
│   └── content.js          # Page text extraction
├── background/
│   ├── background.js       # Service worker + Groq API calls
│   └── rag.js              # TF-IDF RAG engine (pure JS)
├── popup/
│   ├── popup.html          # Extension UI
│   └── popup.js            # UI logic + orchestration
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🔑 Free Resources Used

| Resource | Purpose | Cost |
|----------|---------|------|
| [Groq API](https://console.groq.com) | LLM inference | Free tier |
| LLaMA 3 70B (Meta) | Main model | Free via Groq |
| TF-IDF | Vector similarity | No API needed |
| Chrome Extensions API | Browser integration | Free |
| Google Fonts | UI typography | Free |

---

## 💡 Resume-worthy Highlights

- **RAG Architecture**: Production TF-IDF vectorstore with cosine similarity retrieval
- **Chrome Extension MV3**: Service workers, content scripts, message passing
- **LLM Integration**: Groq API with model selection and prompt engineering
- **Context Window Management**: Chat history truncation, chunk size optimization
- **Privacy Engineering**: Local-only key storage, no backend server
- **Frontend Engineering**: Responsive popup UI, streaming-style UX, markdown renderer

---

## 🛠️ Development Notes

- Works on any `http://` or `https://` page
- Handles SPAs — click Refresh (↻) after navigation
- Chat history persists per-tab until refresh or manual clear
- Groq free tier: ~30 req/min, 6000 tokens/min — sufficient for normal use
