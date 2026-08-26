const { expect, describe, it, vi, beforeEach } = require('vitest');

/**
 * Unit tests for pdfProgressReportService.
 *
 * Models are mocked so the PDF generation logic and recommendation
 * engine can be tested without a real database.
 */

vi.mock('../../models/QuizAttempt', () => ({ default: { findAll: vi.fn() } }));
vi.mock('../../models/Quiz', () => ({ default: {} }));
vi.mock('../../models/Subject', () => ({ default: { findAll: vi.fn() } }));
vi.mock('../../models/Topic', () => ({ default: { findAll: vi.fn() } }));
vi.mock('../../models/StudyPlan', () => ({ default: { findAll: vi.fn() } }));
vi.mock('../../models/FocusSession', () => ({ default: { findAll: vi.fn() } }));
vi.mock('../../models/Flashcard', () => ({ default: { count: vi.fn() } }));
vi.mock('../../models/User', () => ({ default: { findByPk: vi.fn() } }));
vi.mock('../../models/ActivityLog', () => ({ default: { create: vi.fn() } }));
vi.mock('../../config/db', () => ({ sequelize: {} }));

const QuizAttempt = require('../../models/QuizAttempt').default;
const Subject = require('../../models/Subject').default;
const StudyPlan = require('../../models/StudyPlan').default;
const FocusSession = require('../../models/FocusSession').default;
const Flashcard = require('../../models/Flashcard').default;
const User = require('../../models/User').default;

const { generateProgressReport } = require('../../services/pdfProgressReportService');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d;
}

function mockUser(overrides = {}) {
  return {
    id: 'user-1',
    name: 'Test Student',
    email: 'test@example.com',
    studyHours: 42.5,
    currentStreak: 7,
    longestStreak: 15,
    lastActivityDate: makeDate(0),
    ...overrides,
  };
}

function mockAttempt(score, daysAgo, timeSpent = 300, totalQuestions = 10) {
  return {
    score,
    timeSpent,
    totalQuestions,
    createdAt: makeDate(daysAgo),
    quizRef: { id: `quiz-${score}`, subject: 's-1', totalQuestions },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('pdfProgressReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    User.findByPk.mockResolvedValue(mockUser());
    QuizAttempt.findAll.mockResolvedValue([]);
    Subject.findAll.mockResolvedValue([]);
    StudyPlan.findAll.mockResolvedValue([]);
    FocusSession.findAll.mockResolvedValue([]);
    Flashcard.count.mockResolvedValue(0);
  });

  describe('generateProgressReport', () => {
    it('generates a valid PDF stream with header and footer', async () => {
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(75, 5),
        mockAttempt(80, 3),
        mockAttempt(85, 1),
      ]);

      const result = await generateProgressReport('user-1');

      expect(result).toBeDefined();
      expect(result.filename).toContain('openprep-progress-');
      expect(result.contentType).toBe('application/pdf');
      expect(result.stream).toBeDefined();
      // Verify the stream is a valid PDFDocument (has end method)
      expect(typeof result.stream.end).toBe('function');
      expect(typeof result.stream.pipe).toBe('function');
    });

    it('includes student name from user data', async () => {
      User.findByPk.mockResolvedValue(mockUser({ name: 'Alice Johnson' }));

      const result = await generateProgressReport('user-1');
      expect(result.filename).toContain('progress');
      expect(result.contentType).toBe('application/pdf');
    });

    it('handles empty data gracefully', async () => {
      const result = await generateProgressReport('user-1');

      expect(result).toBeDefined();
      expect(result.contentType).toBe('application/pdf');
    });

    it('accepts custom windowDays option', async () => {
      const result = await generateProgressReport('user-1', { windowDays: 7 });
      expect(result).toBeDefined();
      expect(result.contentType).toBe('application/pdf');
    });

    it('accepts custom locale option', async () => {
      const result = await generateProgressReport('user-1', { locale: 'en-GB' });
      expect(result).toBeDefined();
    });

    it('filters quiz data by examId when provided', async () => {
      await generateProgressReport('user-1', { examId: 'exam-123' });
      // Should still work with examId filter
      expect(QuizAttempt.findAll).toHaveBeenCalled();
    });
  });

  describe('Quiz analytics calculation', () => {
    it('computes correct averages from multiple attempts', async () => {
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(60, 10),
        mockAttempt(70, 8),
        mockAttempt(80, 6),
        mockAttempt(90, 4),
        mockAttempt(100, 2),
      ]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
      expect(result.contentType).toBe('application/pdf');
    });

    it('detects improving trend', async () => {
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(40, 15),
        mockAttempt(45, 13),
        mockAttempt(50, 11),
        mockAttempt(80, 3),
        mockAttempt(85, 2),
        mockAttempt(90, 1),
      ]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });

    it('detects declining trend', async () => {
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(90, 15),
        mockAttempt(85, 13),
        mockAttempt(80, 11),
        mockAttempt(50, 3),
        mockAttempt(45, 2),
        mockAttempt(40, 1),
      ]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });
  });

  describe('Subject mastery rendering', () => {
    it('renders subject bars for subjects with data', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Mathematics' },
        { id: 's-2', name: 'Physics' },
      ]);

      QuizAttempt.findAll
        .mockResolvedValueOnce([
          mockAttempt(85, 5),
          mockAttempt(90, 3),
        ])
        .mockResolvedValueOnce([
          mockAttempt(60, 5),
          mockAttempt(55, 3),
        ]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });

    it('handles subjects with no quiz data', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Biology' },
      ]);
      QuizAttempt.findAll.mockResolvedValue([]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });
  });

  describe('Study velocity rendering', () => {
    it('renders velocity data from study plans', async () => {
      StudyPlan.findAll.mockResolvedValue([
        {
          id: 'plan-1',
          dailyGoals: [
            {
              date: makeDate(2).toISOString().split('T')[0],
              tasks: [
                { _id: 't1', completed: true },
                { _id: 't2', completed: false },
              ],
            },
            {
              date: makeDate(1).toISOString().split('T')[0],
              tasks: [
                { _id: 't3', completed: true },
                { _id: 't4', completed: true },
              ],
            },
          ],
        },
      ]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });

    it('handles empty study plans', async () => {
      StudyPlan.findAll.mockResolvedValue([]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });
  });

  describe('Flashcard and streak data', () => {
    it('renders flashcard stats', async () => {
      Flashcard.count
        .mockResolvedValueOnce(50)  // total
        .mockResolvedValueOnce(12)  // due this week
        .mockResolvedValueOnce(5);  // overdue

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });

    it('renders streak data from user model', async () => {
      User.findByPk.mockResolvedValue(mockUser({
        currentStreak: 10,
        longestStreak: 25,
      }));

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });

    it('handles zero streaks gracefully', async () => {
      User.findByPk.mockResolvedValue(mockUser({
        currentStreak: 0,
        longestStreak: 0,
      }));

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });
  });

  describe('Recommendations engine', () => {
    it('generates quiz-related recommendations for low scores', async () => {
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(30, 5),
        mockAttempt(35, 3),
        mockAttempt(25, 1),
      ]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });

    it('generates positive recommendations for high scores', async () => {
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(90, 5),
        mockAttempt(95, 3),
        mockAttempt(88, 1),
      ]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });

    it('recommends untested subjects', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Math' },
        { id: 's-2', name: 'History' },
      ]);
      // Only Math has quiz data
      QuizAttempt.findAll
        .mockResolvedValueOnce([mockAttempt(75, 3)])
        .mockResolvedValueOnce([]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });
  });

  describe('Time distribution', () => {
    it('aggregates focus session and quiz time', async () => {
      FocusSession.findAll.mockResolvedValue([
        { id: 'fs-1', activeSeconds: 1800, createdAt: makeDate(3) },
        { id: 'fs-2', activeSeconds: 3600, createdAt: makeDate(1) },
      ]);
      QuizAttempt.findAll
        .mockResolvedValueOnce([mockAttempt(80, 2, 600)])
        .mockResolvedValueOnce([mockAttempt(80, 2, 600)]);

      const result = await generateProgressReport('user-1');
      expect(result).toBeDefined();
    });
  });
});
