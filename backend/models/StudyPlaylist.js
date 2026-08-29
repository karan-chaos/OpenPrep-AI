const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * StudyPlaylist — an ordered collection of study resources (notes, quizzes,
 * flashcards, PYQs) that a student queues up to work through sequentially.
 *
 * Each playlist tracks overall progress, estimated duration, and supports
 * sharing with other students or making playlists public for community use.
 */
const StudyPlaylist = sequelize.define(
  'StudyPlaylist',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Playlist title is required' },
        len: { args: [1, 200], msg: 'Playlist title must be between 1 and 200 characters' },
      },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    subject: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    playlistType: {
      type: DataTypes.ENUM('revision', 'exam_prep', 'daily_practice', 'deep_dive', 'custom'),
      defaultValue: 'custom',
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'completed', 'archived', 'paused'),
      defaultValue: 'active',
      allowNull: false,
    },
    visibility: {
      type: DataTypes.ENUM('private', 'shared', 'public'),
      defaultValue: 'private',
      allowNull: false,
    },
    totalItems: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    completedItems: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    estimatedDurationMinutes: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    actualDurationMinutes: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    currentItemId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    targetCompletionDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    priority: {
      type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
      defaultValue: 'medium',
    },
    tags: {
      type: DataTypes.JSONB,
      defaultValue: [],
    },
    coverImageUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    sharedWithUserIds: {
      type: DataTypes.JSONB,
      defaultValue: [],
    },
    completionPercentage: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 100,
      },
    },
    averageRating: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    ratingCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    playCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    lastAccessedAt: {
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
        name: 'studyplaylist_user_status_idx',
        fields: ['user', 'status'],
      },
      {
        name: 'studyplaylist_user_type_idx',
        fields: ['user', 'playlistType'],
      },
      {
        name: 'studyplaylist_subject_idx',
        fields: ['subject'],
      },
      {
        name: 'studyplaylist_visibility_idx',
        fields: ['visibility'],
      },
      {
        name: 'studyplaylist_priority_idx',
        fields: ['user', 'priority'],
      },
    ],
  }
);

module.exports = StudyPlaylist;
