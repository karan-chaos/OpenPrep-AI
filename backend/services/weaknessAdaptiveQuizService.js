const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const QuizAttempt = require('../models/QuizAttempt');
const Quiz = require('../models/Quiz');
const Subject = require('../models/Subject');
const Topic = require('../models/Topic');
const ActivityLog = require('../models/ActivityLog');
const geminiService = require('../services/geminiService');
const { GeminiRateLimitError, GeminiServerError } = require('../services/geminiService');

/**
 * WeaknessAdaptiveQuizService
 *
 * Analyzes a user's quiz history to identify knowledge gaps, computes
 * per-topic weakness scores, and generates targeted quizzes that focus
 * on the weakest areas. Integrates with the Gemini AI service for
 * question generation.
 */

// ── Constants ──────────────────────────────────────────────────────────────

const WEAKNESS_THRESHOLD = 50;       // Below this score = weak
const STRONG_THRESHOLD = 80;         // Above this score = strong
const MAX_WEAK_TOPICS = 5;           // Max topics to target per quiz
const DEFAULT_QUIZ_SIZE = 10;
const MIN_QUIZ_SIZE = 3;
const MAX_QUIZ_SIZE = 30;
const DECAY_WINDOW_DAYS = 30;        // How far back to look for attempts
const RECENCY_WEIGHT = 0.7;          // Weight for recent vs older attempts

// ── Core Service ───────────────────────────────────────────────────────────

class WeaknessAdaptiveQuizService {
  /**
   * Analyze a user's weakness profile across all subjects.
   *
   * @param {string} userId
   * @param {Object} [options]
   * @param {string} [options.examId]    Filter to a specific exam
   * @returns {Promise<Object>}          Full weakness analysis
   */
  async analyzeWeaknessProfile(userId, { examId } = {}) {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - DECAY_WINDOW_DAYS);

    const subjectWhere = { user: userId };
    if (examId) subjectWhere.exam = examId;

    const subjects = await Subject.findAll({ where: subjectWhere });
    const profile = [];

    for (const subject of subjects) {
      // Get all topics for this subject
      const topics = await Topic.findAll({
        where: { subject: subject.id, user: userId },
        attributes: ['id', 'name', 'status'],
      });

      // Get quiz attempts for this subject
      const attempts = await QuizAttempt.findAll({
        where: { user: userId },
        include: [{
          model: Quiz,
          as: 'quizRef',
          where: { subject: subject.id },
          attributes: ['id', 'topic', 'totalQuestions'],
        }],
        attributes: ['id', 'score', 'createdAt', 'answers'],
        order: [['createdAt', 'DESC']],
      });

      const topicAnalysis = [];

      for (const topic of topics) {
        // Find attempts linked to this topic
        const topicAttempts = attempts.filter(
          (a) => String(a.quizRef?.topic) === String(topic.id)
        );

        // If no topic-specific attempts, use subject-level data
        const relevantAttempts = topicAttempts.length > 0 ? topicAttempts : attempts;

        if (relevantAttempts.length === 0) {
          topicAnalysis.push({
            topicId: topic.id,
            topicName: topic.name,
            currentStatus: topic.status || 'untested',
            averageScore: 0,
            attemptCount: 0,
            weaknessScore: 1.0, // Maximum weakness = no data
            trend: 'unknown',
            lastAttemptDate: null,
            questionAccuracy: 0,
            recommendedAction: 'start_practice',
          });
          continue;
        }

        // Compute weighted average score (recent attempts weighted more)
        const weightedScore = this._computeRecencyWeightedScore(relevantAttempts);
        const rawAverage = relevantAttempts.reduce((s, a) => s + (a.score || 0), 0) / relevantAttempts.length;

        // Compute question-level accuracy
        const { totalQuestions, correctAnswers } = this._computeQuestionAccuracy(relevantAttempts);
        const questionAccuracy = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;

        // Determine weakness score (0 = strong, 1 = very weak)
        const weaknessScore = this._computeWeaknessScore(weightedScore, questionAccuracy, relevantAttempts.length);

        // Detect trend
        const trend = this._detectTrend(relevantAttempts);

        // Determine recommended action
        const recommendedAction = this._determineAction(weaknessScore, trend, relevantAttempts.length);

        // Determine coverage level
        const coverageLevel = this._getCoverageLevel(weightedScore);

        topicAnalysis.push({
          topicId: topic.id,
          topicName: topic.name,
          currentStatus: coverageLevel,
          averageScore: Math.round(rawAverage),
          weightedScore: Math.round(weightedScore),
          attemptCount: relevantAttempts.length,
          weaknessScore: Number(weaknessScore.toFixed(3)),
          trend,
          lastAttemptDate: relevantAttempts[0]?.createdAt || null,
          questionAccuracy,
          recommendedAction,
        });
      }

      // Sort by weakness score descending (weakest first)
      topicAnalysis.sort((a, b) => b.weaknessScore - a.weaknessScore);

      const subjectWeakness = this._computeSubjectWeakness(topicAnalysis);

      profile.push({
        subjectId: subject.id,
        subjectName: subject.name,
        examId: subject.exam,
        overallWeakness: subjectWeakness,
        topicCount: topics.length,
        totalAttempts: attempts.length,
        topics: topicAnalysis,
      });
    }

    // Sort subjects by overall weakness descending
    profile.sort((a, b) => b.overallWeakness - a.overallWeakness);

    return {
      userId,
      generatedAt: new Date().toISOString(),
      windowDays: DECAY_WINDOW_DAYS,
      subjects: profile,
      summary: this._generateSummary(profile),
    };
  }

  /**
   * Generate a weakness-adaptive quiz targeting the weakest topics.
   *
   * @param {string} userId
   * @param {Object} options
   * @param {string}  [options.subjectId]   Target specific subject
   * @param {string}  [options.examId]      Filter by exam
   * @param {number}  [options.count]       Number of questions
   * @param {string}  [options.language]    Quiz language
   * @returns {Promise<Object>}             Generated quiz with weakness context
   */
  async generateAdaptiveQuiz(userId, options = {}) {
    const {
      subjectId,
      examId,
      count = DEFAULT_QUIZ_SIZE,
      language = 'english',
    } = options;

    const clampedCount = Math.max(MIN_QUIZ_SIZE, Math.min(MAX_QUIZ_SIZE, count));

    // 1. Get weakness profile
    const profile = await this.analyzeWeaknessProfile(userId, { examId });

    // 2. Find the weakest topics
    let weakTopics = [];
    for (const subject of profile.subjects) {
      if (subjectId && subject.subjectId !== subjectId) continue;

      for (const topic of subject.topics) {
        if (topic.weaknessScore >= 0.3 && topic.weaknessScore <= 1.0) {
          weakTopics.push({
            ...topic,
            subjectId: subject.subjectId,
            subjectName: subject.subjectName,
          });
        }
      }
    }

    // Sort by weakness score descending
    weakTopics.sort((a, b) => b.weaknessScore - a.weaknessScore);

    // Limit to max weak topics
    weakTopics = weakTopics.slice(0, MAX_WEAK_TOPICS);

    if (weakTopics.length === 0) {
      return {
        success: false,
        error: 'No weak topics identified. Your performance is strong across all subjects!',
        profile: profile.summary,
        recommendation: 'Try increasing difficulty or taking comprehensive review quizzes.',
      };
    }

    // 3. Get notes context for the weak topics
    const Note = require('../models/Note');
    const topicIds = weakTopics.map((t) => t.topicId);
    const notes = await Note.findAll({
      where: {
        user: userId,
        [Op.or]: [
          { topic: { [Op.in]: topicIds } },
          { subject: { [Op.in]: weakTopics.map((t) => t.subjectId) } },
        ],
      },
      attributes: ['id', 'title', 'content', 'topic', 'subject'],
      limit: 10,
    });

    // Build notes context (condensed)
    const notesText = notes
      .map((n) => `[${n.title}] ${n.content || ''}`)
      .join('\n')
      .slice(0, 5000);

    // 4. Build the target subject/topic list for AI
    const targetAreas = weakTopics.map((t) => ({
      subject: t.subjectName,
      topic: t.topicName,
      weaknessScore: t.weaknessScore,
      averageScore: t.averageScore,
      recommendation: t.recommendedAction,
    }));

    // 5. Call Gemini to generate targeted questions
    const primaryTopic = weakTopics[0];
    const difficultyLevel = primaryTopic.averageScore < 30 ? 'Easy'
      : primaryTopic.averageScore < 60 ? 'Medium' : 'Hard';

    let aiQuiz;
    try {
      aiQuiz = await geminiService.generateQuiz(
        primaryTopic.subjectName,
        primaryTopic.topicName,
        notesText,
        clampedCount,
        false, // forceRefresh
        language,
        difficultyLevel,
        'MCQ'
      );
    } catch (error) {
      if (error instanceof GeminiRateLimitError) {
        throw error;
      }
      if (error instanceof GeminiServerError) {
        throw error;
      }
      throw error;
    }

    // 6. Assign IDs and create the quiz
    const questionsWithIds = (aiQuiz.questions || []).map((q) => {
      let normalizedCorrectAnswer = q.correctAnswer;
      if (Array.isArray(normalizedCorrectAnswer)) {
        normalizedCorrectAnswer = normalizedCorrectAnswer.length > 0 ? normalizedCorrectAnswer[0] : null;
      }
      if (typeof normalizedCorrectAnswer === 'string' && !isNaN(normalizedCorrectAnswer) && normalizedCorrectAnswer.trim() !== '') {
        normalizedCorrectAnswer = parseInt(normalizedCorrectAnswer, 10);
      }

      return {
        _id: uuidv4(),
        questionType: 'MCQ',
        questionText: q.questionText,
        options: q.options || [],
        correctAnswer: normalizedCorrectAnswer !== undefined ? normalizedCorrectAnswer : null,
        explanation: q.explanation || '',
      };
    });

    const quiz = await Quiz.create({
      title: aiQuiz.title || `Weakness-Adaptive Quiz: ${primaryTopic.topicName}`,
      subject: primaryTopic.subjectId,
      topic: primaryTopic.topicId,
      questions: questionsWithIds,
      type: 'AI_Generated',
      sourceType: 'WEAKNESS_ADAPTIVE',
      language: language || 'english',
      createdBy: userId,
      timeLimit: clampedCount * 2, // 2 minutes per question
    });

    // 7. Log activity
    await ActivityLog.create({
      user: userId,
      activityType: 'quiz_generate',
      description: `Generated weakness-adaptive quiz targeting ${weakTopics.length} weak topic(s) in ${primaryTopic.subjectName}`,
    });

    return {
      success: true,
      data: quiz,
      weaknessContext: {
        targetTopics: targetAreas,
        quizDifficulty: difficultyLevel,
        totalWeakTopics: weakTopics.length,
        weakestTopic: {
          name: primaryTopic.topicName,
          subject: primaryTopic.subjectName,
          weaknessScore: primaryTopic.weaknessScore,
          averageScore: primaryTopic.averageScore,
        },
      },
      profileSummary: profile.summary,
    };
  }

  /**
   * Get weakness-based study recommendations.
   *
   * @param {string} userId
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async getStudyRecommendations(userId, options = {}) {
    const profile = await this.analyzeWeaknessProfile(userId, options);

    const recommendations = [];

    for (const subject of profile.subjects) {
      const weakTopics = subject.topics.filter((t) => t.weaknessScore >= 0.5);
      const improvingTopics = subject.topics.filter((t) => t.trend === 'improving');
      const decliningTopics = subject.topics.filter((t) => t.trend === 'declining');

      if (weakTopics.length > 0) {
        recommendations.push({
          type: 'priority_review',
          priority: 'high',
          subject: subject.subjectName,
          topics: weakTopics.map((t) => ({
            name: t.topicName,
            score: t.averageScore,
            weakness: t.weaknessScore,
            action: t.recommendedAction,
          })),
          message: `Focus on ${weakTopics.length} weak topic(s) in ${subject.subjectName}`,
        });
      }

      if (decliningTopics.length > 0) {
        recommendations.push({
          type: 'trend_alert',
          priority: 'medium',
          subject: subject.subjectName,
          topics: decliningTopics.map((t) => ({
            name: t.topicName,
            trend: t.trend,
            score: t.averageScore,
          })),
          message: `Scores are declining in ${decliningTopics.map((t) => t.topicName).join(', ')}`,
        });
      }

      if (improvingTopics.length > 0) {
        recommendations.push({
          type: 'positive_reinforcement',
          priority: 'low',
          subject: subject.subjectName,
          topics: improvingTopics.map((t) => ({
            name: t.topicName,
            score: t.averageScore,
          })),
          message: `Great improvement in ${improvingTopics.map((t) => t.topicName).join(', ')}!`,
        });
      }
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return {
      userId,
      generatedAt: new Date().toISOString(),
      recommendations,
      totalHighPriority: recommendations.filter((r) => r.priority === 'high').length,
      totalMediumPriority: recommendations.filter((r) => r.priority === 'medium').length,
      totalLowPriority: recommendations.filter((r) => r.priority === 'low').length,
      summary: profile.summary,
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  _computeRecencyWeightedScore(attempts) {
    if (attempts.length === 0) return 0;

    const sorted = [...attempts].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    let weightedSum = 0;
    let weightTotal = 0;

    sorted.forEach((attempt, idx) => {
      const weight = Math.pow(RECENCY_WEIGHT, idx);
      weightedSum += (attempt.score || 0) * weight;
      weightTotal += weight;
    });

    return weightedSum / weightTotal;
  }

  _computeQuestionAccuracy(attempts) {
    let totalQuestions = 0;
    let correctAnswers = 0;

    for (const attempt of attempts) {
      const answers = attempt.answers || [];
      totalQuestions += answers.length;
      correctAnswers += answers.filter((a) => a.isCorrect).length;
    }

    return { totalQuestions, correctAnswers };
  }

  _computeWeaknessScore(weightedScore, questionAccuracy, attemptCount) {
    // Base weakness from score (0-1 scale, higher = weaker)
    const scoreWeakness = 1 - Math.min(weightedScore / 100, 1);

    // Accuracy penalty
    const accuracyPenalty = questionAccuracy > 0 ? (1 - questionAccuracy / 100) * 0.3 : 0;

    // Confidence factor: more attempts = more confident in the weakness score
    const confidenceFactor = Math.min(attemptCount / 5, 1);

    // Combined weakness score
    const rawScore = scoreWeakness * 0.6 + accuracyPenalty + (1 - confidenceFactor) * 0.1;

    return Math.max(0, Math.min(1, rawScore));
  }

  _detectTrend(attempts) {
    if (attempts.length < 4) return 'insufficient_data';

    // Split into recent and prior halves
    const sorted = [...attempts].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    const half = Math.floor(sorted.length / 2);
    const recent = sorted.slice(0, half);
    const prior = sorted.slice(half);

    const recentAvg = recent.reduce((s, a) => s + (a.score || 0), 0) / recent.length;
    const priorAvg = prior.reduce((s, a) => s + (a.score || 0), 0) / prior.length;

    const delta = recentAvg - priorAvg;

    if (delta > 5) return 'improving';
    if (delta < -5) return 'declining';
    return 'stable';
  }

  _determineAction(weaknessScore, trend, attemptCount) {
    if (attemptCount === 0) return 'start_practice';
    if (weaknessScore >= 0.7) return 'intensive_review';
    if (weaknessScore >= 0.5) return 'targeted_practice';
    if (trend === 'declining') return 'reinforcement';
    if (weaknessScore < 0.3) return 'maintenance';
    return 'continued_practice';
  }

  _getCoverageLevel(score) {
    if (score >= STRONG_THRESHOLD) return 'mastered';
    if (score >= WEAKNESS_THRESHOLD) return 'developing';
    return 'needs_attention';
  }

  _computeSubjectWeakness(topicAnalysis) {
    if (topicAnalysis.length === 0) return 0;
    return topicAnalysis.reduce((s, t) => s + t.weaknessScore, 0) / topicAnalysis.length;
  }

  _generateSummary(profile) {
    let totalTopics = 0;
    let weakTopics = 0;
    let strongTopics = 0;
    let untestedTopics = 0;

    for (const subject of profile) {
      for (const topic of subject.topics) {
        totalTopics++;
        if (topic.weaknessScore >= 0.7) weakTopics++;
        else if (topic.weaknessScore < 0.3) strongTopics++;
        if (topic.attemptCount === 0) untestedTopics++;
      }
    }

    return {
      totalSubjects: profile.length,
      totalTopics,
      weakTopics,
      strongTopics,
      untestedTopics,
      overallReadiness: totalTopics > 0
        ? Math.round(((strongTopics + (totalTopics - weakTopics - strongTopics) * 0.5) / totalTopics) * 100)
        : 0,
    };
  }
}

module.exports = new WeaknessAdaptiveQuizService();
