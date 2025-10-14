const { Stream, Analysis } = require('../models');
const youtubeService = require('../services/youtubeService');
const schedulerService = require('../services/schedulerService');
const { Op } = require('sequelize');

const extractVideoId = (url) => {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
};

const startStreamAnalysis = async (req, res) => {
  try {
    const { youtubeUrl } = req.body;
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      return res.status(400).json({ message: 'Invalid YouTube URL.' });
    }

    // Check if stream is already being analyzed by this user
    let stream = await Stream.findOne({ where: { youtubeVideoId: videoId, UserId: req.user.id } });
    
    if (stream) {
      if (stream.isActive) {
        // Ensure we have a liveChatId; if missing, refetch video details and backfill
        if (!stream.liveChatId) {
          const details = await youtubeService.getVideoDetails(videoId);
          await stream.update({ liveChatId: details.liveChatId, isLive: details.isLive });
        }
        // Idempotent start: ensure scheduler is running and return existing stream
        schedulerService.startAnalysis(stream.id, req.user.id);
        return res.status(200).json({ message: 'Analysis already active.', stream });
      } else {
        // Reactivate an old stream and backfill missing liveChatId
        const details = await youtubeService.getVideoDetails(videoId);
        await stream.update({ isActive: true, liveChatId: details.liveChatId, isLive: details.isLive });
      }
    } else {
      // Create a new stream record
      const videoDetails = await youtubeService.getVideoDetails(videoId);
      stream = await Stream.create({
        youtubeVideoId: videoId,
        title: videoDetails.title,
        channelTitle: videoDetails.channelTitle,
        liveChatId: videoDetails.liveChatId,
        isLive: videoDetails.isLive,
        UserId: req.user.id,
      });
    }

    // Start the scheduled analysis
    schedulerService.startAnalysis(stream.id, req.user.id);

    res.status(200).json({ message: 'Analysis started successfully.', stream });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const stopStreamAnalysis = async (req, res) => {
  try {
    const { streamId } = req.params;
    await schedulerService.stopAnalysis(streamId, req.user.id);
    res.status(200).json({ message: 'Analysis stopped.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to stop analysis.' });
  }
};

const getStreamHistory = async (req, res) => {
  try {
    const streams = await Stream.findAll({
      where: { UserId: req.user.id },
      order: [['createdAt', 'DESC']],
      include: [{ model: Analysis, order: [['createdAt', 'DESC']] }]
    });
    res.status(200).json(streams);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch history.' });
  }
};

module.exports = { startStreamAnalysis, stopStreamAnalysis, getStreamHistory };