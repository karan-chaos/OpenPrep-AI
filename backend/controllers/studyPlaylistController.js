const studyPlaylistService = require('../services/studyPlaylistService');
const ActivityLog = require('../models/ActivityLog');

// ── Playlist CRUD ────────────────────────────────────────────────────────

// @desc    Create a new study playlist
// @route   POST /api/study-playlists
// @access  Private
exports.createPlaylist = async (req, res, next) => {
  try {
    const { title, description, subject, playlistType, visibility, priority, targetCompletionDate, tags, coverImageUrl, metadata, items } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: 'Playlist title is required' });
    }

    const result = await studyPlaylistService.createPlaylist(req.user.id, {
      title,
      description,
      subject,
      playlistType,
      visibility,
      priority,
      targetCompletionDate,
      tags,
      coverImageUrl,
      metadata,
      items,
    });

    await ActivityLog.create({
      user: req.user.id,
      activityType: 'playlist_created',
      description: `Created study playlist: "${result.playlist.title}"`,
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all study playlists for the current user
// @route   GET /api/study-playlists
// @access  Private
exports.getPlaylists = async (req, res, next) => {
  try {
    const { status, playlistType, subjectId, visibility, search, sortBy, page, limit } = req.query;

    const result = await studyPlaylistService.getUserPlaylists(req.user.id, {
      status,
      playlistType,
      subjectId,
      visibility,
      search,
      sortBy,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
    });

    res.status(200).json({
      success: true,
      count: result.playlists.length,
      ...result.pagination,
      data: result.playlists,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single study playlist with items
// @route   GET /api/study-playlists/:id
// @access  Private
exports.getPlaylist = async (req, res, next) => {
  try {
    const result = await studyPlaylistService.getPlaylistById(req.user.id, req.params.id);

    if (!result) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }

    res.status(200).json({
      success: true,
      data: result.playlist,
      items: result.items,
    });
  } catch (error) {
    if (error.name === 'ForbiddenError') {
      return res.status(403).json({ success: false, error: error.message });
    }
    next(error);
  }
};

// @desc    Update a study playlist
// @route   PUT /api/study-playlists/:id
// @access  Private
exports.updatePlaylist = async (req, res, next) => {
  try {
    const playlist = await studyPlaylistService.updatePlaylist(req.user.id, req.params.id, req.body);

    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }

    res.status(200).json({ success: true, data: playlist });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a study playlist and all its items
// @route   DELETE /api/study-playlists/:id
// @access  Private
exports.deletePlaylist = async (req, res, next) => {
  try {
    const deleted = await studyPlaylistService.deletePlaylist(req.user.id, req.params.id);

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

// @desc    Duplicate a study playlist with all its items
// @route   POST /api/study-playlists/:id/duplicate
// @access  Private
exports.duplicatePlaylist = async (req, res, next) => {
  try {
    const { title } = req.body;
    const playlist = await studyPlaylistService.duplicatePlaylist(req.user.id, req.params.id, title);

    res.status(201).json({ success: true, data: playlist });
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.name === 'ForbiddenError') {
      return res.status(403).json({ success: false, error: error.message });
    }
    next(error);
  }
};

// ── Item Management ──────────────────────────────────────────────────────

// @desc    Add an item to a playlist
// @route   POST /api/study-playlists/:id/items
// @access  Private
exports.addItem = async (req, res, next) => {
  try {
    const { ResourceType, resourceId, title, description, sortOrder, estimatedMinutes, notes, metadata } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: 'Item title is required' });
    }

    const item = await studyPlaylistService.addItem(req.user.id, req.params.id, {
      ResourceType,
      resourceId,
      title,
      description,
      sortOrder,
      estimatedMinutes,
      notes,
      metadata,
    });

    res.status(201).json({ success: true, data: item });
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
};

// @desc    Add multiple items to a playlist
// @route   POST /api/study-playlists/:id/items/bulk
// @access  Private
exports.bulkAddItems = async (req, res, next) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items must be a non-empty array' });
    }

    if (items.length > 100) {
      return res.status(400).json({ success: false, error: 'Maximum 100 items per bulk request' });
    }

    const createdItems = await studyPlaylistService.bulkAddItems(req.user.id, req.params.id, items);

    res.status(201).json({
      success: true,
      count: createdItems.length,
      data: createdItems,
    });
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
};

// @desc    Update a playlist item
// @route   PUT /api/study-playlists/items/:itemId
// @access  Private
exports.updateItem = async (req, res, next) => {
  try {
    const item = await studyPlaylistService.updateItem(req.user.id, req.params.itemId, req.body);

    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a playlist item
// @route   DELETE /api/study-playlists/items/:itemId
// @access  Private
exports.deleteItem = async (req, res, next) => {
  try {
    const deleted = await studyPlaylistService.deleteItem(req.user.id, req.params.itemId);

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

// @desc    Reorder items within a playlist
// @route   PUT /api/study-playlists/:id/reorder
// @access  Private
exports.reorderItems = async (req, res, next) => {
  try {
    const { orderedIds } = req.body;

    const items = await studyPlaylistService.reorderItems(req.user.id, req.params.id, orderedIds);

    res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
};

// ── Progress Tracking ────────────────────────────────────────────────────

// @desc    Start working on a playlist item
// @route   POST /api/study-playlists/items/:itemId/start
// @access  Private
exports.startItem = async (req, res, next) => {
  try {
    const item = await studyPlaylistService.startItem(req.user.id, req.params.itemId);
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.message && error.message.includes('already completed')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
};

// @desc    Complete a playlist item
// @route   POST /api/study-playlists/items/:itemId/complete
// @access  Private
exports.completeItem = async (req, res, next) => {
  try {
    const { score, minutesSpent, notes } = req.body;

    const item = await studyPlaylistService.completeItem(req.user.id, req.params.itemId, {
      score,
      minutesSpent,
      notes,
    });

    await ActivityLog.create({
      user: req.user.id,
      activityType: 'playlist_item_completed',
      description: `Completed playlist item: "${item.title}"`,
    });

    res.status(200).json({ success: true, data: item });
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error.message && error.message.includes('already completed')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
};

// @desc    Skip a playlist item
// @route   POST /api/study-playlists/items/:itemId/skip
// @access  Private
exports.skipItem = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const item = await studyPlaylistService.skipItem(req.user.id, req.params.itemId, { reason });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
};

// ── Analytics & Insights ─────────────────────────────────────────────────

// @desc    Get playlist analytics
// @route   GET /api/study-playlists/analytics
// @access  Private
exports.getPlaylistAnalytics = async (req, res, next) => {
  try {
    const analytics = await studyPlaylistService.getPlaylistAnalytics(req.user.id);
    res.status(200).json({ success: true, data: analytics });
  } catch (error) {
    next(error);
  }
};

// @desc    Get next recommended item
// @route   GET /api/study-playlists/recommendations/next
// @access  Private
exports.getNextRecommendedItem = async (req, res, next) => {
  try {
    const recommendation = await studyPlaylistService.getNextRecommendedItem(req.user.id);

    if (!recommendation) {
      return res.status(404).json({ success: false, error: 'No pending items in active playlists' });
    }

    res.status(200).json({ success: true, data: recommendation });
  } catch (error) {
    next(error);
  }
};

// @desc    Get study session summary
// @route   GET /api/study-playlists/session
// @access  Private
exports.getStudySessionSummary = async (req, res, next) => {
  try {
    const { playlistId, maxItems } = req.query;

    const summary = await studyPlaylistService.getStudySessionSummary(req.user.id, {
      playlistId,
      maxItems: parseInt(maxItems, 10) || 10,
    });

    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};

// @desc    Archive completed playlists
// @route   POST /api/study-playlists/archive-completed
// @access  Private
exports.archiveCompletedPlaylists = async (req, res, next) => {
  try {
    const { olderThanDays } = req.body;
    const archivedCount = await studyPlaylistService.archiveCompletedPlaylists(
      req.user.id,
      olderThanDays || 7
    );

    res.status(200).json({
      success: true,
      data: { archivedCount },
    });
  } catch (error) {
    next(error);
  }
};
