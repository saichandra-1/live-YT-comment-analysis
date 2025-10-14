// Socket.IO instance holder to avoid circular dependencies
let ioInstance = null;

const setIO = (io) => {
  ioInstance = io;
};

const getIO = () => {
  if (!ioInstance) {
    throw new Error('Socket.IO instance not initialized. Call setIO() first.');
  }
  return ioInstance;
};

module.exports = { setIO, getIO };
