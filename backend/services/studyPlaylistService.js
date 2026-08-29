const { Op } = require('sequelize');
const { sequelize } = require('../config/db');
const StudyPlaylist = require('../models/StudyPlaylist');
const StudyPlaylistItem = require('../models/StudyPlaylistItem');

// ── Errors ───────────────────────────────────────────────────────────────

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
  }
}

// ── Playlist CRUD ────────────────────────────────────────────────────────

/**
 * Create a new study playlist with optional initial items.
 */
async function createPlaylist(userId, data) {
  const { items: initialItems, ...playlistData } = data;

  const playlist = await StudyPlaylist.create({
    user: userId,
    title: playlistData.title,
    description: playlistData.description,
    subject: playlistData.subject,
    playlistType: playlistData.playlistType || 'custom',
    visibility: playlistData.visibility || 'private',
    priority: playlistData.priority || 'medium',
    targetCompletionDate: playlistData.targetCompletionDate,
    tags: playlistData.tags || [],
    coverImageUrl: playlistData.coverImageUrl,
    metadata: playlistData.metadata || {},
  });

  // Create initial items if provided
  if (Array.isArray(initialItems) && initialItems.length > 0) {
    const createdItems = await bulkAddItems(userId, playlist.id, initialItems);
    return { playlist, items: createdItems };
  }

  return { playlist, items: [] };
}

/**
 * Get all playlists for a user with optional filters and pagination.
 */
async function getUserPlaylists(userId, { status, playlistType, subjectId, visibility, search, sortBy, page = 1, limit = 20 } = {}) {
  const where = { user: userId };
  if (status) where.status = status;
  if (playlistType) where.playlistType = playlistType;
  if (subjectId) where.subject = subjectId;
  if (visibility) where.visibility = visibility;
  if (search) {
    where[Op.or] = [
      { title: { [Op.iLike]: `%${search}%` } },
      { description: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const offset = (Math.max(1, page) - 1) * limit;

  let order;
  switch (sortBy) {
    case 'priority':
      order = [['priority', 'DESC'], ['createdAt', 'DESC']];
      break;
    case 'completion':
      order = [['completionPercentage', 'DESC'], ['createdAt', 'DESC']];
      break;
    case 'recent':
      order = [['lastAccessedAt', 'DESC']];
      break;
    case 'title':
      order = [['title', 'ASC']];
      break;
    default:
      order = [['createdAt', 'DESC']];
  }

  const { count, rows: playlists } = await StudyPlaylist.findAndCountAll({
    where,
    order,
    offset,
    limit,
  });

  return {
    playlists,
    pagination: {
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
      limit,
    },
  };
}

/**
 * Get a single playlist with its items.
 */
async function getPlaylistById(userId, playlistId) {
  const playlist = await StudyPlaylist.findOne({
    where: { id: playlistId },
  });

  if (!playlist) return null;

  // Check access
  if (playlist.user !== userId && playlist.visibility === 'private') {
    throw new ForbiddenError('You do not have access to this playlist');
  }

  const items = await StudyPlaylistItem.findAll({
    where: { playlistId: playlist.id },
    order: [['sortOrder', 'ASC']],
  });

  return { playlist, items };
}

/**
 * Update a playlist's properties.
 */
async function updatePlaylist(userId, playlistId, updates) {
  const playlist = await StudyPlaylist.findOne({
    where: { id: playlistId, user: userId },
  });
  if (!playlist) return null;

  const allowedFields = [
    'title', 'description', 'subject', 'playlistType', 'status',
    'visibility', 'priority', 'targetCompletionDate', 'tags',
    'coverImageUrl', 'sharedWithUserIds', 'metadata',
  ];

  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      playlist[key] = updates[key];
    }
  }

  await playlist.save();
  return playlist;
}

/**
 * Delete a playlist and all its items.
 */
async function deletePlaylist(userId, playlistId) {
  const playlist = await StudyPlaylist.findOne({
    where: { id: playlistId, user: userId },
  });
  if (!playlist) return null;

  await StudyPlaylistItem.destroy({ where: { playlistId: playlist.id } });
  await playlist.destroy();
  return true;
}

/**
 * Duplicate a playlist with all its items.
 */
async function duplicatePlaylist(userId, playlistId, newTitle) {
  const source = await StudyPlaylist.findOne({
    where: { id: playlistId },
  });
  if (!source) throw new NotFoundError('Playlist not found');

  if (source.user !== userId && source.visibility === 'private') {
    throw new ForbiddenError('You do not have access to this playlist');
  }

  const sourceItems = await StudyPlaylistItem.findAll({
    where: { playlistId: source.id },
    order: [['sortOrder', 'ASC']],
  });

  const { playlist: newPlaylist } = await createPlaylist(userId, {
    title: newTitle || `${source.title} (Copy)`,
    description: source.description,
    subject: source.subject,
    playlistType: source.playlistType,
    priority: source.priority,
    tags: source.tags,
    coverImageUrl: source.coverImageUrl,
    items: sourceItems.map((item) => ({
      ResourceType: item.ResourceType,
      resourceId: item.resourceId,
      title: item.title,
      description: item.description,
      sortOrder: item.sortOrder,
      estimatedMinutes: item.estimatedMinutes,
      metadata: item.metadata,
    })),
  });

  return newPlaylist;
}

// ── Item Management ──────────────────────────────────────────────────────

/**
 * Add a single item to a playlist.
 */
async function addItem(userId, playlistId, itemData) {
  const playlist = await StudyPlaylist.findOne({
    where: { id: playlistId, user: userId },
  });
  if (!playlist) throw new NotFoundError('Playlist not found');

  // Determine sort order (append to end)
  const maxOrder = await StudyPlaylistItem.max('sortOrder', {
    where: { playlistId },
  });
  const sortOrder = itemData.sortOrder !== undefined ? itemData.sortOrder : (maxOrder !== null ? maxOrder + 1 : 0);

  const item = await StudyPlaylistItem.create({
    playlistId,
    user: userId,
    ResourceType: itemData.ResourceType || 'custom',
    resourceId: itemData.resourceId || null,
    title: itemData.title,
    description: itemData.description,
    sortOrder,
    estimatedMinutes: itemData.estimatedMinutes || 15,
    notes: itemData.notes,
    metadata: itemData.metadata || {},
  });

  // Update playlist totals
  await recalculatePlaylistStats(playlist);

  return item;
}

/**
 * Add multiple items to a playlist at once.
 */
async function bulkAddItems(userId, playlistId, itemsData) {
  const playlist = await StudyPlaylist.findOne({
    where: { id: playlistId, user: userId },
  });
  if (!playlist) throw new NotFoundError('Playlist not found');

  const maxOrder = await StudyPlaylistItem.max('sortOrder', {
    where: { playlistId },
  });
  let nextOrder = maxOrder !== null ? maxOrder + 1 : 0;

  const items = [];
  for (const itemData of itemsData) {
    const item = await StudyPlaylistItem.create({
      playlistId,
      user: userId,
      ResourceType: itemData.ResourceType || 'custom',
      resourceId: itemData.resourceId || null,
      title: itemData.title,
      description: itemData.description || null,
      sortOrder: itemData.sortOrder !== undefined ? itemData.sortOrder : nextOrder++,
      estimatedMinutes: itemData.estimatedMinutes || 15,
      notes: itemData.notes || null,
      metadata: itemData.metadata || {},
    });
    items.push(item);
  }

  await recalculatePlaylistStats(playlist);
  return items;
}

/**
 * Update a single item.
 */
async function updateItem(userId, itemId, updates) {
  const item = await StudyPlaylistItem.findOne({
    where: { id: itemId, user: userId },
  });
  if (!item) return null;

  const allowedFields = [
    'title', 'description', 'sortOrder', 'estimatedMinutes',
    'notes', 'metadata', 'ResourceType', 'resourceId', 'status',
  ];

  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      item[key] = updates[key];
    }
  }

  await item.save();

  // Recalculate parent playlist stats
  const playlist = await StudyPlaylist.findOne({
    where: { id: item.playlistId, user: userId },
  });
  if (playlist) {
    await recalculatePlaylistStats(playlist);
  }

  return item;
}

/**
 * Delete a single item from a playlist.
 */
async function deleteItem(userId, itemId) {
  const item = await StudyPlaylistItem.findOne({
    where: { id: itemId, user: userId },
  });
  if (!item) return null;

  const playlistId = item.playlistId;
  await item.destroy();

  // Recalculate and re-sort remaining items
  const remaining = await StudyPlaylistItem.findAll({
    where: { playlistId },
    order: [['sortOrder', 'ASC']],
  });

  for (let i = 0; i < remaining.length; i++) {
    remaining[i].sortOrder = i;
    await remaining[i].save();
  }

  const playlist = await StudyPlaylist.findOne({
    where: { id: playlistId, user: userId },
  });
  if (playlist) {
    await recalculatePlaylistStats(playlist);
  }

  return true;
}

/**
 * Reorder items within a playlist.
 * `orderedIds` is an array of item IDs in the desired order.
 */
async function reorderItems(userId, playlistId, orderedIds) {
  const playlist = await StudyPlaylist.findOne({
    where: { id: playlistId, user: userId },
  });
  if (!playlist) throw new NotFoundError('Playlist not found');

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new Error('orderedIds must be a non-empty array');
  }

  const items = await StudyPlaylistItem.findAll({
    where: { playlistId },
  });

  const itemMap = new Map(items.map((item) => [item.id, item]));

  for (let i = 0; i < orderedIds.length; i++) {
    const item = itemMap.get(orderedIds[i]);
    if (item && item.user === userId) {
      item.sortOrder = i;
      await item.save();
    }
  }

  // Handle any items not in the orderedIds list (move to end)
  let maxOrder = orderedIds.length;
  for (const item of items) {
    if (!orderedIds.includes(item.id) && item.user === userId) {
      item.sortOrder = maxOrder++;
      await item.save();
    }
  }

  return await StudyPlaylistItem.findAll({
    where: { playlistId },
    order: [['sortOrder', 'ASC']],
  });
}

// ── Progress Tracking ────────────────────────────────────────────────────

/**
 * Start working on an item (mark as in_progress).
 */
async function startItem(userId, itemId) {
  const item = await StudyPlaylistItem.findOne({
    where: { id: itemId, user: userId },
  });
  if (!item) throw new NotFoundError('Item not found');

  if (item.status === 'completed') {
    throw new Error('Item is already completed');
  }

  item.status = 'in_progress';
  item.startedAt = item.startedAt || new Date();
  await item.save();

  // Update playlist's current item pointer
  const playlist = await StudyPlaylist.findOne({
    where: { id: item.playlistId },
  });
  if (playlist) {
    playlist.currentItemId = item.id;
    playlist.lastAccessedAt = new Date();
    playlist.playCount = (playlist.playCount || 0) + 1;
    await playlist.save();
  }

  return item;
}

/**
 * Complete an item with optional score and time spent.
 */
async function completeItem(userId, itemId, { score, minutesSpent, notes } = {}) {
  const item = await StudyPlaylistItem.findOne({
    where: { id: itemId, user: userId },
  });
  if (!item) throw new NotFoundError('Item not found');

  if (item.status === 'completed') {
    throw new Error('Item is already completed');
  }

  item.status = 'completed';
  item.completedAt = new Date();
  if (score !== undefined) item.completionScore = score;
  if (minutesSpent !== undefined) item.actualMinutesSpent = minutesSpent;
  if (notes) item.notes = notes;
  await item.save();

  // Recalculate playlist stats
  const playlist = await StudyPlaylist.findOne({
    where: { id: item.playlistId },
  });
  if (playlist) {
    await recalculatePlaylistStats(playlist);

    // Auto-advance currentItemId to next pending item
    const nextItem = await StudyPlaylistItem.findOne({
      where: { playlistId: playlist.id, status: { [Op.in]: ['pending', 'in_progress'] } },
      order: [['sortOrder', 'ASC']],
    });
    playlist.currentItemId = nextItem ? nextItem.id : null;
    playlist.lastAccessedAt = new Date();
    await playlist.save();
  }

  return item;
}

/**
 * Skip an item with an optional reason.
 */
async function skipItem(userId, itemId, { reason } = {}) {
  const item = await StudyPlaylistItem.findOne({
    where: { id: itemId, user: userId },
  });
  if (!item) throw new NotFoundError('Item not found');

  item.status = 'skipped';
  item.metadata = { ...item.metadata, skipReason: reason || 'No reason provided', skippedAt: new Date().toISOString() };
  await item.save();

  const playlist = await StudyPlaylist.findOne({
    where: { id: item.playlistId },
  });
  if (playlist) {
    await recalculatePlaylistStats(playlist);
    playlist.lastAccessedAt = new Date();
    await playlist.save();
  }

  return item;
}

// ── Analytics & Insights ─────────────────────────────────────────────────

/**
 * Get comprehensive analytics for a user's playlists.
 */
async function getPlaylistAnalytics(userId) {
  const playlists = await StudyPlaylist.findAll({
    where: { user: userId },
  });

  const items = await StudyPlaylistItem.findAll({
    where: { user: userId },
  });

  const totalPlaylists = playlists.length;
  const activePlaylists = playlists.filter((p) => p.status === 'active').length;
  const completedPlaylists = playlists.filter((p) => p.status === 'completed').length;
  const totalItems = items.length;
  const completedItems = items.filter((i) => i.status === 'completed').length;
  const skippedItems = items.filter((i) => i.status === 'skipped').length;
  const inProgressItems = items.filter((i) => i.status === 'in_progress').length;
  const pendingItems = items.filter((i) => i.status === 'pending').length;

  const totalEstimatedMinutes = items.reduce((sum, i) => sum + (i.estimatedMinutes || 0), 0);
  const totalActualMinutes = items.reduce((sum, i) => sum + (i.actualMinutesSpent || 0), 0);

  const averageCompletionRate = totalItems > 0
    ? Math.round((completedItems / totalItems) * 100)
    : 0;

  const averageScore = items
    .filter((i) => i.completionScore !== null && i.completionScore !== undefined)
    .reduce((acc, item, _, arr) => acc + item.completionScore / arr.length, 0);

  // Time efficiency: estimated vs actual
  const timeEfficiency = totalEstimatedMinutes > 0
    ? Math.round((totalEstimatedMinutes / Math.max(totalActualMinutes, 1)) * 100)
    : 0;

  // Resource type distribution
  const resourceDistribution = {};
  for (const item of items) {
    const type = item.ResourceType;
    if (!resourceDistribution[type]) {
      resourceDistribution[type] = { total: 0, completed: 0, avgScore: 0, scores: [] };
    }
    resourceDistribution[type].total++;
    if (item.status === 'completed') {
      resourceDistribution[type].completed++;
      if (item.completionScore !== null && item.completionScore !== undefined) {
        resourceDistribution[type].scores.push(item.completionScore);
      }
    }
  }
  for (const type of Object.keys(resourceDistribution)) {
    const scores = resourceDistribution[type].scores;
    resourceDistribution[type].avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;
    delete resourceDistribution[type].scores;
  }

  // Playlist type breakdown
  const typeBreakdown = {};
  for (const playlist of playlists) {
    const type = playlist.playlistType;
    if (!typeBreakdown[type]) {
      typeBreakdown[type] = { count: 0, avgCompletion: 0, completions: [] };
    }
    typeBreakdown[type].count++;
    typeBreakdown[type].completions.push(playlist.completionPercentage || 0);
  }
  for (const type of Object.keys(typeBreakdown)) {
    const completions = typeBreakdown[type].completions;
    typeBreakdown[type].avgCompletion = Math.round(
      completions.reduce((a, b) => a + b, 0) / completions.length
    );
    delete typeBreakdown[type].completions;
  }

  // Top performing playlists
  const topPlaylists = playlists
    .filter((p) => p.totalItems > 0)
    .sort((a, b) => (b.completionPercentage || 0) - (a.completionPercentage || 0))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      title: p.title,
      completionPercentage: p.completionPercentage,
      totalItems: p.totalItems,
      completedItems: p.completedItems,
    }));

  // Recently accessed
  const recentlyAccessed = playlists
    .filter((p) => p.lastAccessedAt)
    .sort((a, b) => new Date(b.lastAccessedAt) - new Date(a.lastAccessedAt))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      title: p.title,
      lastAccessedAt: p.lastAccessedAt,
      completionPercentage: p.completionPercentage,
    }));

  // Overdue playlists
  const now = new Date();
  const overduePlaylists = playlists
    .filter((p) => p.targetCompletionDate && new Date(p.targetCompletionDate) < now && p.status === 'active')
    .map((p) => ({
      id: p.id,
      title: p.title,
      targetCompletionDate: p.targetCompletionDate,
      completionPercentage: p.completionPercentage,
      daysOverdue: Math.ceil((now - new Date(p.targetCompletionDate)) / (1000 * 60 * 60 * 24)),
    }));

  return {
    summary: {
      totalPlaylists,
      activePlaylists,
      completedPlaylists,
      totalItems,
      completedItems,
      skippedItems,
      inProgressItems,
      pendingItems,
      averageCompletionRate,
      averageScore: Math.round(averageScore * 100) / 100,
      totalEstimatedMinutes,
      totalActualMinutes,
      timeEfficiency,
    },
    resourceDistribution,
    typeBreakdown,
    topPlaylists,
    recentlyAccessed,
    overduePlaylists,
  };
}

/**
 * Get the next recommended item across all active playlists.
 */
async function getNextRecommendedItem(userId) {
  const activePlaylists = await StudyPlaylist.findAll({
    where: { user: userId, status: 'active' },
    order: [['priority', 'DESC'], ['createdAt', 'DESC']],
  });

  for (const playlist of activePlaylists) {
    // First check for in-progress items
    const inProgress = await StudyPlaylistItem.findOne({
      where: { playlistId: playlist.id, status: 'in_progress' },
      order: [['sortOrder', 'ASC']],
    });
    if (inProgress) {
      return {
        item: inProgress,
        playlist: { id: playlist.id, title: playlist.title },
        reason: 'Resume in-progress item',
      };
    }

    // Then check for next pending item
    const nextPending = await StudyPlaylistItem.findOne({
      where: { playlistId: playlist.id, status: 'pending' },
      order: [['sortOrder', 'ASC']],
    });
    if (nextPending) {
      return {
        item: nextPending,
        playlist: { id: playlist.id, title: playlist.title },
        reason: `Next item in "${playlist.title}"`,
      };
    }
  }

  return null;
}

/**
 * Get a study session summary: what's upcoming and time estimates.
 */
async function getStudySessionSummary(userId, { playlistId, maxItems = 10 } = {}) {
  const where = { user: userId, status: 'active' };
  if (playlistId) where.id = playlistId;

  const playlists = await StudyPlaylist.findAll({
    where,
    order: [['priority', 'DESC'], ['createdAt', 'DESC']],
  });

  const sessionItems = [];
  let totalMinutes = 0;

  for (const playlist of playlists) {
    const items = await StudyPlaylistItem.findAll({
      where: {
        playlistId: playlist.id,
        status: { [Op.in]: ['in_progress', 'pending'] },
      },
      order: [['sortOrder', 'ASC']],
      limit: maxItems - sessionItems.length,
    });

    for (const item of items) {
      sessionItems.push({
        ...item.toJSON(),
        playlistId: playlist.id,
        playlistTitle: playlist.title,
      });
      totalMinutes += item.estimatedMinutes || 15;
      if (sessionItems.length >= maxItems) break;
    }
    if (sessionItems.length >= maxItems) break;
  }

  return {
    items: sessionItems,
    totalEstimatedMinutes: totalMinutes,
    itemCount: sessionItems.length,
  };
}

/**
 * Archive all completed playlists older than a given number of days.
 */
async function archiveCompletedPlaylists(userId, olderThanDays = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const [updatedCount] = await StudyPlaylist.update(
    { status: 'archived' },
    {
      where: {
        user: userId,
        status: 'completed',
        completedAt: { [Op.lt]: cutoff },
      },
    }
  );

  return updatedCount;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Recalculate a playlist's aggregate stats from its items.
 */
async function recalculatePlaylistStats(playlist) {
  const items = await StudyPlaylistItem.findAll({
    where: { playlistId: playlist.id },
  });

  const totalItems = items.length;
  const completedItems = items.filter((i) => i.status === 'completed').length;
  const totalEstimated = items.reduce((sum, i) => sum + (i.estimatedMinutes || 0), 0);
  const totalActual = items.reduce((sum, i) => sum + (i.actualMinutesSpent || 0), 0);

  playlist.totalItems = totalItems;
  playlist.completedItems = completedItems;
  playlist.estimatedDurationMinutes = totalEstimated;
  playlist.actualDurationMinutes = totalActual;
  playlist.completionPercentage = totalItems > 0
    ? Math.round((completedItems / totalItems) * 100)
    : 0;

  // Auto-complete playlist if all items done
  if (totalItems > 0 && completedItems === totalItems && playlist.status === 'active') {
    playlist.status = 'completed';
    playlist.completedAt = new Date();
  }

  await playlist.save();
  return playlist;
}

module.exports = {
  createPlaylist,
  getUserPlaylists,
  getPlaylistById,
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
  recalculatePlaylistStats,
  NotFoundError,
  ForbiddenError,
};
