const express = require('express');
const { protect } = require('../middleware/auth');
const {
  createPlaylist,
  getPlaylists,
  getPlaylist,
  updatePlaylist,
  deletePlaylist,
  duplicatePlaylist,
  addItem,
  bulkAddItems,
  updateItem,
  deleteItem,
  reorderItems,
  startItem,
  completeItem,
  skipItem,
  getPlaylistAnalytics,
  getNextRecommendedItem,
  getStudySessionSummary,
  archiveCompletedPlaylists,
} = require('../controllers/studyPlaylistController');

const router = express.Router();

// ── Analytics & Insights (must be before /:id routes) ───────────────────
router.get('/analytics', protect, getPlaylistAnalytics);
router.get('/recommendations/next', protect, getNextRecommendedItem);
router.get('/session', protect, getStudySessionSummary);
router.post('/archive-completed', protect, archiveCompletedPlaylists);

// ── Playlist CRUD ────────────────────────────────────────────────────────
router.post('/', protect, createPlaylist);
router.get('/', protect, getPlaylists);
router.get('/:id', protect, getPlaylist);
router.put('/:id', protect, updatePlaylist);
router.delete('/:id', protect, deletePlaylist);
router.post('/:id/duplicate', protect, duplicatePlaylist);

// ── Item Management ──────────────────────────────────────────────────────
router.post('/:id/items', protect, addItem);
router.post('/:id/items/bulk', protect, bulkAddItems);
router.put('/:id/reorder', protect, reorderItems);

// ── Item CRUD (item-level routes) ────────────────────────────────────────
router.put('/items/:itemId', protect, updateItem);
router.delete('/items/:itemId', protect, deleteItem);
router.post('/items/:itemId/start', protect, startItem);
router.post('/items/:itemId/complete', protect, completeItem);
router.post('/items/:itemId/skip', protect, skipItem);

module.exports = router;
