const { generateProgressReport } = require('../services/pdfProgressReportService');
const ActivityLog = require('../models/ActivityLog');

/**
 * @desc    Generate and download a PDF progress report
 * @route   GET /api/reports/progress-pdf
 * @access  Private
 */
exports.getProgressReportPdf = async (req, res, next) => {
  try {
    const { windowDays, examId, locale } = req.query;
    const parsedWindow = windowDays ? parseInt(windowDays, 10) : 30;

    if (isNaN(parsedWindow) || parsedWindow < 1 || parsedWindow > 365) {
      return res.status(400).json({
        success: false,
        error: 'windowDays must be between 1 and 365',
      });
    }

    const { stream, filename, contentType } = await generateProgressReport(req.user.id, {
      windowDays: parsedWindow,
      examId,
      locale: locale || 'en-US',
    });

    // Log activity
    await ActivityLog.create({
      user: req.user.id,
      activityType: 'report_generate',
      description: `Generated PDF progress report (window: ${parsedWindow} days)`,
    });

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    stream.pipe(res);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get progress report data as JSON (for frontend charts)
 * @route   GET /api/reports/progress-data
 * @access  Private
 */
exports.getProgressData = async (req, res, next) => {
  try {
    const { windowDays, examId } = req.query;
    const parsedWindow = windowDays ? parseInt(windowDays, 10) : 30;

    const { Op } = require('sequelize');
    const QuizAttempt = require('../models/QuizAttempt');
    const Quiz = require('../models/Quiz');
    const Subject = require('../models/Subject');
    const StudyPlan = require('../models/StudyPlan');
    const FocusSession = require('../models/FocusSession');
    const Flashcard = require('../models/Flashcard');
    const User = require('../models/User');

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - parsedWindow);

    // Gather data
    const [user, attempts, subjects, plans, focusSessions, quizAttempts] = await Promise.all([
      User.findByPk(req.user.id, {
        attributes: ['id', 'name', 'currentStreak', 'longestStreak', 'studyHours'],
      }),
      QuizAttempt.findAll({
        where: { user: req.user.id, createdAt: { [Op.gte]: windowStart } },
        include: [{ model: Quiz, as: 'quizRef', attributes: ['id', 'subject', 'totalQuestions'] }],
        order: [['createdAt', 'ASC']],
      }),
      Subject.findAll({
        where: { user: req.user.id, ...(examId ? { exam: examId } : {}) },
        attributes: ['id', 'name'],
      }),
      StudyPlan.findAll({
        where: { user: req.user.id },
        attributes: ['id', 'dailyGoals'],
      }),
      FocusSession.findAll({
        where: { user: req.user.id, createdAt: { [Op.gte]: windowStart } },
        attributes: ['id', 'activeSeconds', 'createdAt'],
      }),
      QuizAttempt.findAll({
        where: { user: req.user.id, createdAt: { [Op.gte]: windowStart } },
        attributes: ['id', 'score', 'timeSpent', 'createdAt'],
      }),
    ]);

    // Quiz summary
    const scores = attempts.map(a => a.score || 0);
    const quizSummary = {
      totalAttempts: scores.length,
      averageScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0,
      bestScore: scores.length ? Math.max(...scores) : 0,
      scores,
    };

    // Subject mastery
    const subjectMastery = [];
    for (const sub of subjects) {
      const subAttempts = attempts.filter(a => a.quizRef?.subject === sub.id);
      const avg = subAttempts.length
        ? Math.round(subAttempts.reduce((s, a) => s + (a.score || 0), 0) / subAttempts.length)
        : 0;
      subjectMastery.push({ id: sub.id, name: sub.name, score: avg, attempts: subAttempts.length });
    }

    // Study velocity
    let completed = 0;
    let planned = 0;
    for (const plan of plans) {
      for (const goal of (plan.dailyGoals || [])) {
        for (const task of (goal.tasks || [])) {
          planned++;
          if (task.completed) completed++;
        }
      }
    }

    // Time
    const totalFocusMinutes = focusSessions.reduce((s, f) => s + Math.round((f.activeSeconds || 0) / 60), 0);
    const totalQuizMinutes = quizAttempts.reduce((s, a) => s + Math.round((a.timeSpent || 0) / 60), 0);

    // Flashcards
    const totalFlashcards = await Flashcard.count({ where: { user: req.user.id } });

    res.status(200).json({
      success: true,
      data: {
        windowDays: parsedWindow,
        generatedAt: new Date().toISOString(),
        user: {
          name: user?.name || 'Student',
          currentStreak: user?.currentStreak || 0,
          longestStreak: user?.longestStreak || 0,
          totalStudyHours: user?.studyHours || 0,
        },
        quiz: quizSummary,
        subjects: subjectMastery.sort((a, b) => b.score - a.score),
        velocity: {
          totalPlanned: planned,
          totalCompleted: completed,
          completionRate: planned > 0 ? Math.round((completed / planned) * 100) : 0,
        },
        time: {
          focusMinutes: totalFocusMinutes,
          quizMinutes: totalQuizMinutes,
          totalHours: Math.round((totalFocusMinutes + totalQuizMinutes) / 60 * 10) / 10,
        },
        flashcards: {
          total: totalFlashcards,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
