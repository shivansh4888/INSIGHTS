// rag.js — Lightweight TF-IDF RAG engine (no external libraries needed)
// Runs entirely in the browser extension context

class RAGEngine {
  constructor() {
    this.chunks = [];
    this.tfidfMatrix = [];
    this.vocabulary = {};
    this.idfScores = {};
    this.initialized = false;
  }

  // ─── Tokenization ────────────────────────────────────────────────────────────

  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !this._stopWords.has(t));
  }

  // ─── Index Building ───────────────────────────────────────────────────────────

  buildIndex(chunks) {
    this.chunks = chunks;
    this.vocabulary = {};
    this.tfidfMatrix = [];

    // Build vocabulary + term frequency per document
    const tfMatrixRaw = chunks.map((chunk) => {
      const tokens = this.tokenize(chunk.text);
      const tf = {};
      tokens.forEach((t) => {
        tf[t] = (tf[t] || 0) + 1;
        if (!(t in this.vocabulary)) {
          this.vocabulary[t] = Object.keys(this.vocabulary).length;
        }
      });
      // Normalize TF by document length
      const total = tokens.length || 1;
      Object.keys(tf).forEach((k) => (tf[k] = tf[k] / total));
      return tf;
    });

    // Compute IDF
    const N = chunks.length;
    const df = {};
    tfMatrixRaw.forEach((tf) => {
      Object.keys(tf).forEach((t) => {
        df[t] = (df[t] || 0) + 1;
      });
    });
    Object.keys(df).forEach((t) => {
      this.idfScores[t] = Math.log((N + 1) / (df[t] + 1)) + 1;
    });

    // Build TF-IDF vectors
    this.tfidfMatrix = tfMatrixRaw.map((tf) => {
      const vec = {};
      Object.keys(tf).forEach((t) => {
        vec[t] = tf[t] * (this.idfScores[t] || 1);
      });
      return vec;
    });

    this.initialized = true;
  }

  // ─── Cosine Similarity ────────────────────────────────────────────────────────

  cosineSimilarity(vecA, vecB) {
    let dot = 0, normA = 0, normB = 0;
    const allKeys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
    allKeys.forEach((k) => {
      const a = vecA[k] || 0;
      const b = vecB[k] || 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    });
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ─── Query ────────────────────────────────────────────────────────────────────

  query(queryText, topK = 5) {
    if (!this.initialized || this.chunks.length === 0) return [];

    const qTokens = this.tokenize(queryText);
    const qTF = {};
    qTokens.forEach((t) => (qTF[t] = (qTF[t] || 0) + 1));
    const total = qTokens.length || 1;
    const qVec = {};
    Object.keys(qTF).forEach((t) => {
      qVec[t] = (qTF[t] / total) * (this.idfScores[t] || 1);
    });

    const scores = this.tfidfMatrix.map((docVec, i) => ({
      index: i,
      score: this.cosineSimilarity(qVec, docVec),
      chunk: this.chunks[i],
    }));

    return scores
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // ─── Context Builder ──────────────────────────────────────────────────────────

  buildContext(queryText, maxChars = 3000) {
    if (!this.initialized) return "";
    
    const results = this.query(queryText, 8);
    
    // If no relevant results, fall back to first chunks
    if (results.length === 0) {
      return this.chunks
        .slice(0, 5)
        .map((c) => c.text)
        .join("\n\n")
        .slice(0, maxChars);
    }

    let context = "";
    for (const r of results) {
      const addition = `[${r.chunk.type.toUpperCase()}]: ${r.chunk.text}\n\n`;
      if (context.length + addition.length > maxChars) break;
      context += addition;
    }
    return context.trim();
  }

  // ─── Stop Words ───────────────────────────────────────────────────────────────

  _stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
    "how", "its", "now", "did", "man", "new", "old", "see", "two", "way",
    "who", "boy", "did", "she", "use", "had", "let", "put", "say", "too",
    "this", "that", "with", "have", "from", "they", "will", "been", "more",
    "when", "what", "were", "said", "each", "which", "their", "there",
    "about", "would", "other", "into", "than", "then", "them", "these",
    "some", "time", "very", "your", "just", "know", "take", "people",
    "into", "year", "good", "much", "also", "after", "well", "only",
    "come", "over", "think", "also", "back", "after", "where", "most",
    "being", "those", "such", "here", "through", "still", "should",
    "between", "under", "never", "while", "both", "make", "before",
    "like", "same", "even", "many", "right", "does", "going", "down",
  ]);
}

// Export for use in background.js
if (typeof module !== "undefined") {
  module.exports = RAGEngine;
}
