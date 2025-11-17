const { getClient, MODEL, MAX_TOKENS, TEMPERATURE } = require('../config/openRouter');
const logger = require('../utils/logger');

const POSITIVE_WORDS = ['love', 'great', 'awesome', 'amazing', 'good', 'cool', 'nice', 'enjoy', 'thanks', 'beautiful'];
const NEGATIVE_WORDS = ['bad', 'hate', 'sad', 'angry', 'annoyed', 'worst', 'boring', 'tired', 'cry'];
const STOP_WORDS = new Set([
  // English
  'the','a','an','and','or','but','if','then','so','than','that','this','these','those','to','of','in','on','at','for','from','by','with','about','as','it','is','are','was','were','be','been','being','i','you','your','yours','we','they','them','he','she','his','her','our','their','my','me','mine','us','do','did','does','doing','just','like','yeah','yes','no','okay','ok','pls','please','bro','dude','guys','lol','haha','lmao','omg',
  // Common Hinglish/Hindi fillers
  'nhi','nahi','nahin','mujhe','mujhko','tum','aap','hum','haan','haanji','bhai','bhaiya','bhava','arey','arre','kya','kyu','kyun','ka','ki','ke','hai','hain','tha','thi','the','hogaya','hoga','achha','accha','acha','bas','bahut','zyada','thoda','mat','please','kr','kar','haii','guyz','bye','goodbye','goodnight','gn'
]);

class LLMService {
  constructor() {
    this.model = MODEL;
    this.maxTokens = MAX_TOKENS;
    this.temperature = TEMPERATURE;
  }

  async callLLM(systemPrompt, userPrompt) {
    try {
      logger.info('Making LLM API call', { model: this.model, maxTokens: this.maxTokens });
      const client = getClient();
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        response_format: { type: 'json_object' }
      });

      logger.info('LLM API call completed', { 
        hasContent: !!response?.choices?.[0]?.message?.content,
        responseLength: response?.choices?.[0]?.message?.content?.length || 0
      });
      
      const content = response?.choices?.[0]?.message?.content;
      if (!content) {
        logger.warn('LLM returned empty content, checking response structure', { 
          response: JSON.stringify(response, null, 2).substring(0, 500) 
        });
        throw new Error('Empty response from LLM');
      }

      const parsed = this.safeParse(content);
      if (!parsed) {
        logger.warn('Failed to parse LLM response as JSON', { 
          content: content.substring(0, 200) 
        });
        throw new Error('Unable to parse LLM JSON output');
      }

      return parsed;
    } catch (error) {
      logger.error('LLM Call Failed', { 
        error: error.message, 
        prompt: userPrompt.substring(0, 200),
        model: this.model,
        maxTokens: this.maxTokens
      });
      throw error;
    }
  }

  safeParse(rawContent) {
    try {
      return JSON.parse(rawContent);
    } catch (err) {
      const start = rawContent.indexOf('{');
      const end = rawContent.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end >= start) {
        const snippet = rawContent.slice(start, end + 1);
        try {
          return JSON.parse(snippet);
        } catch (innerErr) {
          logger.warn('Failed to parse trimmed LLM JSON response', {
            error: innerErr.message,
            snippet: snippet.substring(0, 200)
          });
        }
      }
      logger.warn('LLM returned non-JSON response', {
        preview: rawContent.substring(0, 200)
      });
      return null;
    }
  }

  // 1. CHAT SUMMARIZATION SERVICE
  async summarizeChat(messages, streamMetadata) {
    const systemPrompt = `You are a YouTube Live Chat Summarizer. Your role is to create concise, engaging summaries of live chat conversations.

CRITICAL INSTRUCTIONS:
1. Always respond with valid JSON only.
2. Write a SPECIFIC, DETAILED narrative summary of 4-5 sentences that describes WHAT viewers are actually talking about.
3. DO NOT use generic template phrases like "This batch shows high activity", "Conversation broadly centers on", "Common questions include", etc.
4. INSTEAD, write naturally as if summarizing a conversation: "Viewers are discussing [specific topic] with [specific examples]..."
5. Include actual content from the chat - mention specific people's names, topics discussed, reactions shared, and questions asked.
6. Make it feel like you're describing a real conversation that happened, not just listing statistics.

JSON SCHEMA:
{
  "summary": "A 4-5 sentence natural narrative describing the actual chat conversation",
  "main_topics": ["topic1", "topic2"],
  "engagement_level": "high|medium|low",
  "viewer_sentiment": "positive|neutral|negative",
  "word_count": 150
}

BAD EXAMPLE (DO NOT DO THIS):
"This batch shows high activity with 200 messages. Conversation broadly centers on Not, Sofia, Rubby, Anaa. Common questions include: 'hm ?💀😅' and 'aditya who are you talking to?'. Overall tone is neutral."

GOOD EXAMPLE:
"Viewers are enthusiastically discussing the stream, with several people including Not, Sofia, Rubby, and Anaa joining the conversation. Aditya sparked curiosity when others asked who he was talking to. The chat is filled with lighthearted reactions like laughing emojis (💀😅) and playful interactions. People are sharing mixed feelings with comments like 'saying i don't know feeling 💀😂'. Overall, the tone is friendly and casual with viewers engaging freely with each other and the streamer."`;

    const userPrompt = `Summarize this live chat from YouTube stream "${streamMetadata.title}":
STREAM CONTEXT:
- Channel: ${streamMetadata.channelTitle}
- Time range: ${streamMetadata.batchStartTime} to ${streamMetadata.batchEndTime}
CHAT MESSAGES (${messages.length} messages):
 ${messages.map(msg => `[${msg.timestamp}] ${msg.author}: ${msg.text}`).join('\n')}

Write a natural, detailed 4-5 sentence summary that describes WHAT viewers actually discussed, WHO they mentioned, WHAT questions they asked, and HOW they reacted. Make it specific and avoid generic templates.`;

    try {
      return await this.callLLM(systemPrompt, userPrompt);
    } catch {
      logger.warn('Falling back to heuristic summary');
      const fb = fallbackSummary(messages, streamMetadata);
      const topics = Array.isArray(fb.key_themes) ? fb.key_themes.slice(0, 6) : [];
      const text = String(fb.summary || '');
      return {
        summary: text,
        main_topics: topics,
        engagement_level: fb.engagement_level || 'low',
        viewer_sentiment: fb.viewer_sentiment || 'neutral',
        word_count: Math.min(200, text.split(/\s+/).length)
      };
    }
  }

  // 2. SENTIMENT ANALYSIS SERVICE
  async analyzeSentiment(messages) {
    const systemPrompt = `You are a sentiment analysis expert for YouTube live chats. Analyze the sentiment of the provided messages.
REQUIREMENTS:
1. Always respond with valid JSON only.
2. Calculate the overall sentiment based on the proportion of positive, neutral, and negative messages.
3. Extract and list specific negative words/phrases found in the messages (if any).
4. Provide a brief summary of the sentiment.
JSON SCHEMA:
{
  "overall_sentiment": "positive|neutral|negative",
  "distribution": { "positive": 0.6, "neutral": 0.3, "negative": 0.1 },
  "negative_words": ["word1", "word2"],
  "summary": "The chat sentiment is largely positive, with viewers expressing excitement and agreement."
}`;

    const userPrompt = `Analyze the sentiment of these live chat messages:
CHAT MESSAGES (${messages.length} messages):
 ${messages.map(msg => `${msg.text}`).join('\n')}

Calculate sentiment distribution and list any negative words or phrases you find in the messages.`;

    try {
      const result = await this.callLLM(systemPrompt, userPrompt);
      // Ensure negative_words array exists
      if (!result.negative_words) {
        result.negative_words = [];
      }
      return result;
    } catch {
      logger.warn('Falling back to heuristic sentiment analysis');
      return fallbackSentiment(messages);
    }
  }

  // 3. FREQUENT QUESTIONS SERVICE
  async findFrequentQuestions(messages) {
    const systemPrompt = `You are an expert at identifying questions in a live chat. Find the most frequently asked and important questions.
REQUIREMENTS:
1. Always respond with valid JSON only.
2. Group similar questions together.
3. List up to 5 top questions.
JSON SCHEMA:
{
  "frequent_questions": [
    { "question": "What graphics card do you use?", "count": 15, "theme": "Hardware" },
    { "question": "Will this run on my PC?", "count": 10, "theme": "Compatibility" }
  ]
}`;

    const userPrompt = `Identify the most frequent questions from these live chat messages:
CHAT MESSAGES (${messages.length} messages):
 ${messages.map(msg => `${msg.text}`).join('\n')}`;

    try {
      return await this.callLLM(systemPrompt, userPrompt);
    } catch {
      logger.warn('Falling back to heuristic question extraction');
      return fallbackQuestions(messages);
    }
  }

  // 4. MODERATION & CONTENT SUGGESTIONS SERVICE
  async generateModeratorSuggestions(messages, streamMetadata) {
    const systemPrompt = `You are a professional live stream moderator and community manager. Analyze the chat and provide actionable suggestions for the streamer.
REQUIREMENTS:
1. Always respond with valid JSON only.
2. Suggest engaging polls.
3. Highlight potential issues (spam, toxicity).
4. Suggest topics or questions the streamer should address.
JSON SCHEMA:
{
  "poll_suggestions": [
    { "question": "What should we build next?", "options": ["A castle", "A spaceship", "A giant robot"] }
  ],
  "moderation_alerts": ["User 'spammer123' is sending repetitive links."],
  "engagement_suggestions": ["Many viewers are asking about your setup. Consider doing a quick tour.", "The chat is excited about the new game feature. Spend more time on it."]
}`;

    const userPrompt = `Provide moderator suggestions for the stream "${streamMetadata.title}":
CHAT MESSAGES (${messages.length} messages):
 ${messages.map(msg => `[${msg.author}] ${msg.text}`).join('\n')}`;

    try {
      return await this.callLLM(systemPrompt, userPrompt);
    } catch {
      logger.warn('Falling back to heuristic moderator suggestions');
      return fallbackModerator(messages);
    }
  }

  // 5. TRENDING TOPICS SERVICE
  async findTrendingTopics(messages) {
    const systemPrompt = `You are an expert at identifying trending topics and keywords in a fast-moving live chat.
REQUIREMENTS:
1. Always respond with valid JSON only.
2. Identify keywords, hashtags, and topics that are gaining traction.
3. Rank them by frequency and relevance.
JSON SCHEMA:
{
  "trending_topics": [
    { "topic": "New Update", "mentions": 25, "keywords": ["update", "patch", "new"] },
    { "topic": "Game Strategy", "mentions": 18, "keywords": ["strategy", "how to", "build"] }
  ]
}`;

    const userPrompt = `Identify the top trending topics from these live chat messages:
CHAT MESSAGES (${messages.length} messages):
 ${messages.map(msg => `${msg.text}`).join('\n')}`;

    try {
      return await this.callLLM(systemPrompt, userPrompt);
    } catch {
      logger.warn('Falling back to heuristic trending topics');
      return fallbackTrending(messages);
    }
  }

  // SINGLE-CALL FULL ANALYSIS SERVICE
  async analyzeAll(messages, streamMetadata) {
    const systemPrompt = `You are a YouTube Live Chat Analyst. Produce a complete analysis for the given live chat batch.
REQUIREMENTS:
1. Respond with VALID JSON ONLY. Do not include any extra text.
2. Avoid stop-words or filler words as themes/topics (e.g., "the", "like", "nhi", "mujhe").
3. Keep summary 3-5 sentences, human-friendly, and SPECIFIC - describe actual conversations, not generic patterns.
4. DO NOT use template phrases like "This batch shows..." or "Conversation broadly centers on..."
5. Include negative words in sentiment analysis if found.
6. Always include all sections even if empty arrays.


JSON SCHEMA:
{
  "summary": {
    "summary": "5-7 sentences of SPECIFIC narrative describing actual chat conversations as mentioned in the point",
    "key_themes": ["theme1", "theme2", "theme3"],
    "engagement_level": "high|medium|low",
    "notable_moments": ["moment1", "moment2"],
    "viewer_sentiment": "positive|neutral|negative",
    "word_count": 120
  },
  "sentiment": {
    "overall_sentiment": "positive|neutral|negative",
    "distribution": { "positive": 0.4, "neutral": 0.4, "negative": 0.2 },
    "negative_words": ["word1", "word2"],
    "summary": "1-2 sentence description"
  },
  "questions": {
    "frequent_questions": [ { "question": "string", "count": 3, "theme": "string" } ]
  },
  "moderation": {
    "poll_suggestions": [ { "question": "string", "options": ["A","B"] } ],
    "moderation_alerts": ["string"],
    "engagement_suggestions": ["string"]
  },
  "trending": {
    "trending_topics": [ { "topic": "string", "mentions": 5, "keywords": ["a","b"] } ]
  }
}`;

    const userPrompt = `Analyze this YouTube live chat batch for the stream "${streamMetadata.title}":
STREAM CONTEXT:
- Channel: ${streamMetadata.channelTitle}
- Time range: ${streamMetadata.batchStartTime} to ${streamMetadata.batchEndTime}
CHAT MESSAGES (${messages.length} messages):
${messages.map(m => `[${m.timestamp}] ${m.author}: ${m.text}`).join('\n')}

Write a SPECIFIC summary describing what viewers actually discussed. like as think as you are a human and you are summarizing the conversation with the person who is watching the stream with 4-5 sentences should be a paragraph do not include any other text or information like about the people in the stream name you just have to give very high level summary of the conversation`;

    // Try LLM call with retry mechanism
    let attempts = 0;
    const maxAttempts = 3;
    
    logger.info(`Starting LLM analysis with retry mechanism for ${messages.length} messages`);
    
    while (attempts < maxAttempts) {
      try {
        const result = await this.callLLM(systemPrompt, userPrompt);
        return ensureFullShape(result);
      } catch (err) {
        attempts++;
        logger.warn(`LLM analyzeAll attempt ${attempts} failed`, { 
          error: err.message,
          attempt: attempts,
          maxAttempts 
        });
        
        if (attempts >= maxAttempts) {
          logger.warn('All LLM attempts failed; using heuristic fallbacks');
          break;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }
    
    // Fallback to heuristics if all LLM attempts fail
    logger.warn('LLM analyzeAll failed; using heuristic fallbacks');
    return {
      summary: fallbackSummary(messages, streamMetadata),
      sentiment: fallbackSentiment(messages),
      questions: fallbackQuestions(messages),
      moderation: fallbackModerator(messages),
      trending: fallbackTrending(messages)
    };
  }

  // Heuristics-only analysis (no LLM call)
  async generateHeuristics(messages, streamMetadata) {
    return {
      summary: fallbackSummary(messages, streamMetadata),
      sentiment: fallbackSentiment(messages),
      questions: fallbackQuestions(messages),
      moderation: fallbackModerator(messages),
      trending: fallbackTrending(messages)
    };
  }
}

function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/https?:\S+/g, '')
    .replace(/[^a-z0-9\s?]/g, ' ');
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => {
      if (token.length < 3) return false;
      if (STOP_WORDS.has(token)) return false;
      const hasAlpha = /[a-z]/.test(token);
      if (!hasAlpha) return false; // drop purely numeric tokens like "400"
      return true;
    });
}

function getTopWords(messages, limit = 5) {
  const counts = {};
  messages.forEach(({ text }) => {
    tokenize(text).forEach(word => {
      counts[word] = (counts[word] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, mentions]) => ({ word, mentions }));
}

function toTitleCase(str) {
  return String(str)
    .split(' ')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function fallbackSummary(messages, metadata) {
  const messageCount = messages.length;
  const topWords = getTopWords(messages, 8).map(({ word }) => word).slice(0, 4);
  const themes = topWords.map(w => toTitleCase(w));
  const engagementLevel = messageCount > 120 ? 'high' : messageCount > 50 ? 'medium' : 'low';
  const recent = messages
    .slice(-6)
    .map(m => String(m.text || '').trim())
    .filter(t => t && t.length >= 5)
    .slice(0, 3);
  const notable = messages.slice(-3).map(msg => `[${msg.author}] ${msg.text}`);

  const tone = fallbackSentiment(messages).overall_sentiment;

  const sentences = [];
  // 1
  sentences.push(`This batch shows ${engagementLevel} activity with ${messageCount} messages.`);
  // 2
  if (themes.length) {
    sentences.push(`Conversation broadly centers on ${themes.join(', ')}.`);
  } else {
    sentences.push('Conversation revolves around general chat, greetings, and quick reactions.');
  }
  // 2.5 Include common questions if any
  const frequent = fallbackQuestions(messages).frequent_questions || [];
  if (frequent.length) {
    const qTexts = frequent.slice(0, 2).map(q => `"${q.question.slice(0, 120)}"`);
    sentences.push(`Common questions include: ${qTexts.join(' and ')}.`);
  }
  // 3
  sentences.push(`Overall tone is ${tone}.`);
  // 4 (optional)
  if (recent.length) {
    sentences.push(`Recent highlights: ${recent.map(t => '"' + t.slice(0, 80) + '"').join(' · ')}.`);
  }

  const text = sentences.join(' ');
  return {
    summary: text,
    key_themes: themes,
    engagement_level: engagementLevel,
    notable_moments: notable,
    viewer_sentiment: tone,
    word_count: Math.min(200, text.split(/\s+/).length)
  };
}

function fallbackSentiment(messages) {
  let positive = 0;
  let negative = 0;
  const negativeWordsFound = [];

  messages.forEach(({ text }) => {
    const words = tokenize(text);
    if (words.some(w => POSITIVE_WORDS.includes(w))) positive++;
    const negWords = words.filter(w => NEGATIVE_WORDS.includes(w));
    if (negWords.length > 0) {
      negative++;
      negWords.forEach(word => {
        if (!negativeWordsFound.includes(word)) {
          negativeWordsFound.push(word);
        }
      });
    }
  });
  const total = Math.max(messages.length, 1);
  const neutral = Math.max(total - positive - negative, 0);
  const normalize = value => Number((value / total).toFixed(2));

  let overall = 'neutral';
  if (positive > negative * 1.5) overall = 'positive';
  else if (negative > positive * 1.5) overall = 'negative';

  return {
    overall_sentiment: overall,
    distribution: {
      positive: normalize(positive),
      neutral: normalize(neutral),
      negative: normalize(negative)
    },
    negative_words: negativeWordsFound,
    summary: `Chat shows ${overall} sentiment based on simple keyword analysis.`
  };
}

function fallbackQuestions(messages) {
  const questionCounts = {};
  messages
    .map(msg => msg.text.trim())
    .filter(text => text.includes('?'))
    .forEach(text => {
      const cleaned = text.replace(/\s+/g, ' ');
      questionCounts[cleaned] = (questionCounts[cleaned] || 0) + 1;
    });

  const frequent = Object.entries(questionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([question, count]) => ({ question, count, theme: 'general' }));

  return { frequent_questions: frequent };
}

function fallbackTrending(messages) {
  const top = getTopWords(messages, 12)
    .filter(({ mentions }) => mentions >= 2)
    .slice(0, 6)
    .map(({ word, mentions }) => ({ topic: toTitleCase(word), mentions, keywords: [word] }));
  return { trending_topics: top };
}

function filterThemes(themes) {
  if (!Array.isArray(themes)) return [];
  const seen = new Set();
  const result = [];
  for (const t of themes) {
    const token = String(t || '').trim().toLowerCase();
    if (!token) continue;
    if (token.length < 3) continue;
    if (STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(toTitleCase(token));
  }
  return result.slice(0, 6);
}

function filterTrending(trending) {
  const items = Array.isArray(trending?.trending_topics) ? trending.trending_topics : [];
  const filtered = [];
  const seen = new Set();
  for (const item of items) {
    const topicRaw = item?.topic ?? '';
    const topic = String(topicRaw).trim().toLowerCase();
    if (!topic) continue;
    if (topic.length < 3) continue;
    if (STOP_WORDS.has(topic)) continue;
    if (!/[a-z]/.test(topic)) continue; // require alphabetic content
    if (seen.has(topic)) continue;
    seen.add(topic);
    filtered.push({
      topic: toTitleCase(topic),
      mentions: typeof item?.mentions === 'number' ? item.mentions : 1,
      keywords: Array.isArray(item?.keywords) ? item.keywords : [topic]
    });
  }
  return { trending_topics: filtered.slice(0, 8) };
}

function ensureFullShape(result) {
  const out = {
    summary: {
      summary: '',
      key_themes: [],
      engagement_level: 'low',
      notable_moments: [],
      viewer_sentiment: 'neutral',
      word_count: 0
    },
    sentiment: {
      overall_sentiment: 'neutral',
      distribution: { positive: 0.33, neutral: 0.34, negative: 0.33 },
      negative_words: [],
      summary: ''
    },
    questions: { frequent_questions: [] },
    moderation: {
      poll_suggestions: [],
      moderation_alerts: [],
      engagement_suggestions: []
    },
    trending: { trending_topics: [] }
  };

  try {
    if (result?.summary) out.summary = result.summary;
    if (result?.sentiment) out.sentiment = result.sentiment;
    if (result?.questions) out.questions = result.questions;
    if (result?.moderation) out.moderation = result.moderation;
    if (result?.trending) out.trending = result.trending;
  } catch (_) {}

  // Filter stop words and normalize
  out.summary.key_themes = filterThemes(out.summary.key_themes);
  out.trending = filterTrending(out.trending);
  return out;
}

function fallbackModerator(messages) {
  const alerts = [];
  messages.forEach(({ text, author }) => {
    const lower = text.toLowerCase();
    if (lower.includes('http') || lower.includes('subscribe')) {
      alerts.push(`Possible spam from ${author}: "${text.slice(0, 80)}"`);
    }
  });

  return {
    poll_suggestions: [
      { question: 'How is everyone feeling?', options: ['Great', 'Okay', 'Need a break'] }
    ],
    moderation_alerts: alerts.slice(0, 3),
    engagement_suggestions: ['Ask viewers what they are working on while listening.']
  };
}

module.exports = new LLMService();