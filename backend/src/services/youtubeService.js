const axios = require('axios');
const logger = require('../utils/logger');

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

class YouTubeService {
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
      
      // Check if it's a live stream
      const isLive = item.snippet.liveBroadcastContent === 'live';
      
      if (isLive) {
        // For live streams, we need the liveChatId
        if (!item.liveStreamingDetails?.activeLiveChatId) {
          throw new Error('Live stream does not have an active chat.');
        }
        return {
          videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          liveChatId: item.liveStreamingDetails.activeLiveChatId,
          isLive: true,
        };
      } else {
        // For non-live videos, we'll simulate analysis with existing comments
        return {
          videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          liveChatId: null, // No live chat for non-live videos
          isLive: false,
        };
      }
    } catch (error) {
      logger.error('Failed to get video details', { error: error.message, videoId });
      throw error;
    }
  }

  async fetchLiveComments(liveChatId, pageToken = null) {
    try {
      const params = {
        part: 'snippet,authorDetails',
        liveChatId: liveChatId,
        key: process.env.YOUTUBE_API_KEY,
        maxResults: 200, // Max allowed
      };
      if (pageToken) {
        params.pageToken = pageToken;
      }

      const response = await axios.get(`${YOUTUBE_API_BASE}/liveChat/messages`, { params });
      
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
      logger.error('Failed to fetch live comments', { error: error.message, liveChatId });
      // Return empty to avoid crashing the scheduler if YouTube API has a hiccup
      return { messages: [], nextPageToken: null, pollingIntervalMillis: 10000 };
    }
  }

  async fetchVideoComments(videoId, pageToken = null) {
    try {
      const params = {
        part: 'snippet',
        videoId: videoId,
        key: process.env.YOUTUBE_API_KEY,
        maxResults: 100, // Max allowed for regular comments
        order: 'time', // Get newest comments first
      };
      if (pageToken) {
        params.pageToken = pageToken;
      }

      const response = await axios.get(`${YOUTUBE_API_BASE}/commentThreads`, { params });
      
      const messages = response.data.items.map(item => ({
        id: item.id,
        text: item.snippet.topLevelComment.snippet.textDisplay,
        author: item.snippet.topLevelComment.snippet.authorDisplayName,
        timestamp: item.snippet.topLevelComment.snippet.publishedAt,
      }));

      return {
        messages,
        nextPageToken: response.data.nextPageToken,
        pollingIntervalMillis: 30000, // Poll every 30 seconds for regular videos
      };
    } catch (error) {
      logger.error('Failed to fetch video comments', { error: error.message, videoId });
      // Return empty to avoid crashing the scheduler if YouTube API has a hiccup
      return { messages: [], nextPageToken: null, pollingIntervalMillis: 30000 };
    }
  }
}

module.exports = new YouTubeService();