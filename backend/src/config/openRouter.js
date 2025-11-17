const { OpenAI } = require('openai');

// Lazy initialization of the client
let client = null;

const getClient = () => {
  if (!client) {
    const baseURL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set.');
    }

    client = new OpenAI({
      baseURL,
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
        'X-Title': 'YouTube Live Comment Analyzer',
      },
    });
  }
  return client;
};

// Using a free, capable model. You can swap this out.
const MODEL = process.env.OPENROUTER_MODEL || 'z-ai/glm-4.5-air:free';
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.3;

module.exports = { getClient, MODEL, MAX_TOKENS, TEMPERATURE };