const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const Stream = sequelize.define('Stream', {
  youtubeVideoId: { type: DataTypes.STRING, allowNull: false, unique: true },
  title: { type: DataTypes.STRING },
  channelTitle: { type: DataTypes.STRING },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  liveChatId: { type: DataTypes.STRING, defaultValue: null },
  isLive: { type: DataTypes.BOOLEAN, defaultValue: false },
  lastFetchedCommentId: { type: DataTypes.STRING, defaultValue: null },
});

User.hasMany(Stream);
Stream.belongsTo(User);

module.exports = Stream;