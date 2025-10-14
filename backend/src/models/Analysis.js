const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const Stream = require('./Stream');

const Analysis = sequelize.define('Analysis', {
  type: { 
    type: DataTypes.ENUM('summary', 'sentiment', 'questions', 'moderation', 'trending'), 
    allowNull: false 
  },
  data: { type: DataTypes.JSONB, allowNull: false },
});

Stream.hasMany(Analysis);
Analysis.belongsTo(Stream);

module.exports = Analysis;