const weaknessAdaptiveQuizService = require('../services/weaknessAdaptiveQuizService');
const { GeminiRateLimitError, GeminiServerError } = require('../services/geminiService');

/**
 * @desc    Get full weakness profile analysis
 * @route   GET /api/weakness-adaptive/profile
 * @access  Private
 */
exports.getWeaknessProfile = async (req, res, next) => {
  try {
    const { examId } = req.query;
    const profile = await weaknessAdaptiveQuizService.analyzeWeaknessProfile(req.user.id, { examId });
    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Generate a weakness-adaptive quiz
 * @route   POST /api/weakness-adaptive/generate
 * @access  Private
 */
exports.generateAdaptiveQuiz = async (req, res, next) => {
  try {
    const { subjectId, examId, count, language } = req.body;

    if (count !== undefined && (count < 3 || count > 30)) {
      return res.status(400).json({
        success: false,
        error: 'count must be between 3 and 30',
      });
    }

    const result = await weaknessAdaptiveQuizService.generateAdaptiveQuiz(req.user.id, {
      subjectId,
      examId,
      count,
      language,
    });

    if (!result.success) {
      return res.status(200).json(result);
    }

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof GeminiRateLimitError) {
      return res.status(429).json({
        success: false,
        error: error.message,
        retryAfter: error.retryAfter,
      });
    }
    if (error instanceof GeminiServerError) {
      return res.status(503).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
};

/**
 * @desc    Get weakness-based study recommendations
 * @route   GET /api/weakness-adaptive/recommendations
 * @access  Private
 */
exports.getStudyRecommendations = async (req, res, next) => {
  try {
    const { examId } = req.query;
    const recommendations = await weaknessAdaptiveQuizService.getStudyRecommendations(
      req.user.id,
      { examId }
    );
    res.status(200).json({ success: true, data: recommendations });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get weakness summary for a specific subject
 * @route   GET /api/weakness-adaptive/subject/:subjectId
 * @access  Private
 */
exports.getSubjectWeakness = async (req, res, next) => {
  try {
    const profile = await weaknessAdaptiveQuizService.analyzeWeaknessProfile(req.user.id);

    const subject = profile.subjects.find(
      (s) => s.subjectId === req.params.subjectId
    );

    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found or has no data',
      });
    }

    res.status(200).json({ success: true, data: subject });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get weakness comparison between two time periods
 * @route   GET /api/weakness-adaptive/progress
 * @access  Private
 */
exports.getWeaknessProgress = async (req, res, next) => {
  try {
    const { examId, periodDays } = req.query;
    const parsedPeriod = periodDays ? parseInt(periodDays, 10) : 30;

    // Get current profile
    const currentProfile = await weaknessAdaptiveQuizService.analyzeWeaknessProfile(
      req.user.id,
      { examId }
    );

    // Build progress summary
    const topicProgress = [];
    for (const subject of currentProfile.subjects) {
      for (const topic of subject.topics) {
        topicProgress.push({
          subjectName: subject.subjectName,
          topicName: topic.topicName,
          currentScore: topic.averageScore,
          weaknessScore: topic.weaknessScore,
          trend: topic.trend,
          attemptCount: topic.attemptCount,
          lastAttemptDate: topic.lastAttemptDate,
        });
      }
    }

    // Sort by trend (improving first)
    const trendOrder = { improving: 0, stable: 1, declining: 2, unknown: 3, insufficient_data: 4 };
    topicProgress.sort((a, b) => (trendOrder[a.trend] || 4) - (trendOrder[b.trend] || 4));

    const improving = topicProgress.filter((t) => t.trend === 'improving');
    const declining = topicProgress.filter((t) => t.trend === 'declining');

    res.status(200).json({
      success: true,
      data: {
        periodDays: parsedPeriod,
        generatedAt: new Date().toISOString(),
        summary: currentProfile.summary,
        improving,
        declining,
        allTopics: topicProgress,
        insight: this._generateProgressInsight(improving, declining, currentProfile.summary),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── Helper ─────────────────────────────────────────────────────────────────

function _generateProgressInsight(improving, declining, summary) {
  const parts = [];

  if (improving.length > 0) {
    parts.push(`${improving.length} topic(s) are improving: ${improving.map((t) => t.topicName).join(', ')}`);
  }
  if (declining.length > 0) {
    parts.push(`${declining.length} topic(s) need attention: ${declining.map((t) => t.topicName).join(', ')}`);
  }
  if (summary.weakTopics > 0) {
    parts.push(`${summary.weakTopics} weak topic(s) remaining`);
  }
  if (parts.length === 0) {
    parts.push('Your performance is stable across all topics. Keep up the good work!');
  }

  return parts.join('. ') + '.';
}

exports._generateProgressInsight = _generateProgressInsight;
