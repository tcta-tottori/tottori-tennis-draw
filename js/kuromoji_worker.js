/**
 * kuromoji_worker.js - Web Worker for offloading kuromoji.js initialization and parsing
 * This prevents the main UI thread from freezing during the ~15MB dictionary download and parsing.
 */

// Import kuromoji.js from CDN
importScripts('https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js');

let tokenizer = null;

// Helper to convert Katakana to Hiragana
const kataToHira = (str) => {
  return str.replace(/[ァ-ヶ]/g, (match) => {
    return String.fromCharCode(match.charCodeAt(0) - 0x60);
  });
};

// Helper to tokenize a single name part and return its furigana (hiragana)
const tokenizePart = (text) => {
  if (!tokenizer) return text;
  const tokens = tokenizer.tokenize(text);
  let result = '';
  for (const token of tokens) {
    // Some words might not have a reading in the dictionary, fallback to the surface form
    result += token.reading || token.surface_form;
  }
  return kataToHira(result);
};

// Listen for messages from the main thread
self.onmessage = function(e) {
  const { type, payload, id } = e.data;

  if (type === 'init') {
    // Initialize Kuromoji
    kuromoji.builder({ dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict' })
      .build((err, t) => {
        if (err) {
          self.postMessage({ type: 'init_error', error: err.message, id });
        } else {
          tokenizer = t;
          self.postMessage({ type: 'init_success', id });
        }
      });
  } else if (type === 'tokenize') {
    if (!tokenizer) {
      self.postMessage({ type: 'tokenize_error', error: 'Tokenizer not initialized', id });
      return;
    }

    try {
      // payload expects an array of name strings or a single string
      if (Array.isArray(payload)) {
        const results = payload.map(name => {
          if (!name) return '';
          const nameParts = name.split(/[\s　]+/).filter(p => p);
          const furiganaParts = nameParts.map(part => tokenizePart(part));
          return furiganaParts.join('\u3000'); // join with full-width space
        });
        self.postMessage({ type: 'tokenize_success', results, id });
      } else {
        self.postMessage({ type: 'tokenize_error', error: 'Payload must be an array', id });
      }
    } catch (err) {
      self.postMessage({ type: 'tokenize_error', error: err.message, id });
    }
  }
};
