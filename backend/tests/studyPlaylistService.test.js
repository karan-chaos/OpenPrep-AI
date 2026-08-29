const { describe, it, expect, vi, beforeEach } = require('vitest');

// ── Mocks ────────────────────────────────────────────────────────────────

const mockSequelize = {
  define: vi.fn(() => ({})),
  authenticate: vi.fn(),
};

const mockStudyPlaylist = {
  create: vi.fn(),
  findOne: vi.fn(),
  findAll: vi.fn(),
  findAndCountAll: vi.fn(),
  max: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
};

const mockStudyPlaylistItem = {
  create: vi.fn(),
  findOne: vi.fn(),
  findAll: vi.fn(),
  max: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
};

vi.mock('../config/db', () => ({
  sequelize: mockSequelize,
}));

vi.mock('../models/StudyPlaylist', () => ({
  default: mockStudyPlaylist,
  findOne: mockStudyPlaylist.findOne,
  findAll: mockStudyPlaylist.findAll,
  findAndCountAll: mockStudyPlaylist.findAndCountAll,
  create: mockStudyPlaylist.create,
  max: mockStudyPlaylist.max,
  update: mockStudyPlaylist.update,
  destroy: mockStudyPlaylist.destroy,
}));

vi.mock('../models/StudyPlaylistItem', () => ({
  default: mockStudyPlaylistItem,
  findOne: mockStudyPlaylistItem.findOne,
  findAll: mockStudyPlaylistItem.findAll,
  create: mockStudyPlaylistItem.create,
  max: mockStudyPlaylistItem.max,
  update: mockStudyPlaylistItem.update,
  destroy: mockStudyPlaylistItem.destroy,
}));

vi.mock('../models/ActivityLog', () => ({
  default: { create: vi.fn() },
}));

// Import after mocking
const studyPlaylistService = require('../services/studyPlaylistService');

// ── Test Data ────────────────────────────────────────────────────────────

const mockUserId = 'user-123';
const mockPlaylistId = 'playlist-789';
const mockItemId = 'item-456';

const mockPlaylistData = {
  title: 'Organic Chemistry Review',
  description: 'Complete review of organic chemistry for midterm',
  subject: 'subject-chem-1',
  playlistType: 'revision',
  priority: 'high',
  tags: ['chemistry', 'midterm'],
};

const mockCreatedPlaylist = {
  id: mockPlaylistId,
  user: mockUserId,
  ...mockPlaylistData,
  status: 'active',
  visibility: 'private',
  totalItems: 0,
  completedItems: 0,
  estimatedDurationMinutes: 0,
  actualDurationMinutes: 0,
  currentItemId: null,
  completionPercentage: 0,
  playCount: 0,
  tags: ['chemistry', 'midterm'],
  metadata: {},
  save: vi.fn().mockResolvedValue(true),
  toJSON: vi.fn().mockReturnValue({ id: mockPlaylistId, ...mockPlaylistData }),
};

const mockItemData = {
  ResourceType: 'note',
  resourceId: 'note-123',
  title: 'Chapter 5: Alcohols and Ethers',
  description: 'Read and summarize key reactions',
  estimatedMinutes: 20,
  sortOrder: 0,
};

const mockCreatedItem = {
  id: mockItemId,
  playlistId: mockPlaylistId,
  user: mockUserId,
  ...mockItemData,
  status: 'pending',
  actualMinutesSpent: 0,
  completionScore: null,
  notes: null,
  metadata: {},
  startedAt: null,
  completedAt: null,
  save: vi.fn().mockResolvedValue(true),
  toJSON: vi.fn().mockReturnValue({ id: mockItemId, ...mockItemData }),
};

// ── Tests ────────────────────────────────────────────────────────────────

describe('studyPlaylistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Playlist CRUD ────────────────────────────────────────────────────

  describe('createPlaylist', () => {
    it('should create a playlist with default values', async () => {
      mockStudyPlaylist.create.mockResolvedValue(mockCreatedPlaylist);

      const result = await studyPlaylistService.createPlaylist(mockUserId, mockPlaylistData);

      expect(mockStudyPlaylist.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user: mockUserId,
          title: 'Organic Chemistry Review',
          playlistType: 'revision',
          priority: 'high',
          status: 'active',
          visibility: 'private',
        })
      );
      expect(result.playlist).toEqual(mockCreatedPlaylist);
      expect(result.items).toEqual([]);
    });

    it('should create a playlist with initial items', async () => {
      mockStudyPlaylist.create.mockResolvedValue(mockCreatedPlaylist);
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);
      mockStudyPlaylistItem.max.mockResolvedValue(null);
      mockStudyPlaylistItem.create.mockResolvedValue(mockCreatedItem);

      const result = await studyPlaylistService.createPlaylist(mockUserId, {
        ...mockPlaylistData,
        items: [mockItemData],
      });

      expect(mockStudyPlaylistItem.create).toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
    });

    it('should create playlist with custom metadata', async () => {
      const playlistWithMeta = { ...mockCreatedPlaylist, metadata: { difficulty: 'hard' } };
      mockStudyPlaylist.create.mockResolvedValue(playlistWithMeta);

      const result = await studyPlaylistService.createPlaylist(mockUserId, {
        ...mockPlaylistData,
        metadata: { difficulty: 'hard' },
      });

      expect(mockStudyPlaylist.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { difficulty: 'hard' },
        })
      );
    });
  });

  describe('getUserPlaylists', () => {
    it('should return paginated playlists', async () => {
      mockStudyPlaylist.findAndCountAll.mockResolvedValue({
        count: 2,
        rows: [
          { id: 'p1', title: 'Playlist 1' },
          { id: 'p2', title: 'Playlist 2' },
        ],
      });

      const result = await studyPlaylistService.getUserPlaylists(mockUserId, {
        page: 1,
        limit: 10,
      });

      expect(result.playlists).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.page).toBe(1);
    });

    it('should apply status filter', async () => {
      mockStudyPlaylist.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await studyPlaylistService.getUserPlaylists(mockUserId, { status: 'active' });

      expect(mockStudyPlaylist.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        })
      );
    });

    it('should apply search filter with ILike', async () => {
      mockStudyPlaylist.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await studyPlaylistService.getUserPlaylists(mockUserId, { search: 'chemistry' });

      const callWhere = mockStudyPlaylist.findAndCountAll.mock.calls[0][0].where;
      expect(callWhere[Symbol.for('or')]).toBeDefined();
    });

    it('should sort by priority', async () => {
      mockStudyPlaylist.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await studyPlaylistService.getUserPlaylists(mockUserId, { sortBy: 'priority' });

      const callArgs = mockStudyPlaylist.findAndCountAll.mock.calls[0][0];
      expect(callArgs.order).toEqual([['priority', 'DESC'], ['createdAt', 'DESC']]);
    });

    it('should sort by completion percentage', async () => {
      mockStudyPlaylist.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await studyPlaylistService.getUserPlaylists(mockUserId, { sortBy: 'completion' });

      const callArgs = mockStudyPlaylist.findAndCountAll.mock.calls[0][0];
      expect(callArgs.order).toEqual([['completionPercentage', 'DESC'], ['createdAt', 'DESC']]);
    });
  });

  describe('getPlaylistById', () => {
    it('should return playlist with items', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);
      mockStudyPlaylistItem.findAll.mockResolvedValue([mockCreatedItem]);

      const result = await studyPlaylistService.getPlaylistById(mockUserId, mockPlaylistId);

      expect(result.playlist).toEqual(mockCreatedPlaylist);
      expect(result.items).toHaveLength(1);
    });

    it('should return null for non-existent playlist', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(null);

      const result = await studyPlaylistService.getPlaylistById(mockUserId, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should throw ForbiddenError for private playlist owned by another user', async () => {
      const otherUserPlaylist = { ...mockCreatedPlaylist, user: 'other-user', visibility: 'private' };
      mockStudyPlaylist.findOne.mockResolvedValue(otherUserPlaylist);

      await expect(
        studyPlaylistService.getPlaylistById(mockUserId, mockPlaylistId)
      ).rejects.toThrow('You do not have access to this playlist');
    });

    it('should allow access to shared playlists', async () => {
      const sharedPlaylist = { ...mockCreatedPlaylist, user: 'other-user', visibility: 'shared' };
      mockStudyPlaylist.findOne.mockResolvedValue(sharedPlaylist);
      mockStudyPlaylistItem.findAll.mockResolvedValue([]);

      const result = await studyPlaylistService.getPlaylistById(mockUserId, mockPlaylistId);
      expect(result.playlist).toEqual(sharedPlaylist);
    });
  });

  describe('updatePlaylist', () => {
    it('should update allowed fields', async () => {
      const playlist = {
        ...mockCreatedPlaylist,
        title: 'Old Title',
        save: vi.fn().mockResolvedValue(true),
      };
      mockStudyPlaylist.findOne.mockResolvedValue(playlist);

      const result = await studyPlaylistService.updatePlaylist(mockUserId, mockPlaylistId, {
        title: 'New Title',
        priority: 'urgent',
        status: 'paused',
      });

      expect(result.title).toBe('New Title');
      expect(result.priority).toBe('urgent');
      expect(result.status).toBe('paused');
      expect(result.save).toHaveBeenCalled();
    });

    it('should return null for non-existent playlist', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(null);

      const result = await studyPlaylistService.updatePlaylist(mockUserId, 'nonexistent', {
        title: 'Updated',
      });

      expect(result).toBeNull();
    });
  });

  describe('deletePlaylist', () => {
    it('should delete playlist and all items', async () => {
      const playlist = { ...mockCreatedPlaylist, destroy: vi.fn().mockResolvedValue(true) };
      mockStudyPlaylist.findOne.mockResolvedValue(playlist);
      mockStudyPlaylistItem.destroy.mockResolvedValue(5);

      const result = await studyPlaylistService.deletePlaylist(mockUserId, mockPlaylistId);

      expect(result).toBe(true);
      expect(mockStudyPlaylistItem.destroy).toHaveBeenCalledWith({
        where: { playlistId: mockPlaylistId },
      });
      expect(playlist.destroy).toHaveBeenCalled();
    });

    it('should return null for non-existent playlist', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(null);

      const result = await studyPlaylistService.deletePlaylist(mockUserId, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('duplicatePlaylist', () => {
    it('should duplicate a playlist with all items', async () => {
      const source = { ...mockCreatedPlaylist };
      mockStudyPlaylist.findOne
        .mockResolvedValueOnce(source) // source lookup
        .mockResolvedValueOnce(mockCreatedPlaylist); // new playlist created

      mockStudyPlaylistItem.findAll.mockResolvedValue([mockCreatedItem]);
      mockStudyPlaylistItem.max.mockResolvedValue(null);
      mockStudyPlaylistItem.create.mockResolvedValue(mockCreatedItem);
      mockStudyPlaylist.create.mockResolvedValue(mockCreatedPlaylist);

      const result = await studyPlaylistService.duplicatePlaylist(
        mockUserId,
        mockPlaylistId,
        'Copy of Chemistry'
      );

      expect(result).toBeDefined();
    });

    it('should throw NotFoundError for non-existent source', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(null);

      await expect(
        studyPlaylistService.duplicatePlaylist(mockUserId, 'nonexistent')
      ).rejects.toThrow('Playlist not found');
    });
  });

  // ── Item Management ──────────────────────────────────────────────────

  describe('addItem', () => {
    it('should add an item to a playlist', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);
      mockStudyPlaylistItem.max.mockResolvedValue(null);
      mockStudyPlaylistItem.create.mockResolvedValue(mockCreatedItem);

      const result = await studyPlaylistService.addItem(mockUserId, mockPlaylistId, mockItemData);

      expect(mockStudyPlaylistItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          playlistId: mockPlaylistId,
          user: mockUserId,
          ResourceType: 'note',
          title: 'Chapter 5: Alcohols and Ethers',
          estimatedMinutes: 20,
        })
      );
      expect(result).toEqual(mockCreatedItem);
    });

    it('should throw NotFoundError if playlist not found', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(null);

      await expect(
        studyPlaylistService.addItem(mockUserId, 'nonexistent', mockItemData)
      ).rejects.toThrow('Playlist not found');
    });

    it('should append to end when sortOrder not specified', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);
      mockStudyPlaylistItem.max.mockResolvedValue(3);
      mockStudyPlaylistItem.create.mockResolvedValue(mockCreatedItem);

      await studyPlaylistService.addItem(mockUserId, mockPlaylistId, mockItemData);

      const createCall = mockStudyPlaylistItem.create.mock.calls[0][0];
      expect(createCall.sortOrder).toBe(4);
    });
  });

  describe('bulkAddItems', () => {
    it('should add multiple items at once', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);
      mockStudyPlaylistItem.max.mockResolvedValue(null);
      mockStudyPlaylistItem.create.mockResolvedValue(mockCreatedItem);

      const items = [
        { title: 'Item 1', ResourceType: 'note' },
        { title: 'Item 2', ResourceType: 'quiz' },
        { title: 'Item 3', ResourceType: 'flashcard_deck' },
      ];

      const result = await studyPlaylistService.bulkAddItems(mockUserId, mockPlaylistId, items);

      expect(mockStudyPlaylistItem.create).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
    });

    it('should throw NotFoundError if playlist not found', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(null);

      await expect(
        studyPlaylistService.bulkAddItems(mockUserId, 'nonexistent', [{ title: 'Test' }])
      ).rejects.toThrow('Playlist not found');
    });
  });

  describe('updateItem', () => {
    it('should update item fields', async () => {
      const item = { ...mockCreatedItem, save: vi.fn().mockResolvedValue(true) };
      mockStudyPlaylistItem.findOne.mockResolvedValue(item);
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);

      const result = await studyPlaylistService.updateItem(mockUserId, mockItemId, {
        title: 'Updated Title',
        estimatedMinutes: 30,
      });

      expect(result.title).toBe('Updated Title');
      expect(result.estimatedMinutes).toBe(30);
      expect(result.save).toHaveBeenCalled();
    });

    it('should return null for non-existent item', async () => {
      mockStudyPlaylistItem.findOne.mockResolvedValue(null);

      const result = await studyPlaylistService.updateItem(mockUserId, 'nonexistent', {
        title: 'Updated',
      });
      expect(result).toBeNull();
    });
  });

  describe('deleteItem', () => {
    it('should delete an item and re-sort remaining', async () => {
      const item = { ...mockCreatedItem, destroy: vi.fn().mockResolvedValue(true) };
      mockStudyPlaylistItem.findOne.mockResolvedValue(item);
      mockStudyPlaylistItem.findAll.mockResolvedValue([
        { id: 'item-1', sortOrder: 0, save: vi.fn() },
        { id: 'item-2', sortOrder: 1, save: vi.fn() },
      ]);
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);

      const result = await studyPlaylistService.deleteItem(mockUserId, mockItemId);

      expect(result).toBe(true);
      expect(item.destroy).toHaveBeenCalled();
    });

    it('should return null for non-existent item', async () => {
      mockStudyPlaylistItem.findOne.mockResolvedValue(null);

      const result = await studyPlaylistService.deleteItem(mockUserId, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('reorderItems', () => {
    it('should reorder items according to orderedIds', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);

      const items = [
        { id: 'i1', user: mockUserId, sortOrder: 0, save: vi.fn() },
        { id: 'i2', user: mockUserId, sortOrder: 1, save: vi.fn() },
        { id: 'i3', user: mockUserId, sortOrder: 2, save: vi.fn() },
      ];
      mockStudyPlaylistItem.findAll.mockResolvedValue(items);

      const result = await studyPlaylistService.reorderItems(mockUserId, mockPlaylistId, [
        'i3',
        'i1',
        'i2',
      ]);

      expect(items[2].sortOrder).toBe(0); // i3 moved to first
      expect(items[0].sortOrder).toBe(1); // i1 moved to second
      expect(items[1].sortOrder).toBe(2); // i2 moved to third
    });

    it('should throw NotFoundError if playlist not found', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(null);

      await expect(
        studyPlaylistService.reorderItems(mockUserId, 'nonexistent', ['i1'])
      ).rejects.toThrow('Playlist not found');
    });

    it('should throw error for empty orderedIds', async () => {
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);

      await expect(
        studyPlaylistService.reorderItems(mockUserId, mockPlaylistId, [])
      ).rejects.toThrow('orderedIds must be a non-empty array');
    });
  });

  // ── Progress Tracking ────────────────────────────────────────────────

  describe('startItem', () => {
    it('should mark an item as in_progress', async () => {
      const pendingItem = { ...mockCreatedItem, status: 'pending', save: vi.fn() };
      mockStudyPlaylistItem.findOne.mockResolvedValue(pendingItem);
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);

      const result = await studyPlaylistService.startItem(mockUserId, mockItemId);

      expect(result.status).toBe('in_progress');
      expect(result.startedAt).toBeDefined();
      expect(result.save).toHaveBeenCalled();
    });

    it('should update playlist currentItemId', async () => {
      const pendingItem = { ...mockCreatedItem, status: 'pending', save: vi.fn() };
      mockStudyPlaylistItem.findOne.mockResolvedValue(pendingItem);
      const playlist = { ...mockCreatedPlaylist, currentItemId: null, playCount: 0 };
      mockStudyPlaylist.findOne.mockResolvedValue(playlist);

      await studyPlaylistService.startItem(mockUserId, mockItemId);

      expect(playlist.currentItemId).toBe(mockItemId);
      expect(playlist.playCount).toBe(1);
      expect(playlist.save).toHaveBeenCalled();
    });

    it('should throw for non-existent item', async () => {
      mockStudyPlaylistItem.findOne.mockResolvedValue(null);

      await expect(
        studyPlaylistService.startItem(mockUserId, 'nonexistent')
      ).rejects.toThrow('Item not found');
    });

    it('should throw for already completed item', async () => {
      mockStudyPlaylistItem.findOne.mockResolvedValue({
        ...mockCreatedItem,
        status: 'completed',
      });

      await expect(
        studyPlaylistService.startItem(mockUserId, mockItemId)
      ).rejects.toThrow('Item is already completed');
    });
  });

  describe('completeItem', () => {
    it('should mark an item as completed with score', async () => {
      const pendingItem = { ...mockCreatedItem, status: 'in_progress', save: vi.fn() };
      mockStudyPlaylistItem.findOne.mockResolvedValue(pendingItem);
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);
      mockStudyPlaylistItem.findOne
        .mockResolvedValueOnce(pendingItem)
        .mockResolvedValueOnce(null); // no next item

      const result = await studyPlaylistService.completeItem(mockUserId, mockItemId, {
        score: 85,
        minutesSpent: 20,
        notes: 'Good understanding of alcohols',
      });

      expect(result.status).toBe('completed');
      expect(result.completionScore).toBe(85);
      expect(result.actualMinutesSpent).toBe(20);
      expect(result.notes).toBe('Good understanding of alcohols');
      expect(result.completedAt).toBeDefined();
    });

    it('should auto-advance currentItemId to next pending item', async () => {
      const pendingItem = { ...mockCreatedItem, status: 'in_progress', save: vi.fn() };
      mockStudyPlaylistItem.findOne
        .mockResolvedValueOnce(pendingItem)
        .mockResolvedValueOnce({ id: 'next-item' }); // next pending item

      const playlist = { ...mockCreatedPlaylist, currentItemId: mockItemId };
      mockStudyPlaylist.findOne.mockResolvedValue(playlist);

      await studyPlaylistService.completeItem(mockUserId, mockItemId);

      expect(playlist.currentItemId).toBe('next-item');
    });

    it('should throw for already completed item', async () => {
      mockStudyPlaylistItem.findOne.mockResolvedValue({
        ...mockCreatedItem,
        status: 'completed',
      });

      await expect(
        studyPlaylistService.completeItem(mockUserId, mockItemId)
      ).rejects.toThrow('Item is already completed');
    });
  });

  describe('skipItem', () => {
    it('should skip an item with reason', async () => {
      const item = { ...mockCreatedItem, status: 'pending', save: vi.fn(), metadata: {} };
      mockStudyPlaylistItem.findOne.mockResolvedValue(item);
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);

      const result = await studyPlaylistService.skipItem(mockUserId, mockItemId, {
        reason: 'Too difficult, review later',
      });

      expect(result.status).toBe('skipped');
      expect(result.metadata.skipReason).toBe('Too difficult, review later');
      expect(result.metadata.skippedAt).toBeDefined();
    });

    it('should set default skip reason', async () => {
      const item = { ...mockCreatedItem, status: 'pending', save: vi.fn(), metadata: {} };
      mockStudyPlaylistItem.findOne.mockResolvedValue(item);
      mockStudyPlaylist.findOne.mockResolvedValue(mockCreatedPlaylist);

      const result = await studyPlaylistService.skipItem(mockUserId, mockItemId, {});

      expect(result.metadata.skipReason).toBe('No reason provided');
    });
  });

  // ── Analytics ────────────────────────────────────────────────────────

  describe('getPlaylistAnalytics', () => {
    it('should return comprehensive analytics', async () => {
      mockStudyPlaylist.findAll.mockResolvedValue([
        { id: 'p1', status: 'active', playlistType: 'revision', completionPercentage: 75, totalItems: 10, completedItems: 7, lastAccessedAt: new Date() },
        { id: 'p2', status: 'completed', playlistType: 'exam_prep', completionPercentage: 100, totalItems: 5, completedItems: 5, lastAccessedAt: null },
      ]);

      mockStudyPlaylistItem.findAll.mockResolvedValue([
        { ResourceType: 'note', status: 'completed', completionScore: 85, estimatedMinutes: 20, actualMinutesSpent: 18 },
        { ResourceType: 'quiz', status: 'completed', completionScore: 90, estimatedMinutes: 15, actualMinutesSpent: 12 },
        { ResourceType: 'note', status: 'pending', completionScore: null, estimatedMinutes: 25, actualMinutesSpent: 0 },
        { ResourceType: 'flashcard_deck', status: 'skipped', completionScore: null, estimatedMinutes: 10, actualMinutesSpent: 0 },
        { ResourceType: 'quiz', status: 'in_progress', completionScore: null, estimatedMinutes: 20, actualMinutesSpent: 5 },
      ]);

      const analytics = await studyPlaylistService.getPlaylistAnalytics(mockUserId);

      expect(analytics.summary).toBeDefined();
      expect(analytics.summary.totalPlaylists).toBe(2);
      expect(analytics.summary.activePlaylists).toBe(1);
      expect(analytics.summary.completedPlaylists).toBe(1);
      expect(analytics.summary.totalItems).toBe(5);
      expect(analytics.summary.completedItems).toBe(2);
      expect(analytics.summary.skippedItems).toBe(1);
      expect(analytics.summary.inProgressItems).toBe(1);
      expect(analytics.summary.pendingItems).toBe(1);
      expect(analytics.summary.averageCompletionRate).toBe(40);
      expect(analytics.resourceDistribution).toBeDefined();
      expect(analytics.typeBreakdown).toBeDefined();
      expect(analytics.topPlaylists).toBeDefined();
      expect(analytics.overduePlaylists).toBeDefined();
    });

    it('should handle zero items gracefully', async () => {
      mockStudyPlaylist.findAll.mockResolvedValue([]);
      mockStudyPlaylistItem.findAll.mockResolvedValue([]);

      const analytics = await studyPlaylistService.getPlaylistAnalytics(mockUserId);

      expect(analytics.summary.totalPlaylists).toBe(0);
      expect(analytics.summary.averageCompletionRate).toBe(0);
      expect(analytics.topPlaylists).toHaveLength(0);
    });
  });

  describe('getNextRecommendedItem', () => {
    it('should return in-progress item first', async () => {
      mockStudyPlaylist.findAll.mockResolvedValue([
        { id: 'p1', title: 'Chemistry Review', status: 'active' },
      ]);

      mockStudyPlaylistItem.findOne
        .mockResolvedValueOnce({ id: 'in-progress-item', title: 'In Progress' })
        .mockResolvedValueOnce(null);

      const result = await studyPlaylistService.getNextRecommendedItem(mockUserId);

      expect(result.reason).toBe('Resume in-progress item');
      expect(result.item.id).toBe('in-progress-item');
      expect(result.playlist.title).toBe('Chemistry Review');
    });

    it('should return next pending item if no in-progress', async () => {
      mockStudyPlaylist.findAll.mockResolvedValue([
        { id: 'p1', title: 'Physics Review', status: 'active' },
      ]);

      mockStudyPlaylistItem.findOne
        .mockResolvedValueOnce(null) // no in-progress
        .mockResolvedValueOnce({ id: 'next-pending', title: 'Next Pending' }); // next pending

      const result = await studyPlaylistService.getNextRecommendedItem(mockUserId);

      expect(result.reason).toBe('Next item in "Physics Review"');
      expect(result.item.id).toBe('next-pending');
    });

    it('should return null when no active playlists have pending items', async () => {
      mockStudyPlaylist.findAll.mockResolvedValue([]);
      mockStudyPlaylistItem.findOne.mockResolvedValue(null);

      const result = await studyPlaylistService.getNextRecommendedItem(mockUserId);
      expect(result).toBeNull();
    });
  });

  describe('getStudySessionSummary', () => {
    it('should return session items with time estimates', async () => {
      mockStudyPlaylist.findAll.mockResolvedValue([
        { id: 'p1', title: 'Morning Review', status: 'active' },
      ]);

      mockStudyPlaylistItem.findAll.mockResolvedValue([
        { id: 'i1', status: 'in_progress', estimatedMinutes: 15, toJSON: () => ({ id: 'i1', estimatedMinutes: 15 }) },
        { id: 'i2', status: 'pending', estimatedMinutes: 20, toJSON: () => ({ id: 'i2', estimatedMinutes: 20 }) },
      ]);

      const summary = await studyPlaylistService.getStudySessionSummary(mockUserId);

      expect(summary.items).toHaveLength(2);
      expect(summary.totalEstimatedMinutes).toBe(35);
      expect(summary.itemCount).toBe(2);
    });

    it('should respect maxItems limit', async () => {
      mockStudyPlaylist.findAll.mockResolvedValue([
        { id: 'p1', title: 'Review', status: 'active' },
      ]);

      const manyItems = Array.from({ length: 15 }, (_, i) => ({
        id: `i${i}`,
        status: 'pending',
        estimatedMinutes: 10,
        toJSON: () => ({ id: `i${i}`, estimatedMinutes: 10 }),
      }));
      mockStudyPlaylistItem.findAll.mockResolvedValue(manyItems);

      const summary = await studyPlaylistService.getStudySessionSummary(mockUserId, {
        maxItems: 5,
      });

      expect(summary.itemCount).toBeLessThanOrEqual(5);
    });
  });

  describe('archiveCompletedPlaylists', () => {
    it('should archive completed playlists older than given days', async () => {
      mockStudyPlaylist.update.mockResolvedValue([3]);

      const count = await studyPlaylistService.archiveCompletedPlaylists(mockUserId, 7);

      expect(count).toBe(3);
      expect(mockStudyPlaylist.update).toHaveBeenCalledWith(
        { status: 'archived' },
        expect.objectContaining({
          where: expect.objectContaining({
            user: mockUserId,
            status: 'completed',
          }),
        })
      );
    });
  });
});

// ── Controller Tests ────────────────────────────────────────────────────

describe('studyPlaylistController', () => {
  it('exports all handler functions', () => {
    const controller = require('../controllers/studyPlaylistController');
    expect(typeof controller.createPlaylist).toBe('function');
    expect(typeof controller.getPlaylists).toBe('function');
    expect(typeof controller.getPlaylist).toBe('function');
    expect(typeof controller.updatePlaylist).toBe('function');
    expect(typeof controller.deletePlaylist).toBe('function');
    expect(typeof controller.duplicatePlaylist).toBe('function');
    expect(typeof controller.addItem).toBe('function');
    expect(typeof controller.bulkAddItems).toBe('function');
    expect(typeof controller.updateItem).toBe('function');
    expect(typeof controller.deleteItem).toBe('function');
    expect(typeof controller.reorderItems).toBe('function');
    expect(typeof controller.startItem).toBe('function');
    expect(typeof controller.completeItem).toBe('function');
    expect(typeof controller.skipItem).toBe('function');
    expect(typeof controller.getPlaylistAnalytics).toBe('function');
    expect(typeof controller.getNextRecommendedItem).toBe('function');
    expect(typeof controller.getStudySessionSummary).toBe('function');
    expect(typeof controller.archiveCompletedPlaylists).toBe('function');
  });
});

// ── Routes Tests ────────────────────────────────────────────────────────

describe('studyPlaylistRoutes', () => {
  it('exports an Express router', () => {
    const router = require('../routes/studyPlaylistRoutes');
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });
});
