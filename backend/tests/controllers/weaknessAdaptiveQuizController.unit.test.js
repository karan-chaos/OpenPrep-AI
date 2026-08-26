const { expect, describe, it, vi, beforeEach } = require('vitest');

/**
 * Unit tests for weaknessAdaptiveQuizController.
 */

vi.mock('../../services/weaknessAdaptiveQuizService', () => ({
  default: {
    analyzeWeaknessProfile: vi.fn(),
    generateAdaptiveQuiz: vi.fn(),
    getStudyRecommendations: vi.fn(),
  },
}));

vi.mock('../../services/geminiService', () => ({
  GeminiRateLimitError: class GeminiRateLimitError extends Error {},
  GeminiServerError: class GeminiServerError extends Error {},
}));

vi.mock('../../models/ActivityLog', () => ({ default: { create: vi.fn() } }));

const weaknessAdaptiveQuizService = require('../../services/weaknessAdaptiveQuizService').default;
const {
  getWeaknessProfile,
  generateAdaptiveQuiz,
  getStudyRecommendations,
  _generateProgressInsight,
} = require('../../controllers/weaknessAdaptiveQuizController');

// ── Helpers ────────────────────────────────────────────────────────────────

function mockReq(overrides = {}) {
  return {
    user: { id: 'user-1', name: 'Test User' },
    query: {},
    params: {},
    body: {},
    headers: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockNext() {
  return vi.fn();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('weaknessAdaptiveQuizController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWeaknessProfile', () => {
    it('returns profile data', async () => {
      const profile = { subjects: [], summary: { totalSubjects: 0 } };
      weaknessAdaptiveQuizService.analyzeWeaknessProfile.mockResolvedValue(profile);

      const req = mockReq({ query: {} });
      const res = mockRes();
      const next = mockNext();

      await getWeaknessProfile(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: profile })
      );
    });

    it('passes examId filter', async () => {
      weaknessAdaptiveQuizService.analyzeWeaknessProfile.mockResolvedValue({});

      const req = mockReq({ query: { examId: 'exam-1' } });
      const res = mockRes();
      const next = mockNext();

      await getWeaknessProfile(req, res, next);

      expect(weaknessAdaptiveQuizService.analyzeWeaknessProfile).toHaveBeenCalledWith(
        'user-1',
        { examId: 'exam-1' }
      );
    });

    it('calls next on error', async () => {
      weaknessAdaptiveQuizService.analyzeWeaknessProfile.mockRejectedValue(new Error('DB error'));

      const req = mockReq({ query: {} });
      const res = mockRes();
      const next = mockNext();

      await getWeaknessProfile(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('generateAdaptiveQuiz', () => {
    it('returns 400 for invalid count', async () => {
      const req = mockReq({ body: { count: 100 } });
      const res = mockRes();
      const next = mockNext();

      await generateAdaptiveQuiz(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('generates quiz with valid inputs', async () => {
      weaknessAdaptiveQuizService.generateAdaptiveQuiz.mockResolvedValue({
        success: true,
        data: { id: 'quiz-1' },
        weaknessContext: { targetTopics: [] },
      });

      const req = mockReq({ body: { count: 10 } });
      const res = mockRes();
      const next = mockNext();

      await generateAdaptiveQuiz(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 200 when no weak topics found', async () => {
      weaknessAdaptiveQuizService.generateAdaptiveQuiz.mockResolvedValue({
        success: false,
        error: 'No weak topics identified',
      });

      const req = mockReq({ body: {} });
      const res = mockRes();
      const next = mockNext();

      await generateAdaptiveQuiz(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it('handles rate limit errors', async () => {
      const { GeminiRateLimitError } = require('../../services/geminiService');
      const error = new GeminiRateLimitError('Rate limited', 60);
      weaknessAdaptiveQuizService.generateAdaptiveQuiz.mockRejectedValue(error);

      const req = mockReq({ body: {} });
      const res = mockRes();
      const next = mockNext();

      await generateAdaptiveQuiz(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('handles server errors', async () => {
      const { GeminiServerError } = require('../../services/geminiService');
      const error = new GeminiServerError('Server error', 503);
      weaknessAdaptiveQuizService.generateAdaptiveQuiz.mockRejectedValue(error);

      const req = mockReq({ body: {} });
      const res = mockRes();
      const next = mockNext();

      await generateAdaptiveQuiz(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('passes all options to service', async () => {
      weaknessAdaptiveQuizService.generateAdaptiveQuiz.mockResolvedValue({
        success: true,
        data: {},
        weaknessContext: { targetTopics: [] },
      });

      const req = mockReq({
        body: { subjectId: 's-1', examId: 'e-1', count: 15, language: 'spanish' },
      });
      const res = mockRes();
      const next = mockNext();

      await generateAdaptiveQuiz(req, res, next);

      expect(weaknessAdaptiveQuizService.generateAdaptiveQuiz).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          subjectId: 's-1',
          examId: 'e-1',
          count: 15,
          language: 'spanish',
        })
      );
    });
  });

  describe('getStudyRecommendations', () => {
    it('returns recommendations', async () => {
      const recommendations = {
        recommendations: [
          { type: 'priority_review', priority: 'high', subject: 'Math', message: 'Focus on weak topics' },
        ],
        totalHighPriority: 1,
      };
      weaknessAdaptiveQuizService.getStudyRecommendations.mockResolvedValue(recommendations);

      const req = mockReq({ query: {} });
      const res = mockRes();
      const next = mockNext();

      await getStudyRecommendations(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: recommendations })
      );
    });

    it('calls next on error', async () => {
      weaknessAdaptiveQuizService.getStudyRecommendations.mockRejectedValue(new Error('fail'));

      const req = mockReq({ query: {} });
      const res = mockRes();
      const next = mockNext();

      await getStudyRecommendations(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('_generateProgressInsight', () => {
    it('generates insight for improving topics', () => {
      const improving = [{ topicName: 'Algebra' }, { topicName: 'Calculus' }];
      const declining = [];
      const summary = { weakTopics: 1 };

      const result = _generateProgressInsight(improving, declining, summary);

      expect(result).toContain('2 topic(s) are improving');
      expect(result).toContain('Algebra');
    });

    it('generates insight for declining topics', () => {
      const improving = [];
      const declining = [{ topicName: 'Physics' }];
      const summary = { weakTopics: 3 };

      const result = _generateProgressInsight(improving, declining, summary);

      expect(result).toContain('1 topic(s) need attention');
      expect(result).toContain('Physics');
      expect(result).toContain('3 weak topic(s)');
    });

    it('generates positive insight when stable', () => {
      const result = _generateProgressInsight([], [], { weakTopics: 0 });

      expect(result).toContain('stable');
      expect(result).toContain('Keep up');
    });
  });
});
