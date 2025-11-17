# YouTube Comment Analysis System - Code Examples

This document provides key code snippets and implementation examples from the project.

---

## 1. BACKEND IMPLEMENTATION

### 1.1 Server Setup (server.js)

```javascript
// Import required modules
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const sequelize = require('./config/database');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"]
  }
});

// Set Socket.IO instance for services
setIO(io);

// Middleware setup
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

// Route registration
app.use('/api/auth', authRoutes);
app.use('/api/streams', streamRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('joinStream', (streamId) => {
    socket.join(streamId);
    logger.info(`Client ${socket.id} joined stream room ${streamId}`);
  });

  socket.on('leaveStream', (streamId) => {
    socket.leave(streamId);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Start server
const startServer = async () => {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
};

startServer();
```

---

### 1.2 Database Models

#### User Model (models/User.js)
```javascript
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  googleId: { 
    type: DataTypes.STRING, 
    unique: true, 
    allowNull: false 
  },
  email: { 
    type: DataTypes.STRING, 
    unique: true, 
    allowNull: false 
  },
  name: { 
    type: DataTypes.STRING, 
    allowNull: false 
  },
  picture: { 
    type: DataTypes.STRING 
  },
});

module.exports = User;
```

#### Stream Model (models/Stream.js)
```javascript
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Stream = sequelize.define('Stream', {
  youtubeVideoId: { 
    type: DataTypes.STRING, 
    allowNull: false, 
    unique: true 
  },
  title: { type: DataTypes.STRING },
  channelTitle: { type: DataTypes.STRING },
  isActive: { 
    type: DataTypes.BOOLEAN, 
    defaultValue: true 
  },
  liveChatId: { 
    type: DataTypes.STRING, 
    defaultValue: null 
  },
  isLive: { 
    type: DataTypes.BOOLEAN, 
    defaultValue: false 
  },
  lastFetchedCommentId: { 
    type: DataTypes.STRING, 
    defaultValue: null 
  },
});

// Associations
User.hasMany(Stream);
Stream.belongsTo(User);

module.exports = Stream;
```

#### Analysis Model (models/Analysis.js)
```javascript
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Analysis = sequelize.define('Analysis', {
  type: { 
    type: DataTypes.ENUM(
      'summary', 
      'sentiment', 
      'questions', 
      'moderation', 
      'trending'
    ), 
    allowNull: false 
  },
  data: { 
    type: DataTypes.JSONB, 
    allowNull: false 
  },
});

// Associations
Stream.hasMany(Analysis);
Analysis.belongsTo(Stream);

module.exports = Analysis;
```

---

### 1.3 YouTube Service (services/youtubeService.js)

```javascript
const axios = require('axios');
const logger = require('../utils/logger');

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

class YouTubeService {
  // Fetch video metadata and check if live
  async getVideoDetails(videoId) {
    try {
      const response = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
        params: {
          part: 'snippet,liveStreamingDetails',
          id: videoId,
          key: process.env.YOUTUBE_API_KEY,
        },
      });
      
      const item = response.data.items[0];
      if (!item) throw new Error('Video not found');
      
      const isLive = item.snippet.liveBroadcastContent === 'live';
      
      if (isLive) {
        return {
          videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          liveChatId: item.liveStreamingDetails.activeLiveChatId,
          isLive: true,
        };
      } else {
        return {
          videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          liveChatId: null,
          isLive: false,
        };
      }
    } catch (error) {
      logger.error('Failed to get video details', { error: error.message });
      throw error;
    }
  }

  // Fetch live chat messages
  async fetchLiveComments(liveChatId, pageToken = null) {
    try {
      const params = {
        part: 'snippet,authorDetails',
        liveChatId: liveChatId,
        key: process.env.YOUTUBE_API_KEY,
        maxResults: 200,
      };
      
      if (pageToken) {
        params.pageToken = pageToken;
      }

      const response = await axios.get(
        `${YOUTUBE_API_BASE}/liveChat/messages`, 
        { params }
      );
      
      const messages = response.data.items.map(item => ({
        id: item.id,
        text: item.snippet.displayMessage,
        author: item.authorDetails.displayName,
        timestamp: item.snippet.publishedAt,
      }));

      return {
        messages,
        nextPageToken: response.data.nextPageToken,
        pollingIntervalMillis: response.data.pollingIntervalMillis,
      };
    } catch (error) {
      logger.error('Failed to fetch live comments', { error: error.message });
      return { messages: [], nextPageToken: null, pollingIntervalMillis: 10000 };
    }
  }

  // Fetch regular video comments
  async fetchVideoComments(videoId, pageToken = null) {
    try {
      const params = {
        part: 'snippet',
        videoId: videoId,
        key: process.env.YOUTUBE_API_KEY,
        maxResults: 100,
        order: 'time',
      };
      
      if (pageToken) {
        params.pageToken = pageToken;
      }

      const response = await axios.get(
        `${YOUTUBE_API_BASE}/commentThreads`, 
        { params }
      );
      
      const messages = response.data.items.map(item => ({
        id: item.id,
        text: item.snippet.topLevelComment.snippet.textDisplay,
        author: item.snippet.topLevelComment.snippet.authorDisplayName,
        timestamp: item.snippet.topLevelComment.snippet.publishedAt,
      }));

      return {
        messages,
        nextPageToken: response.data.nextPageToken,
        pollingIntervalMillis: 30000,
      };
    } catch (error) {
      logger.error('Failed to fetch video comments', { error: error.message });
      return { messages: [], nextPageToken: null, pollingIntervalMillis: 30000 };
    }
  }
}

module.exports = new YouTubeService();
```

---

### 1.4 LLM Service - Complete Analysis (services/llmService.js)

```javascript
const { getClient, MODEL, MAX_TOKENS, TEMPERATURE } = require('../config/openRouter');
const logger = require('../utils/logger');

class LLMService {
  // Main LLM API call function
  async callLLM(systemPrompt, userPrompt) {
    try {
      logger.info('Making LLM API call', { model: this.model });
      
      const client = getClient();
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        response_format: { type: 'json_object' }
      });

      const content = response?.choices?.[0]?.message?.content;
      
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      return this.safeParse(content);
    } catch (error) {
      logger.error('LLM Call Failed', { error: error.message });
      throw error;
    }
  }

  // Safe JSON parsing with fallback
  safeParse(rawContent) {
    try {
      return JSON.parse(rawContent);
    } catch (err) {
      // Try to extract JSON from text
      const start = rawContent.indexOf('{');
      const end = rawContent.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end >= start) {
        const snippet = rawContent.slice(start, end + 1);
        try {
          return JSON.parse(snippet);
        } catch (innerErr) {
          logger.warn('Failed to parse LLM response');
        }
      }
      return null;
    }
  }

  // Single-call comprehensive analysis
  async analyzeAll(messages, streamMetadata) {
    const systemPrompt = `You are a YouTube Live Chat Analyst. Produce a complete analysis.
    
REQUIREMENTS:
1. Respond with VALID JSON ONLY.
2. Avoid stop-words as themes.
3. Keep summary 4-5 sentences, SPECIFIC.
4. Include negative words if found.

JSON SCHEMA:
{
  "summary": {
    "summary": "5-7 sentences describing conversations",
    "key_themes": ["theme1", "theme2"],
    "engagement_level": "high|medium|low",
    "notable_moments": ["moment1"],
    "viewer_sentiment": "positive|neutral|negative",
    "word_count": 120
  },
  "sentiment": {
    "overall_sentiment": "positive|neutral|negative",
    "distribution": { "positive": 0.4, "neutral": 0.4, "negative": 0.2 },
    "negative_words": ["word1"],
    "summary": "1-2 sentence description"
  },
  "questions": {
    "frequent_questions": [{ "question": "string", "count": 3, "theme": "string" }]
  },
  "moderation": {
    "poll_suggestions": [{ "question": "string", "options": ["A","B"] }],
    "moderation_alerts": ["string"],
    "engagement_suggestions": ["string"]
  },
  "trending": {
    "trending_topics": [{ "topic": "string", "mentions": 5, "keywords": ["a","b"] }]
  }
}`;

    const userPrompt = `Analyze this YouTube live chat batch:
STREAM: "${streamMetadata.title}"
CHANNEL: ${streamMetadata.channelTitle}
MESSAGES (${messages.length}):
${messages.map(m => `[${m.timestamp}] ${m.author}: ${m.text}`).join('\n')}

Provide SPECIFIC summary describing actual conversations.`;

    // Retry mechanism
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        const result = await this.callLLM(systemPrompt, userPrompt);
        return this.ensureFullShape(result);
      } catch (err) {
        attempts++;
        logger.warn(`LLM attempt ${attempts} failed`, { error: err.message });
        
        if (attempts >= maxAttempts) {
          logger.warn('All LLM attempts failed; using heuristics');
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }
    
    // Fallback to heuristics
    return {
      summary: this.fallbackSummary(messages, streamMetadata),
      sentiment: this.fallbackSentiment(messages),
      questions: this.fallbackQuestions(messages),
      moderation: this.fallbackModerator(messages),
      trending: this.fallbackTrending(messages)
    };
  }

  // Heuristic fallback: Sentiment analysis
  fallbackSentiment(messages) {
    const POSITIVE_WORDS = ['love', 'great', 'awesome', 'amazing'];
    const NEGATIVE_WORDS = ['bad', 'hate', 'sad', 'angry'];
    
    let positive = 0;
    let negative = 0;
    const negativeWordsFound = [];

    messages.forEach(({ text }) => {
      const words = text.toLowerCase().split(/\s+/);
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
    const neutral = total - positive - negative;

    let overall = 'neutral';
    if (positive > negative * 1.5) overall = 'positive';
    else if (negative > positive * 1.5) overall = 'negative';

    return {
      overall_sentiment: overall,
      distribution: {
        positive: Number((positive / total).toFixed(2)),
        neutral: Number((neutral / total).toFixed(2)),
        negative: Number((negative / total).toFixed(2))
      },
      negative_words: negativeWordsFound,
      summary: `Chat shows ${overall} sentiment.`
    };
  }
}

module.exports = new LLMService();
```

---

### 1.5 Scheduler Service (services/schedulerService.js)

```javascript
const cron = require('node-cron');
const youtubeService = require('./youtubeService');
const llmService = require('./llmService');
const { Stream, Analysis } = require('../models');
const logger = require('../utils/logger');
const { getIO } = require('../utils/socket');

class SchedulerService {
  constructor() {
    this.activeJobs = new Map(); // streamId -> cron job
  }

  async startAnalysis(streamId, userId) {
    if (this.activeJobs.has(streamId)) {
      logger.warn(`Analysis for stream ${streamId} already running.`);
      return;
    }

    let stream = await Stream.findOne({ 
      where: { id: streamId, UserId: userId } 
    });
    
    if (!stream || !stream.isActive) {
      logger.error(`Stream ${streamId} not found or not active.`);
      return;
    }

    logger.info(`Starting analysis for stream ${streamId}`);
    
    // Run immediately
    this.runAnalysisCycle(stream);

    // Set schedule based on stream type
    const cronSchedule = stream.isLive ? '*/1 * * * *' : '*/5 * * * *';
    
    const job = cron.schedule(cronSchedule, () => {
      this.runAnalysisCycle(stream);
    }, {
      scheduled: false
    });

    job.start();
    this.activeJobs.set(streamId, job);
    
    // Notify client
    getIO().to(streamId).emit('streamStatus', { 
      status: 'running', 
      message: 'Analysis started.' 
    });
  }

  async stopAnalysis(streamId, userId) {
    const job = this.activeJobs.get(streamId);
    if (job) {
      job.stop();
      this.activeJobs.delete(streamId);
      logger.info(`Stopped analysis for stream ${streamId}`);

      await Stream.update(
        { isActive: false }, 
        { where: { id: streamId, UserId: userId } }
      );

      getIO().to(streamId).emit('streamStatus', { 
        status: 'stopped', 
        message: 'Analysis stopped.' 
      });
    }
  }

  async runAnalysisCycle(stream) {
    logger.info(`Running analysis cycle for stream ${stream.youtubeVideoId}`);
    
    try {
      let messages, nextPageToken;
      
      // Fetch comments based on stream type
      if (stream.isLive) {
        const result = await youtubeService.fetchLiveComments(
          stream.liveChatId, 
          stream.lastFetchedCommentId
        );
        messages = result.messages;
        nextPageToken = result.nextPageToken;
      } else {
        const result = await youtubeService.fetchVideoComments(
          stream.youtubeVideoId, 
          stream.lastFetchedCommentId
        );
        messages = result.messages;
        nextPageToken = result.nextPageToken;
      }
      
      logger.info(`Fetched ${messages.length} messages`);
      
      if (messages.length === 0) {
        return;
      }

      await stream.update({ lastFetchedCommentId: nextPageToken });

      const streamMetadata = {
        streamId: stream.id,
        title: stream.title,
        channelTitle: stream.channelTitle,
        batchStartTime: new Date().toISOString(),
        batchEndTime: new Date().toISOString(),
      };

      // Rate limiting for LLM
      const now = Date.now();
      this._lastLLM = this._lastLLM || new Map();
      const last = this._lastLLM.get(stream.id) || 0;
      const oneMinute = 60 * 1000;
      
      let results = {};
      
      if (now - last >= oneMinute) {
        logger.info(`Making LLM call for stream ${stream.id}`);
        this._lastLLM.set(stream.id, now);
        
        try {
          const all = await llmService.analyzeAll(messages, streamMetadata);
          results = {
            summary: all.summary,
            sentiment: all.sentiment,
            questions: all.questions,
            moderation: all.moderation,
            trending: all.trending,
          };
        } catch (e) {
          logger.warn('LLM failed, using heuristics', { error: e.message });
          const heuristics = await llmService.generateHeuristics(
            messages, 
            streamMetadata
          );
          results = heuristics;
        }
      }

      // Emit real-time update
      getIO().to(stream.id).emit('newAnalysis', {
        ...results,
        timestamp: streamMetadata.batchStartTime,
        messageCount: messages.length,
      });

    } catch (error) {
      logger.error(`Analysis cycle failed`, { error: error.message });
      getIO().to(stream.id).emit('streamStatus', { 
        status: 'error', 
        message: 'An error occurred.' 
      });
    }
  }
}

module.exports = new SchedulerService();
```

---

## 2. FRONTEND IMPLEMENTATION

### 2.1 Authentication Context (context/AuthContext.js)

```javascript
import React, { createContext, useState, useContext, useEffect } from 'react';
import { getToken, removeToken } from '../services/authService';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (token) {
      setUser({ token });
    }
    setLoading(false);
  }, []);

  const login = (token) => {
    setUser({ token });
    localStorage.setItem('token', token);
  };

  const logout = () => {
    setUser(null);
    removeToken();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
```

---

### 2.2 Stream Context (context/StreamContext.js)

```javascript
import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import api from '../services/api';

const StreamContext = createContext();
export const useStream = () => useContext(StreamContext);

const SOCKET_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export const StreamProvider = ({ children }) => {
  const [currentStream, setCurrentStream] = useState(null);
  const [analysisData, setAnalysisData] = useState({});
  const lastNonNullRef = useRef({});
  const [status, setStatus] = useState('idle');
  const socketRef = useRef();

  useEffect(() => {
    if (currentStream) {
      // Connect to Socket.IO
      socketRef.current = io(SOCKET_URL);
      socketRef.current.emit('joinStream', currentStream.id);

      // Listen for new analysis
      socketRef.current.on('newAnalysis', (data) => {
        // Merge with last non-null values
        const merged = { ...lastNonNullRef.current };
        if (data.summary) merged.summary = data.summary;
        if (data.sentiment) merged.sentiment = data.sentiment;
        if (data.questions) merged.questions = data.questions;
        if (data.moderation) merged.moderation = data.moderation;
        if (data.trending) merged.trending = data.trending;
        if (data.timestamp) merged.timestamp = data.timestamp;
        if (typeof data.messageCount === 'number') {
          merged.messageCount = data.messageCount;
        }

        lastNonNullRef.current = merged;
        setAnalysisData(merged);
      });

      socketRef.current.on('streamStatus', (data) => {
        setStatus(data.status);
      });

      return () => {
        socketRef.current?.emit('leaveStream', currentStream.id);
        socketRef.current?.disconnect();
        lastNonNullRef.current = {};
      };
    }
  }, [currentStream]);

  const startAnalysis = async (youtubeUrl) => {
    try {
      const response = await api.post('/streams/start', { youtubeUrl });
      setCurrentStream(response.data.stream);
      setStatus('running');
      setAnalysisData({});
      return response.data;
    } catch (error) {
      console.error('Failed to start analysis:', error);
      setStatus('error');
      throw error.response?.data || error;
    }
  };

  const stopAnalysis = async () => {
    if (currentStream) {
      try {
        await api.post(`/streams/${currentStream.id}/stop`);
        setStatus('stopped');
      } catch (error) {
        console.error("Failed to stop stream:", error);
      }
    }
  };

  return (
    <StreamContext.Provider value={{ 
      currentStream, 
      analysisData, 
      status, 
      startAnalysis, 
      stopAnalysis 
    }}>
      {children}
    </StreamContext.Provider>
  );
};
```

---

### 2.3 Analysis Dashboard Component (components/AnalysisDashboard.js)

```javascript
import React from 'react';
import { useStream } from '../context/StreamContext';

const AnalysisDashboard = () => {
  const { analysisData, status } = useStream();

  const renderSentiment = (sentiment) => {
    if (!sentiment) return null;
    const { distribution } = sentiment;
    const negativeWords = sentiment.negative_words || [];
    
    return (
      <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '16px' }}>
        <h3>Sentiment Analysis</h3>
        <p><strong>Overall:</strong> {sentiment.overall_sentiment}</p>
        
        {/* Positive Bar */}
        <div style={{ marginBottom: '8px' }}>
          <span>Positive: {Math.round(distribution.positive * 100)}%</span>
          <div style={{ width: '100%', height: '8px', backgroundColor: '#e0e0e0' }}>
            <div style={{
              width: `${distribution.positive * 100}%`,
              height: '100%',
              backgroundColor: '#4caf50'
            }}></div>
          </div>
        </div>
        
        {/* Neutral Bar */}
        <div style={{ marginBottom: '8px' }}>
          <span>Neutral: {Math.round(distribution.neutral * 100)}%</span>
          <div style={{ width: '100%', height: '8px', backgroundColor: '#e0e0e0' }}>
            <div style={{
              width: `${distribution.neutral * 100}%`,
              height: '100%',
              backgroundColor: '#2196f3'
            }}></div>
          </div>
        </div>
        
        {/* Negative Bar */}
        <div style={{ marginBottom: '12px' }}>
          <span>Negative: {Math.round(distribution.negative * 100)}%</span>
          <div style={{ width: '100%', height: '8px', backgroundColor: '#e0e0e0' }}>
            <div style={{
              width: `${distribution.negative * 100}%`,
              height: '100%',
              backgroundColor: '#f44336'
            }}></div>
          </div>
        </div>
        
        {/* Negative Words */}
        {negativeWords.length > 0 && (
          <div style={{ backgroundColor: '#ffebee', padding: '8px', borderRadius: '4px' }}>
            <strong>Negative Words Found:</strong>
            <div>
              {negativeWords.map((word, i) => (
                <span key={i} style={{
                  backgroundColor: '#ffcdd2',
                  color: '#c62828',
                  padding: '2px 6px',
                  margin: '2px',
                  borderRadius: '12px',
                  fontSize: '12px'
                }}>
                  {word}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderQuestions = (questions) => {
    if (!questions || !questions.frequent_questions) return null;
    
    return (
      <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '16px' }}>
        <h3>Frequent Questions</h3>
        <ul>
          {questions.frequent_questions.map((q, i) => (
            <li key={i}>
              <strong>{q.question}</strong> ({q.count} times)
              <br />
              <span style={{ color: '#666' }}>Theme: {q.theme}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderTrending = (trending) => {
    if (!trending || !trending.trending_topics) return null;
    
    return (
      <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '16px' }}>
        <h3>Trending Topics</h3>
        <div>
          {trending.trending_topics.map((topic, i) => (
            <div key={i} style={{
              display: 'inline-block',
              backgroundColor: '#e3f2fd',
              color: '#1565c0',
              padding: '4px 8px',
              margin: '4px',
              borderRadius: '16px'
            }}>
              {topic.topic} ({topic.mentions})
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (status === 'idle') {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
        <h3>No Analysis Running</h3>
        <p>Start analyzing a YouTube live stream to see results here.</p>
      </div>
    );
  }

  return (
    <div>
      <h2>Analysis Results</h2>
      {renderSentiment(analysisData.sentiment)}
      {renderQuestions(analysisData.questions)}
      {renderTrending(analysisData.trending)}
    </div>
  );
};

export default AnalysisDashboard;
```

---

### 2.4 Stream Input Component (components/StreamInput.js)

```javascript
import React, { useState } from 'react';
import { useStream } from '../context/StreamContext';

const StreamInput = () => {
  const [url, setUrl] = useState('');
  const { startAnalysis, stopAnalysis, status, currentStream } = useStream();
  const [error, setError] = useState('');

  const handleStart = async () => {
    setError('');
    try {
      await startAnalysis(url);
    } catch (err) {
      setError(err.message || 'Failed to start analysis.');
    }
  };

  const handleStop = () => {
    stopAnalysis();
  };

  return (
    <div style={{ marginBottom: '32px' }}>
      <input
        type="text"
        placeholder="https://www.youtube.com/watch?v=..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={status === 'running'}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: '16px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          marginBottom: '16px'
        }}
      />
      
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {status === 'running' ? (
          <button onClick={handleStop} style={{
            padding: '12px 24px',
            backgroundColor: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}>
            Stop Analysis
          </button>
        ) : (
          <button onClick={handleStart} disabled={!url} style={{
            padding: '12px 24px',
            backgroundColor: url ? '#1976d2' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: url ? 'pointer' : 'not-allowed'
          }}>
            Start Analysis
          </button>
        )}
      </div>
      
      {error && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          backgroundColor: '#ffebee',
          color: '#c62828',
          borderRadius: '4px'
        }}>
          {error}
        </div>
      )}
      
      {currentStream && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          backgroundColor: '#e3f2fd',
          color: '#1565c0',
          borderRadius: '4px'
        }}>
          Analyzing: {currentStream.title}
        </div>
      )}
    </div>
  );
};

export default StreamInput;
```

---

## 3. CONFIGURATION FILES

### 3.1 Database Configuration (config/database.js)

```javascript
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    dialect: 'postgres',
    logging: false,
  }
);

module.exports = sequelize;
```

---

### 3.2 OpenRouter Configuration (config/openRouter.js)

```javascript
const { OpenAI } = require('openai');

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

const MODEL = process.env.OPENROUTER_MODEL || 'z-ai/glm-4.5-air:free';
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.3;

module.exports = { getClient, MODEL, MAX_TOKENS, TEMPERATURE };
```

---

### 3.3 API Client (frontend/services/api.js)

```javascript
import axios from 'axios';

const API_BASE_URL = 'http://localhost:3001/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// Request interceptor to add JWT token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default apiClient;
```

---

## 4. KEY ALGORITHMS

### 4.1 Video ID Extraction (Regex)

```javascript
const extractVideoId = (url) => {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
};

// Example:
// Input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
// Output: "dQw4w9WgXcQ"
```

---

### 4.2 Word Tokenization (Stop-word Filtering)

```javascript
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','if','then','so','to','of','in','on',
  'nhi','nahi','mujhe','tum','aap','hum','haan','bhai','kya','kyu'
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/https?:\S+/g, '') // Remove URLs
    .replace(/[^a-z0-9\s?]/g, ' ') // Remove special chars
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => {
      if (token.length < 3) return false;
      if (STOP_WORDS.has(token)) return false;
      if (!/[a-z]/.test(token)) return false; // Must have letters
      return true;
    });
}

// Example:
// Input: "I love this video! Check it out https://example.com"
// Output: ["love", "video", "check"]
```

---

### 4.3 Top Words Extraction (Frequency Analysis)

```javascript
function getTopWords(messages, limit = 5) {
  const counts = {};
  
  messages.forEach(({ text }) => {
    tokenize(text).forEach(word => {
      counts[word] = (counts[word] || 0) + 1;
    });
  });
  
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1]) // Sort by count descending
    .slice(0, limit)
    .map(([word, mentions]) => ({ word, mentions }));
}

// Example:
// Input: [{ text: "love this" }, { text: "love love" }]
// Output: [{ word: "love", mentions: 3 }, { word: "this", mentions: 1 }]
```

---

## 5. ENVIRONMENT VARIABLES

### Backend .env Example

```env
# Server Configuration
PORT=3001
FRONTEND_URL=http://localhost:3000

# Database Configuration
DB_NAME=youtube_analysis
DB_USER=postgres
DB_PASS=yourpassword
DB_HOST=localhost

# Authentication
JWT_SECRET=your_super_secret_jwt_key_here
GOOGLE_CLIENT_ID=123456789-abcdefghijk.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret_here

# YouTube API
YOUTUBE_API_KEY=AIzaSyABC123DEF456GHI789JKL012MNO345PQR

# LLM Service (OpenRouter)
OPENROUTER_API_KEY=sk-or-v1-abc123def456ghi789jkl012mno345
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=z-ai/glm-4.5-air:free

# Redis (Optional)
REDIS_URL=redis://localhost:6379
```

### Frontend .env Example

```env
REACT_APP_API_URL=http://localhost:3001
```

---

## 6. SAMPLE OUTPUT

### Console Log Output (Backend)

```
[INFO] 2025-11-01T12:00:00.000Z - Server is running on port 3001
[INFO] 2025-11-01T12:00:00.123Z - Database connection has been established successfully.
[INFO] 2025-11-01T12:00:00.456Z - Database synchronized.
[INFO] 2025-11-01T12:05:30.789Z - Client connected: socket_abc123
[INFO] 2025-11-01T12:05:31.012Z - Client socket_abc123 joined stream room 1
[INFO] 2025-11-01T12:05:35.234Z - Starting analysis for stream 1
[INFO] 2025-11-01T12:05:35.567Z - Running analysis cycle for stream dQw4w9WgXcQ
[INFO] 2025-11-01T12:05:37.890Z - Fetched 145 messages for stream dQw4w9WgXcQ
[INFO] 2025-11-01T12:05:38.123Z - Making LLM call for stream 1 (145 messages)
[INFO] 2025-11-01T12:05:40.456Z - LLM API call completed
[INFO] 2025-11-01T12:05:40.789Z - LLM analysis completed successfully for stream 1
```

---

**End of Code Examples Document**

*This document showcases the core implementation details of the YouTube Comment Analysis System, providing practical code snippets for understanding the system architecture and functionality.*

