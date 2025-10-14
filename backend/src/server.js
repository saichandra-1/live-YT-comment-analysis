require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const sequelize = require('./config/database');
const authRoutes = require('./routes/auth');
const streamRoutes = require('./routes/streams');
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const { setIO } = require('./utils/socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"]
  }
});

// Set the Socket.IO instance for other services to use
setIO(io);

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/streams', streamRoutes);

// Debug: Log all routes
console.log('Registered routes:');
console.log('- POST /api/streams/start');
console.log('- POST /api/streams/:streamId/stop');
console.log('- GET /api/streams/history');

// Basic health check
app.get('/api/health', (req, res) => res.status(200).send('OK'));

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('joinStream', (streamId) => {
    socket.join(streamId);
    logger.info(`Client ${socket.id} joined stream room ${streamId}`);
  });

  socket.on('leaveStream', (streamId) => {
    socket.leave(streamId);
    logger.info(`Client ${socket.id} left stream room ${streamId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connection has been established successfully.');
    await sequelize.sync({ alter: true }); // Sync models
    logger.info('Database synchronized.');

    server.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Unable to connect to the database or start server:', error);
  }
};

startServer();