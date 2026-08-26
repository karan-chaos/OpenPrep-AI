const { expect, describe, it, vi, beforeEach } = require('vitest');

/**
 * Unit tests for WeaknessAdaptiveQuizService.
 *
 * Models are mocked so the analysis logic and quiz generation
 * orchestration can be tested without a real database.
 */

vi.mock('../../models/QuizAttempt', () => ({ default: { findAll: vi.fn() } }));
vi.mock('../../models/Quiz', () => ({ default: { create: vi.fn(), findAll: vi.fn() } }));
vi.mock('../../models/Subject', () => ({ default: { findAll: vi.fn() } }));
vi.mock('../../models/Topic', () => ({ default: { findAll: vi.fn() } }));
vi.mock('../../models/Note', () => ({ default: { findAll: vi.fn() } }));
vi.mock('../../models/ActivityLog', () => ({ default: { create: vi.fn() } }));
vi.mock('../../models/Flashcard', () => ({ default: { count: vi.fn() } }));
vi.mock('../../models/User', () => ({ default: { findByPk: vi.fn() } }));
vi.mock('../../config/db', () => ({ sequelize: {} }));

vi.mock('../../services/geminiService', () => ({
  generateQuiz: vi.fn(),
  GeminiRateLimitError: class GeminiRateLimitError extends Error {},
  GeminiServerError: class GeminiServerError extends Error {},
}));

const QuizAttempt = require('../../models/QuizAttempt').default;
const Quiz = require('../../models/Quiz').default;
const Subject = require('../../models/Subject').default;
const Topic = require('../../models/Topic').default;
const Note = require('../../models/Note').default;
const geminiService = require('../../services/geminiService');

const weaknessAdaptiveQuizService = require('../../services/weaknessAdaptiveQuizService');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d;
}

function mockAttempt(score, daysAgo, topicId = 't-1', answers = []) {
  return {
    id: `attempt-${score}-${daysAgo}`,
    score,
    createdAt: makeDate(daysAgo),
    answers: answers.length > 0 ? answers : [
      { questionId: 'q-1', isCorrect: score >= 50, selectedAnswer: 0 },
      { questionId: 'q-2', isCorrect: score >= 70, selectedAnswer: 1 },
    ],
    quizRef: { id: `quiz-${score}`, subject: 's-1', topic: topicId, totalQuestions: 10 },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WeaknessAdaptiveQuizService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyzeWeaknessProfile', () => {
    it('returns empty profile when no subjects exist', async () => {
      Subject.findAll.mockResolvedValue([]);

      const result = await weaknessAdaptiveQuizService.analyzeWeaknessProfile('user-1');

      expect(result.subjects).toEqual([]);
      expect(result.summary.totalSubjects).toBe(0);
    });

    it('marks subjects with no attempts as maximum weakness', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Physics', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([
        { id: 't-1', name: 'Mechanics', status: null },
      ]);
      QuizAttempt.findAll.mockResolvedValue([]);

      const result = await weaknessAdaptiveQuizService.analyzeWeaknessProfile('user-1');

      expect(result.subjects).toHaveLength(1);
      expect(result.subjects[0].topics[0].weaknessScore).toBe(1.0);
      expect(result.subjects[0].topics[0].recommendedAction).toBe('start_practice');
    });

    it('computes low weakness for consistently high scores', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Math', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([
        { id: 't-1', name: 'Algebra', status: null },
      ]);
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(90, 10, 't-1'),
        mockAttempt(95, 8, 't-1'),
        mockAttempt(88, 5, 't-1'),
        mockAttempt(92, 3, 't-1'),
        mockAttempt(91, 1, 't-1'),
      ]);

      const result = await weaknessAdaptiveQuizService.analyzeWeaknessProfile('user-1');

      expect(result.subjects[0].topics[0].weaknessScore).toBeLessThan(0.3);
      expect(result.subjects[0].topics[0].currentStatus).toBe('mastered');
    });

    it('detects improving trend when recent scores are higher', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Chemistry', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([
        { id: 't-1', name: 'Organic', status: null },
      ]);
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(40, 20, 't-1'),
        mockAttempt(42, 18, 't-1'),
        mockAttempt(38, 16, 't-1'),
        mockAttempt(70, 3, 't-1'),
        mockAttempt(75, 2, 't-1'),
        mockAttempt(80, 1, 't-1'),
      ]);

      const result = await weaknessAdaptiveQuizService.analyzeWeaknessProfile('user-1');

      expect(result.subjects[0].topics[0].trend).toBe('improving');
    });

    it('detects declining trend when recent scores drop', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Biology', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([
        { id: 't-1', name: 'Genetics', status: null },
      ]);
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(90, 20, 't-1'),
        mockAttempt(88, 18, 't-1'),
        mockAttempt(85, 16, 't-1'),
        mockAttempt(50, 3, 't-1'),
        mockAttempt(45, 2, 't-1'),
        mockAttempt(40, 1, 't-1'),
      ]);

      const result = await weaknessAdaptiveQuizService.analyzeWeaknessProfile('user-1');

      expect(result.subjects[0].topics[0].trend).toBe('declining');
    });

    it('sorts subjects by weakness score descending', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Math', exam: 'e-1', user: 'user-1' },
        { id: 's-2', name: 'Physics', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll
        .mockResolvedValueOnce([{ id: 't-1', name: 'Algebra' }]) // Math
        .mockResolvedValueOnce([{ id: 't-2', name: 'Mechanics' }]); // Physics

      // Math: high scores (low weakness)
      QuizAttempt.findAll
        .mockResolvedValueOnce([
          mockAttempt(90, 5, 't-1'),
          mockAttempt(95, 3, 't-1'),
        ])
        // Physics: low scores (high weakness)
        .mockResolvedValueOnce([
          mockAttempt(30, 5, 't-2'),
          mockAttempt(25, 3, 't-2'),
        ]);

      const result = await weaknessAdaptiveQuizService.analyzeWeaknessProfile('user-1');

      expect(result.subjects[0].subjectName).toBe('Physics');
      expect(result.subjects[1].subjectName).toBe('Math');
    });

    it('filters by examId when provided', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Math', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([{ id: 't-1', name: 'Algebra' }]);
      QuizAttempt.findAll.mockResolvedValue([]);

      await weaknessAdaptiveQuizService.analyzeWeaknessProfile('user-1', { examId: 'e-1' });

      expect(Subject.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ exam: 'e-1' }) })
      );
    });
  });

  describe('generateAdaptiveQuiz', () => {
    it('generates a quiz targeting weak topics', async () => {
      // Setup profile with weak topic
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Math', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([
        { id: 't-1', name: 'Algebra', status: null },
      ]);
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(25, 5, 't-1'),
        mockAttempt(30, 3, 't-1'),
      ]);
      Note.findAll.mockResolvedValue([]);

      geminiService.generateQuiz.mockResolvedValue({
        title: 'Adaptive Algebra Quiz',
        questions: [
          {
            questionText: 'What is 2+2?',
            options: ['3', '4', '5', '6'],
            correctAnswer: 1,
            explanation: 'Basic addition',
          },
        ],
      });

      Quiz.create.mockResolvedValue({ id: 'new-quiz' });

      const result = await weaknessAdaptiveQuizService.generateAdaptiveQuiz('user-1', {
        count: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.weaknessContext).toBeDefined();
      expect(result.weaknessContext.targetTopics.length).toBeGreaterThan(0);
      expect(geminiService.generateQuiz).toHaveBeenCalled();
    });

    it('returns failure when no weak topics exist', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Math', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([
        { id: 't-1', name: 'Algebra', status: null },
      ]);
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(95, 5, 't-1'),
        mockAttempt(92, 3, 't-1'),
        mockAttempt(98, 1, 't-1'),
      ]);

      const result = await weaknessAdaptiveQuizService.generateAdaptiveQuiz('user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No weak topics');
    });

    it('clamps quiz count to valid range', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Math', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([
        { id: 't-1', name: 'Algebra' },
      ]);
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(20, 5, 't-1'),
        mockAttempt(15, 3, 't-1'),
      ]);
      Note.findAll.mockResolvedValue([]);

      geminiService.generateQuiz.mockResolvedValue({
        title: 'Quiz',
        questions: Array.from({ length: 30 }, (_, i) => ({
          questionText: `Q${i}`,
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 0,
        })),
      });
      Quiz.create.mockResolvedValue({ id: 'q-1' });

      const result = await weaknessAdaptiveQuizService.generateAdaptiveQuiz('user-1', {
        count: 100, // Should be clamped to 30
      });

      expect(result.success).toBe(true);
      const callArgs = geminiService.generateQuiz.mock.calls[0];
      expect(callArgs[3]).toBe(30); // clamped count
    });

    it('filters by subjectId when provided', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Math', exam: 'e-1', user: 'user-1' },
        { id: 's-2', name: 'Physics', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll
        .mockResolvedValueOnce([{ id: 't-1', name: 'Algebra' }])
        .mockResolvedValueOnce([{ id: 't-2', name: 'Mechanics' }]);

      // Math is weak
      QuizAttempt.findAll
        .mockResolvedValueOnce([mockAttempt(30, 5, 't-1')])
        // Physics is strong
        .mockResolvedValueOnce([
          mockAttempt(90, 5, 't-2'),
          mockAttempt(95, 3, 't-2'),
        ]);

      Note.findAll.mockResolvedValue([]);
      geminiService.generateQuiz.mockResolvedValue({
        title: 'Quiz',
        questions: [{ questionText: 'Q1', options: ['A', 'B'], correctAnswer: 0 }],
      });
      Quiz.create.mockResolvedValue({ id: 'q-1' });

      const result = await weaknessAdaptiveQuizService.generateAdaptiveQuiz('user-1', {
        subjectId: 's-1',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('getStudyRecommendations', () => {
    it('generates high-priority recommendations for weak topics', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Math', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([
        { id: 't-1', name: 'Algebra', status: null },
      ]);
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(25, 5, 't-1'),
        mockAttempt(30, 3, 't-1'),
      ]);

      const result = await weaknessAdaptiveQuizService.getStudyRecommendations('user-1');

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.totalHighPriority).toBeGreaterThan(0);
    });

    it('detects declining trend recommendations', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Physics', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([
        { id: 't-1', name: 'Optics', status: null },
      ]);
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(90, 20, 't-1'),
        mockAttempt(85, 18, 't-1'),
        mockAttempt(80, 16, 't-1'),
        mockAttempt(50, 3, 't-1'),
        mockAttempt(45, 2, 't-1'),
        mockAttempt(40, 1, 't-1'),
      ]);

      const result = await weaknessAdaptiveQuizService.getStudyRecommendations('user-1');

      const declining = result.recommendations.find((r) => r.type === 'trend_alert');
      expect(declining).toBeDefined();
      expect(declining.topics[0].trend).toBe('declining');
    });

    it('sorts recommendations by priority', async () => {
      Subject.findAll.mockResolvedValue([
        { id: 's-1', name: 'Chem', exam: 'e-1', user: 'user-1' },
      ]);
      Topic.findAll.mockResolvedValue([
        { id: 't-1', name: 'Organic', status: null },
      ]);
      QuizAttempt.findAll.mockResolvedValue([
        mockAttempt(20, 5, 't-1'),
      ]);

      const result = await weaknessAdaptiveQuizService.getStudyRecommendations('user-1');

      if (result.recommendations.length > 1) {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        for (let i = 1; i < result.recommendations.length; i++) {
          expect(priorityOrder[result.recommendations[i].priority]).toBeGreaterThanOrEqual(
            priorityOrder[result.recommendations[i - 1].priority]
          );
        }
      }
    });
  });

  describe('Private helper methods', () => {
    it('_computeRecencyWeightedScore weights recent attempts higher', () => {
      const attempts = [
        { score: 50, createdAt: makeDate(20) },
        { score: 90, createdAt: makeDate(1) },
      ];

      const result = weaknessAdaptiveQuizService._computeRecencyWeightedScore(attempts);
      // 90 (recent) should pull the weighted average above 70
      expect(result).toBeGreaterThan(70);
    });

    it('_computeRecencyWeightedScore returns 0 for empty array', () => {
      expect(weaknessAdaptiveQuizService._computeRecencyWeightedScore([])).toBe(0);
    });

    it('_computeQuestionAccuracy counts correct answers', () => {
      const attempts = [
        { answers: [{ isCorrect: true }, { isCorrect: false }] },
        { answers: [{ isCorrect: true }, { isCorrect: true }] },
      ];

      const result = weaknessAdaptiveQuizService._computeQuestionAccuracy(attempts);
      expect(result.totalQuestions).toBe(4);
      expect(result.correctAnswers).toBe(3);
    });

    it('_detectTrend returns insufficient_data for fewer than 4 attempts', () => {
      const attempts = [
        { score: 80, createdAt: makeDate(5) },
        { score: 85, createdAt: makeDate(3) },
      ];

      expect(weaknessAdaptiveQuizService._detectTrend(attempts)).toBe('insufficient_data');
    });

    it('_determineAction returns correct actions for different scenarios', () => {
      expect(weaknessAdaptiveQuizService._determineAction(0.8, 'stable', 5)).toBe('intensive_review');
      expect(weaknessAdaptiveQuizService._determineAction(0.6, 'stable', 5)).toBe('targeted_practice');
      expect(weaknessAdaptiveQuizService._determineAction(0.4, 'declining', 5)).toBe('reinforcement');
      expect(weaknessAdaptiveQuizService._determineAction(0.2, 'stable', 5)).toBe('maintenance');
      expect(weaknessAdaptiveQuizService._determineAction(0.5, 'stable', 0)).toBe('start_practice');
    });

    it('_getCoverageLevel returns correct levels', () => {
      expect(weaknessAdaptiveQuizService._getCoverageLevel(85)).toBe('mastered');
      expect(weaknessAdaptiveQuizService._getCoverageLevel(60)).toBe('developing');
      expect(weaknessAdaptiveQuizService._getCoverageLevel(30)).toBe('needs_attention');
    });

    it('_generateSummary computes correct totals', () => {
      const profile = [
        {
          subjectName: 'Math',
          topics: [
            { weaknessScore: 0.8, attemptCount: 2 },
            { weaknessScore: 0.2, attemptCount: 5 },
          ],
        },
        {
          subjectName: 'Physics',
          topics: [
            { weaknessScore: 1.0, attemptCount: 0 },
          ],
        },
      ];

      const result = weaknessAdaptiveQuizService._generateSummary(profile);
      expect(result.totalSubjects).toBe(2);
      expect(result.totalTopics).toBe(3);
      expect(result.weakTopics).toBe(2);
      expect(result.strongTopics).toBe(1);
      expect(result.untestedTopics).toBe(1);
    });

    it('_computeWeaknessScore clamps to 0-1 range', () => {
      expect(weaknessAdaptiveQuizService._computeWeaknessScore(0, 0, 10)).toBeGreaterThanOrEqual(0);
      expect(weaknessAdaptiveQuizService._computeWeaknessScore(0, 0, 10)).toBeLessThanOrEqual(1);
      expect(weaknessAdaptiveQuizService._computeWeaknessScore(100, 100, 10)).toBeGreaterThanOrEqual(0);
      expect(weaknessAdaptiveQuizService._computeWeaknessScore(100, 100, 10)).toBeLessThanOrEqual(1);
    });
  });
});
