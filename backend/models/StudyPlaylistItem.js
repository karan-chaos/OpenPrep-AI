const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * StudyPlaylistItem — a single entry in a StudyPlaylist, representing a study
 * resource to be completed in order. Each item points to one of several resource
 * types (note, quiz, flashcard deck, PYQ) and tracks individual completion state.
 */
const StudyPlaylistItem = sequelize.define(
  'StudyPlaylistItem',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    playlistId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    user: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    ResourceType: {
      type: DataTypes.ENUM('note', 'quiz', 'flashcard_deck', 'pyq', 'custom'),
      allowNull: false,
    },
    resourceId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Item title is required' },
        len: { args: [1, 300], msg: 'Item title must be between 1 and 300 characters' },
      },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'skipped'),
      defaultValue: 'pending',
      allowNull: false,
    },
    estimatedMinutes: {
      type: DataTypes.INTEGER,
      defaultValue: 15,
      validate: {
        min: { args: [1], msg: 'Estimated minutes must be at least 1' },
      },
    },
    actualMinutesSpent: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    completionScore: {
      type: DataTypes.FLOAT,
      allowNull: true,
      validate: {
        min: 0,
        max: 100,
      },
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
    },
  },
  {
    timestamps: true,
    indexes: [
      {
        name: 'studyplaylistitem_playlist_sort_idx',
        fields: ['playlistId', 'sortOrder'],
      },
      {
        name: 'studyplaylistitem_user_status_idx',
        fields: ['user', 'status'],
      },
      {
        name: 'studyplaylistitem_playlist_status_idx',
        fields: ['playlistId', 'status'],
      },
      {
        name: 'studyplaylistitem_resource_idx',
        fields: ['ResourceType', 'resourceId'],
      },
    ],
  }
);

module.exports = StudyPlaylistItem;
