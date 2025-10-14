const { OpenAI } = require('openai');

// Lazy initialization of the client
let client = null;

const getClient = () => {
  if (!client) {
    // Set the environment variable that OpenAI client expects
    process.env.OPENAI_API_KEY = process.env.OPENROUTER_API_KEY;
    
    client = new OpenAI({
      base_url: "https://openrouter.ai/api/v1",
      api_key: process.env.OPENROUTER_API_KEY,
      // Add headers for OpenRouter rankings
      default_headers: {
        "HTTP-Referer": process.env.FRONTEND_URL,
        "X-Title": "YouTube Live Comment Analyzer",
      }
    });
  }
  return client;
};

// Using a free, capable model. You can swap this out.
const MODEL = 'meta-llama/llama-3.1-8b-instruct:free'; 
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.5;

module.exports = { getClient, MODEL, MAX_TOKENS, TEMPERATURE };