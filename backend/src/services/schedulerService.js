const cron = require('node-cron');
const youtubeService = require('./youtubeService');
const llmService = require('./llmService');
const { Stream, Analysis, User } = require('../models');
const logger = require('../utils/logger');
const { getIO } = require('../utils/socket'); // Get Socket.IO instance

class SchedulerService {
  constructor() {
    this.activeJobs = new Map(); // streamId -> cron job
  }

  async startAnalysis(streamId, userId) {
    if (this.activeJobs.has(streamId)) {
      logger.warn(`Analysis for stream ${streamId} is already running.`);
      return;
    }

    let stream = await Stream.findOne({ where: { id: streamId, UserId: userId } });
    if (!stream || !stream.isActive) {
      logger.error(`Stream ${streamId} not found or not active.`);
      return;
    }

    // Safety: ensure liveChatId is present by refetching details if needed
    if (!stream.liveChatId) {
      try {
        const details = await youtubeService.getVideoDetails(stream.youtubeVideoId);
        await stream.update({ liveChatId: details.liveChatId, isLive: details.isLive });
      } catch (e) {
        logger.error('Unable to backfill liveChatId', { error: e.message, videoId: stream.youtubeVideoId });
      }
      // Reload
      stream = await Stream.findOne({ where: { id: streamId, UserId: userId } });
    }

    logger.info(`Starting analysis for stream ${streamId}`);
    
    // Run immediately on start
    this.runAnalysisCycle(stream);

    // Set different schedules based on whether it's live or not
    const cronSchedule = stream.isLive ? '*/1 * * * *' : '*/5 * * * *'; // Live: every 1 min, Non-live: every 5 min
    const job = cron.schedule(cronSchedule, () => {
      this.runAnalysisCycle(stream);
    }, {
      scheduled: false // We will start it manually
    });

    job.start();
    this.activeJobs.set(streamId, job);
    
    // Notify client that analysis has started
    getIO().to(streamId).emit('streamStatus', { status: 'running', message: 'Analysis started.' });
  }

  async stopAnalysis(streamId, userId) {
    const job = this.activeJobs.get(streamId);
    if (job) {
      job.stop();
      this.activeJobs.delete(streamId);
      logger.info(`Stopped analysis for stream ${streamId}`);

      // Update stream status in DB
      await Stream.update({ isActive: false }, { where: { id: streamId, UserId: userId } });

      // Notify client
      getIO().to(streamId).emit('streamStatus', { status: 'stopped', message: 'Analysis stopped.' });
    }
  }

  async runAnalysisCycle(stream) {
    logger.info(`Running analysis cycle for stream ${stream.youtubeVideoId}`);
    try {
      let messages, nextPageToken;
      
      if (stream.isLive) {
        // For live streams, fetch live chat messages
        const result = await youtubeService.fetchLiveComments(stream.liveChatId, stream.lastFetchedCommentId);
        messages = result.messages;
        nextPageToken = result.nextPageToken;
      } else {
        // For non-live videos, fetch regular comments
        const result = await youtubeService.fetchVideoComments(stream.youtubeVideoId, stream.lastFetchedCommentId);
        messages = result.messages;
        nextPageToken = result.nextPageToken;
      }
      
      logger.info(`Fetched ${messages.length} messages for stream ${stream.youtubeVideoId}`);
      
      if (messages.length === 0) {
        logger.info(`No new messages for stream ${stream.youtubeVideoId}`);
        return;
      }

      // Update the last fetched token
      await stream.update({ lastFetchedCommentId: nextPageToken });

      const streamMetadata = {
        streamId: stream.id,
        title: stream.title,
        channelTitle: stream.channelTitle,
        batchStartTime: new Date().toISOString(),
        batchEndTime: new Date().toISOString(),
      };

      // Run analysis
      // Rate-limit LLM calls: only every 1 minute per stream
      const now = Date.now();
      this._lastLLM = this._lastLLM || new Map();
      const last = this._lastLLM.get(stream.id) || 0;
      const oneMinute = 1 * 60 * 1000;
      let results = {};
      
      if (now - last >= oneMinute) {
        logger.info(`Making LLM call for stream ${stream.id} (${messages.length} messages)`);
        this._lastLLM.set(stream.id, now);
        try {
          const all = await llmService.analyzeAll(messages, streamMetadata);
          logger.info(`LLM analysis completed successfully for stream ${stream.id}`);
          results = {
            summary: all.summary || null,
            sentiment: all.sentiment || null,
            questions: all.questions || null,
            moderation: all.moderation || null,
            trending: all.trending || null,
          };
        } catch (e) {
          logger.warn('analyzeAll failed, using heuristic fallback', { error: e.message });
          // Generate heuristic fallback to ensure we always have results
          const heuristics = await llmService.generateHeuristics(messages, streamMetadata);
          results = {
            summary: heuristics.summary || null,
            sentiment: heuristics.sentiment || null,
            questions: heuristics.questions || null,
            moderation: heuristics.moderation || null,
            trending: heuristics.trending || null,
          };
        }
      } else {
        // Skip LLM this cycle; emit heartbeat without overwriting fields
        const secondsSinceLast = Math.round((now - last) / 1000);
        logger.info(`Skipping LLM call for stream ${stream.id} (only ${secondsSinceLast}s since last call)`);
        results = {};
      }

      // Always emit something - either new results or heartbeat
      getIO().to(stream.id).emit('newAnalysis', {
        ...results,
        timestamp: streamMetadata.batchStartTime,
        messageCount: messages.length,
      });

    } catch (error) {
      logger.error(`Analysis cycle failed for stream ${stream.youtubeVideoId}`, { error: error.message });
      getIO().to(stream.id).emit('streamStatus', { status: 'error', message: 'An error occurred during analysis.' });
    }
  }
}

module.exports = new SchedulerService();