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
    const cronSchedule = stream.isLive ? '*/2 * * * *' : '*/5 * * * *'; // Live: every 2 min, Non-live: every 5 min
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
      };

      // Run all analysis tasks in parallel
      const [
        summary,
        sentiment,
        questions,
        suggestions,
        topics
      ] = await Promise.allSettled([
        llmService.summarizeChat(messages, streamMetadata),
        llmService.analyzeSentiment(messages),
        llmService.findFrequentQuestions(messages),
        llmService.generateModeratorSuggestions(messages, streamMetadata),
        llmService.findTrendingTopics(messages)
      ]);

      // Normalize result keys to match DB enum and frontend expectations
      const results = {
        summary: summary.status === 'fulfilled' ? summary.value : null,
        sentiment: sentiment.status === 'fulfilled' ? sentiment.value : null,
        questions: questions.status === 'fulfilled' ? questions.value : null,
        moderation: suggestions.status === 'fulfilled' ? suggestions.value : null,
        trending: topics.status === 'fulfilled' ? topics.value : null,
      };

      // Save results to database (only allowed enum types)
      const allowedTypes = ['summary', 'sentiment', 'questions', 'moderation', 'trending'];
      for (const type of allowedTypes) {
        if (results[type]) {
          await Analysis.create({
            StreamId: stream.id,
            type,
            data: results[type],
          });
        }
      }
      
      // Emit real-time results to the frontend
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