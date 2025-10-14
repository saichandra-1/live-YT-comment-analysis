const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ message: 'Something went wrong on the server.' });
};

module.exports = errorHandler;