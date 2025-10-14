const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { startStreamAnalysis, stopStreamAnalysis, getStreamHistory } = require('../controllers/streamController');

router.post('/start', auth, startStreamAnalysis);
router.post('/:streamId/stop', auth, stopStreamAnalysis);
router.get('/history', auth, getStreamHistory);

module.exports = router;