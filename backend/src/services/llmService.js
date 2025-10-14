const { getClient, MODEL, MAX_TOKENS, TEMPERATURE } = require('../config/openRouter');
const logger = require('../utils/logger');

class LLMService {
  constructor() {
    this.model = MODEL;
    this.maxTokens = MAX_TOKENS;
    this.temperature = TEMPERATURE;
  }

  async callLLM(systemPrompt, userPrompt) {
    try {
      // Temporarily use mock data for testing
      logger.info('Using mock LLM response for testing');
      
      // Return mock data based on the prompt type
      if (userPrompt.includes('sentiment')) {
        return {
          overall_sentiment: "positive",
          distribution: { positive: 0.7, neutral: 0.2, negative: 0.1 },
          summary: "The chat sentiment is largely positive, with viewers expressing enjoyment and appreciation for the music."
        };
      } else if (userPrompt.includes('summary')) {
        return {
          summary: "Viewers are enjoying the lofi hip hop music for studying and relaxation. The chat is active with positive comments about the music quality and atmosphere.",
          key_themes: ["study music", "relaxation", "lofi hip hop", "positive vibes"],
          engagement_level: "high",
          notable_moments: ["Many viewers praising the music", "Study session discussions"],
          viewer_sentiment: "positive",
          word_count: 45
        };
      } else if (userPrompt.includes('questions')) {
        return {
          frequent_questions: [
            { question: "What's the name of this song?", count: 5, theme: "Music" },
            { question: "Is this stream 24/7?", count: 3, theme: "Schedule" }
          ]
        };
      } else if (userPrompt.includes('trending')) {
        return {
          trending_topics: [
            { topic: "Study Music", mentions: 15, keywords: ["study", "music", "focus"] },
            { topic: "Lofi Hip Hop", mentions: 12, keywords: ["lofi", "hip hop", "chill"] }
          ]
        };
      } else if (userPrompt.includes('moderator')) {
        return {
          poll_suggestions: [
            { question: "What's your favorite study time?", options: ["Morning", "Afternoon", "Evening", "Night"] }
          ],
          moderation_alerts: [],
          engagement_suggestions: ["Consider asking viewers about their study goals", "Share some study tips"]
        };
      }
      
      // Default response
      return { message: "Analysis completed successfully" };
      
    } catch (error) {
      logger.error('LLM Call Failed', { error: error.message, prompt: userPrompt.substring(0, 100) });
      throw new Error('AI service is currently unavailable.');
    }
  }

  // 1. CHAT SUMMARIZATION SERVICE
  async summarizeChat(messages, streamMetadata) {
    const systemPrompt = `You are a YouTube Live Chat Summarizer. Your role is to create concise, engaging summaries of live chat conversations.
REQUIREMENTS:
1. Always respond with valid JSON only.
2. Keep summary under 200 words.
3. Focus on key themes, viewer engagement, and notable moments.
4. Highlight any trending topics or popular discussions.
JSON SCHEMA:
{
  "summary": "Brief summary of chat activity",
  "key_themes": ["theme1", "theme2"],
  "engagement_level": "high|medium|low",
  "notable_moments": ["moment1", "moment2"],
  "viewer_sentiment": "positive|neutral|negative",
  "word_count": 150
}`;

    const userPrompt = `Summarize this live chat from YouTube stream "${streamMetadata.title}":
STREAM CONTEXT:
- Channel: ${streamMetadata.channelTitle}
- Time range: ${streamMetadata.batchStartTime} to ${streamMetadata.batchEndTime}
CHAT MESSAGES (${messages.length} messages):
 ${messages.map(msg => `[${msg.timestamp}] ${msg.author}: ${msg.text}`).join('\n')}
Provide a comprehensive summary focusing on viewer engagement and key discussion points.`;

    return this.callLLM(systemPrompt, userPrompt);
  }

  // 2. SENTIMENT ANALYSIS SERVICE
  async analyzeSentiment(messages) {
    const systemPrompt = `You are a sentiment analysis expert for YouTube live chats. Analyze the sentiment of the provided messages.
REQUIREMENTS:
1. Always respond with valid JSON only.
2. Calculate the overall sentiment based on the proportion of positive, neutral, and negative messages.
3. Provide a brief summary of the sentiment.
JSON SCHEMA:
{
  "overall_sentiment": "positive|neutral|negative",
  "distribution": { "positive": 0.6, "neutral": 0.3, "negative": 0.1 },
  "summary": "The chat sentiment is largely positive, with viewers expressing excitement and agreement."
}`;

    const userPrompt = `Analyze the sentiment of these live chat messages:
CHAT MESSAGES (${messages.length} messages):
 ${messages.map(msg => `${msg.text}`).join('\n')}`;

    return this.callLLM(systemPrompt, userPrompt);
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

    return this.callLLM(systemPrompt, userPrompt);
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

    return this.callLLM(systemPrompt, userPrompt);
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

    return this.callLLM(systemPrompt, userPrompt);
  }
}

module.exports = new LLMService();