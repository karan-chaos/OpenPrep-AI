const { Op } = require('sequelize');
const PDFDocument = require('pdfkit');
const QuizAttempt = require('../models/QuizAttempt');
const Quiz = require('../models/Quiz');
const Subject = require('../models/Subject');
const Topic = require('../models/Topic');
const StudyPlan = require('../models/StudyPlan');
const FocusSession = require('../models/FocusSession');
const Flashcard = require('../models/Flashcard');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');

// ── Color palette ──────────────────────────────────────────────────────────

const COLORS = {
  primary: '#1a365d',
  secondary: '#2b6cb0',
  accent: '#ed8936',
  success: '#276749',
  warning: '#c05621',
  danger: '#c53030',
  text: '#2d3748',
  muted: '#718096',
  light: '#e2e8f0',
  bg: '#f7fafc',
  white: '#ffffff',
};

// ── Main generation function ───────────────────────────────────────────────

/**
 * Generate a one-page PDF progress report for a student.
 *
 * @param {string} userId
 * @param {Object} [options]
 * @param {string} [options.windowDays]     Analysis window
 * @param {string} [options.examId]         Optional exam scope
 * @param {string} [options.locale]         Locale for date formatting
 * @returns {Promise<Object>}               { stream, filename, contentType }
 */
async function generateProgressReport(userId, options = {}) {
  const {
    windowDays = 30,
    examId,
    locale = 'en-US',
  } = options;

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - windowDays);

  // Gather all analytics data in parallel
  const [
    user,
    quizData,
    subjectData,
    velocityData,
    timeData,
    streakData,
    flashcardData,
  ] = await Promise.all([
    User.findByPk(userId, { attributes: ['id', 'name', 'email', 'studyHours', 'currentStreak', 'longestStreak'] }),
    getQuizAnalytics(userId, windowStart, examId),
    getSubjectMastery(userId, examId),
    getStudyVelocity(userId, windowStart),
    getTimeDistribution(userId, windowStart),
    getStreakInfo(userId),
    getFlashcardStats(userId, examId),
  ]);

  const userName = user?.name || 'Student';
  const reportDate = new Date().toLocaleDateString(locale, {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Create PDF document
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    bufferPages: true,
    info: {
      Title: `Progress Report - ${userName}`,
      Author: 'OpenPrep AI',
      Subject: 'Study Progress Report',
      CreationDate: new Date(),
    },
  });

  // ── Header ───────────────────────────────────────────────────────────
  drawHeader(doc, userName, reportDate, windowDays);

  // ── Overview stats row ───────────────────────────────────────────────
  drawOverviewStats(doc, quizData, velocityData, streakData, timeData);

  // ── Quiz Performance section ─────────────────────────────────────────
  drawQuizSection(doc, quizData, windowDays);

  // ── Subject Mastery bars ─────────────────────────────────────────────
  drawSubjectMastery(doc, subjectData);

  // ── Study Velocity sparkline ─────────────────────────────────────────
  drawVelocityChart(doc, velocityData);

  // ── Streak & Flashcards ──────────────────────────────────────────────
  drawStreakAndFlashcards(doc, streakData, flashcardData);

  // ── Recommendations ──────────────────────────────────────────────────
  drawRecommendations(doc, quizData, subjectData, velocityData, streakData);

  // ── Footer ───────────────────────────────────────────────────────────
  drawFooter(doc);

  return {
    stream: doc,
    filename: `openprep-progress-${new Date().toISOString().split('T')[0]}.pdf`,
    contentType: 'application/pdf',
  };
}

// ── Data gathering functions ───────────────────────────────────────────────

async function getQuizAnalytics(userId, windowStart, examId) {
  const where = { user: userId, createdAt: { [Op.gte]: windowStart } };

  const attempts = await QuizAttempt.findAll({
    where,
    include: [{
      model: Quiz,
      as: 'quizRef',
      attributes: ['id', 'subject', 'topic', 'totalQuestions'],
      ...(examId ? {} : {}),
    }],
    order: [['createdAt', 'ASC']],
  });

  if (attempts.length === 0) {
    return {
      totalAttempts: 0,
      averageScore: 0,
      medianScore: 0,
      bestScore: 0,
      worstScore: 0,
      trend: 'unknown',
      trendDelta: 0,
      totalQuestions: 0,
      correctAnswers: 0,
      accuracy: 0,
      avgTimePerAttempt: 0,
      dailyScores: [],
    };
  }

  const scores = attempts.map(a => a.score || 0);
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  // Trend
  const half = Math.floor(scores.length / 2);
  const firstHalf = scores.slice(0, half);
  const secondHalf = scores.slice(half);
  const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / (firstHalf.length || 1);
  const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / (secondHalf.length || 1);
  const trendDelta = secondAvg - firstAvg;
  const trend = trendDelta > 2 ? 'improving' : trendDelta < -2 ? 'declining' : 'stable';

  // Accuracy
  const totalQ = attempts.reduce((s, a) => s + (a.totalQuestions || 0), 0);
  const correct = attempts.reduce((s, a) => s + Math.round(((a.score || 0) / 100) * (a.totalQuestions || 0)), 0);

  // Time
  const times = attempts.map(a => a.timeSpent || 0).filter(t => t > 0);
  const avgTime = times.length ? times.reduce((s, v) => s + v, 0) / times.length : 0;

  // Daily scores
  const dailyMap = {};
  for (const a of attempts) {
    const d = a.createdAt.toISOString().split('T')[0];
    if (!dailyMap[d]) dailyMap[d] = [];
    dailyMap[d].push(a.score || 0);
  }
  const dailyScores = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, s]) => ({
      date,
      avg: Math.round(s.reduce((x, y) => x + y, 0) / s.length),
    }));

  return {
    totalAttempts: attempts.length,
    averageScore: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
    medianScore: Math.round(median),
    bestScore: Math.max(...scores),
    worstScore: Math.min(...scores),
    trend,
    trendDelta: Math.round(trendDelta * 10) / 10,
    totalQuestions: totalQ,
    correctAnswers: correct,
    accuracy: totalQ > 0 ? Math.round((correct / totalQ) * 100) : 0,
    avgTimePerAttempt: Math.round(avgTime),
    dailyScores,
  };
}

async function getSubjectMastery(userId, examId) {
  const subjectWhere = { user: userId };
  if (examId) subjectWhere.exam = examId;

  const subjects = await Subject.findAll({ where: subjectWhere });
  const results = [];

  for (const subject of subjects) {
    const attempts = await QuizAttempt.findAll({
      where: { user: userId },
      include: [{
        model: Quiz,
        as: 'quizRef',
        where: { subject: subject.id },
        attributes: ['id'],
      }],
      attributes: ['score', 'createdAt'],
    });

    if (attempts.length === 0) {
      results.push({
        name: subject.name,
        score: 0,
        attempts: 0,
        level: 'not_started',
      });
      continue;
    }

    const avg = attempts.reduce((s, a) => s + (a.score || 0), 0) / attempts.length;
    const level = avg >= 80 ? 'mastered' : avg >= 60 ? 'proficient' : avg >= 40 ? 'developing' : 'needs_attention';

    results.push({
      name: subject.name,
      score: Math.round(avg),
      attempts: attempts.length,
      level,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

async function getStudyVelocity(userId, windowStart) {
  const plans = await StudyPlan.findAll({ where: { user: userId }, attributes: ['id', 'dailyGoals'] });
  const startDateStr = windowStart.toISOString().split('T')[0];
  let completed = 0;
  let planned = 0;
  const dailyData = {};

  for (const plan of plans) {
    for (const goal of (plan.dailyGoals || [])) {
      const dateStr = typeof goal.date === 'string' ? goal.date : goal.date?.toISOString?.()?.split('T')[0];
      if (!dateStr || dateStr < startDateStr) continue;
      for (const task of (goal.tasks || [])) {
        planned++;
        if (task.completed) completed++;
        if (!dailyData[dateStr]) dailyData[dateStr] = { completed: 0, planned: 0 };
        dailyData[dateStr].planned++;
        if (task.completed) dailyData[dateStr].completed++;
      }
    }
  }

  const activeDays = Object.values(dailyData).filter(d => d.completed > 0).length;
  const totalDays = Math.max(1, Math.ceil((Date.now() - windowStart.getTime()) / 86400000));

  return {
    totalPlanned: planned,
    totalCompleted: completed,
    completionRate: planned > 0 ? Math.round((completed / planned) * 100) : 0,
    activeDays,
    tasksPerDay: activeDays > 0 ? Math.round((completed / activeDays) * 10) / 10 : 0,
    consistency: Math.round((activeDays / totalDays) * 100),
    dailyData: Object.entries(dailyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, ...d })),
  };
}

async function getTimeDistribution(userId, windowStart) {
  const focusSessions = await FocusSession.findAll({
    where: { user: userId, createdAt: { [Op.gte]: windowStart } },
    attributes: ['id', 'activeSeconds', 'createdAt'],
  });

  const quizAttempts = await QuizAttempt.findAll({
    where: { user: userId, createdAt: { [Op.gte]: windowStart } },
    attributes: ['id', 'timeSpent', 'createdAt'],
  });

  const focusMinutes = focusSessions.reduce((s, f) => s + Math.round((f.activeSeconds || 0) / 60), 0);
  const quizMinutes = quizAttempts.reduce((s, a) => s + Math.round((a.timeSpent || 0) / 60), 0);

  return {
    focusMinutes,
    quizMinutes,
    totalMinutes: focusMinutes + quizMinutes,
    totalHours: Math.round((focusMinutes + quizMinutes) / 60 * 10) / 10,
    sessionCount: focusSessions.length + quizAttempts.length,
  };
}

async function getStreakInfo(userId) {
  const user = await User.findByPk(userId, {
    attributes: ['id', 'currentStreak', 'longestStreak', 'lastActivityDate'],
  });

  return {
    current: user?.currentStreak || 0,
    longest: user?.longestStreak || 0,
    lastActive: user?.lastActivityDate || null,
  };
}

async function getFlashcardStats(userId, examId) {
  const where = { user: userId };
  if (examId) where.subject = examId;

  const total = await Flashcard.count({ where });
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const dueThisWeek = await Flashcard.count({
    where: { ...where, nextReviewDate: { [Op.and]: [{ [Op.gte]: now }, { [Op.lte]: weekEnd }] } },
  });

  const overdue = await Flashcard.count({
    where: { ...where, nextReviewDate: { [Op.lt]: now } },
  });

  return { total, dueThisWeek, overdue };
}

// ── PDF Drawing functions ──────────────────────────────────────────────────

function drawHeader(doc, userName, reportDate, windowDays) {
  // Background bar
  doc.rect(0, 0, 595, 80).fill(COLORS.primary);

  // Title
  doc.fontSize(22).fillColor(COLORS.white).font('Helvetica-Bold')
    .text('OpenPrep AI — Progress Report', 40, 22, { width: 400 });

  // Subtitle
  doc.fontSize(11).fillColor('#bee3f8').font('Helvetica')
    .text(`Student: ${userName}  •  Period: Last ${windowDays} days  •  Generated: ${reportDate}`, 40, 52, { width: 500 });
}

function drawOverviewStats(doc, quiz, velocity, streak, time) {
  const y = 95;

  const stats = [
    { label: 'Avg Score', value: `${quiz.averageScore}%`, color: quiz.averageScore >= 70 ? COLORS.success : quiz.averageScore >= 50 ? COLORS.accent : COLORS.danger },
    { label: 'Quizzes', value: `${quiz.totalAttempts}`, color: COLORS.secondary },
    { label: 'Tasks Done', value: `${velocity.totalCompleted}`, color: COLORS.success },
    { label: 'Study Hours', value: `${time.totalHours}h`, color: COLORS.secondary },
    { label: 'Streak', value: `${streak.current}d`, color: streak.current >= 5 ? COLORS.success : COLORS.accent },
    { label: 'Accuracy', value: `${quiz.accuracy}%`, color: quiz.accuracy >= 70 ? COLORS.success : COLORS.warning },
  ];

  const boxWidth = 80;
  const gap = 10;
  const startX = 40;

  stats.forEach((stat, i) => {
    const x = startX + i * (boxWidth + gap);
    // Box
    doc.roundedRect(x, y, boxWidth, 48, 4).fill(COLORS.bg);
    // Value
    doc.fontSize(18).fillColor(stat.color).font('Helvetica-Bold')
      .text(stat.value, x, y + 8, { width: boxWidth, align: 'center' });
    // Label
    doc.fontSize(8).fillColor(COLORS.muted).font('Helvetica')
      .text(stat.label, x, y + 32, { width: boxWidth, align: 'center' });
  });
}

function drawQuizSection(doc, quiz, windowDays) {
  const y = 160;

  sectionTitle(doc, 'Quiz Performance', y);

  if (quiz.totalAttempts === 0) {
    doc.fontSize(9).fillColor(COLORS.muted).font('Helvetica')
      .text('No quiz data available for this period.', 40, y + 18);
    return y + 40;
  }

  const startY = y + 18;

  // Left column: stats
  const items = [
    `Average Score: ${quiz.averageScore}%`,
    `Median Score: ${quiz.medianScore}%`,
    `Best Score: ${quiz.bestScore}%`,
    `Lowest Score: ${quiz.worstScore}%`,
    `Trend: ${quiz.trend === 'improving' ? '↑' : quiz.trend === 'declining' ? '↓' : '→'} ${Math.abs(quiz.trendDelta)}% ${quiz.trend}`,
    `Questions Answered: ${quiz.totalQuestions}`,
  ];

  doc.fontSize(9).fillColor(COLORS.text).font('Helvetica');
  items.forEach((item, i) => {
    doc.text(`• ${item}`, 40, startY + i * 14, { width: 250 });
  });

  // Right column: daily score sparkline (text-based)
  if (quiz.dailyScores.length > 0) {
    const sparkX = 310;
    const sparkY = startY;
    doc.fontSize(9).fillColor(COLORS.secondary).font('Helvetica-Bold')
      .text('Daily Score Trend', sparkX, sparkY);

    const maxScores = quiz.dailyScores.slice(-14); // last 14 days max
    doc.fontSize(8).fillColor(COLORS.muted).font('Helvetica');
    maxScores.forEach((ds, i) => {
      if (i >= 8) return; // max 8 bars to fit
      const barY = sparkY + 16 + i * 12;
      const barWidth = Math.round((ds.avg / 100) * 180);
      const barColor = ds.avg >= 70 ? COLORS.success : ds.avg >= 50 ? COLORS.accent : COLORS.danger;

      doc.text(ds.date.slice(5), sparkX, barY, { width: 35 });
      doc.roundedRect(sparkX + 38, barY + 1, barWidth, 8, 2).fill(barColor);
      doc.fontSize(7).fillColor(COLORS.white).font('Helvetica-Bold')
        .text(`${ds.avg}%`, sparkX + 42 + barWidth, barY + 1);
    });
  }

  return startY + 100;
}

function drawSubjectMastery(doc, subjects) {
  const y = 285;

  sectionTitle(doc, 'Subject Mastery', y);

  if (subjects.length === 0) {
    doc.fontSize(9).fillColor(COLORS.muted).font('Helvetica')
      .text('No subject data available.', 40, y + 18);
    return y + 40;
  }

  const startY = y + 18;
  const maxBarWidth = 200;
  const maxSubjects = Math.min(subjects.length, 8);

  subjects.slice(0, maxSubjects).forEach((sub, i) => {
    const itemY = startY + i * 16;

    // Name
    doc.fontSize(8).fillColor(COLORS.text).font('Helvetica')
      .text(sub.name, 40, itemY, { width: 100 });

    // Bar background
    doc.roundedRect(145, itemY + 2, maxBarWidth, 8, 2).fill(COLORS.light);

    // Bar fill
    const fillWidth = Math.round((sub.score / 100) * maxBarWidth);
    const barColor = sub.level === 'mastered' ? COLORS.success
      : sub.level === 'proficient' ? COLORS.secondary
        : sub.level === 'developing' ? COLORS.accent
          : COLORS.danger;
    if (fillWidth > 0) {
      doc.roundedRect(145, itemY + 2, fillWidth, 8, 2).fill(barColor);
    }

    // Score label
    doc.fontSize(8).fillColor(COLORS.muted).font('Helvetica')
      .text(`${sub.score}% (${sub.attempts} quizzes)`, 350, itemY, { width: 150 });
  });

  return startY + maxSubjects * 16 + 10;
}

function drawVelocityChart(doc, velocity) {
  const y = 430;

  sectionTitle(doc, 'Study Velocity', y);

  if (velocity.totalPlanned === 0) {
    doc.fontSize(9).fillColor(COLORS.muted).font('Helvetica')
      .text('No study plan tasks recorded.', 40, y + 18);
    return y + 40;
  }

  const startY = y + 18;

  const items = [
    `Completion Rate: ${velocity.completionRate}%`,
    `Tasks/Day: ${velocity.tasksPerDay}`,
    `Active Study Days: ${velocity.activeDays}`,
    `Consistency: ${velocity.consistency}%`,
    `${velocity.totalCompleted} / ${velocity.totalPlanned} tasks completed`,
  ];

  doc.fontSize(9).fillColor(COLORS.text).font('Helvetica');
  items.forEach((item, i) => {
    doc.text(`• ${item}`, 40, startY + i * 14, { width: 300 });
  });

  // Progress bar for completion
  const barY = startY + items.length * 14 + 8;
  doc.roundedRect(40, barY, 300, 12, 3).fill(COLORS.light);
  const fillW = Math.round((velocity.completionRate / 100) * 300);
  const barColor = velocity.completionRate >= 70 ? COLORS.success : velocity.completionRate >= 40 ? COLORS.accent : COLORS.danger;
  if (fillW > 0) {
    doc.roundedRect(40, barY, fillW, 12, 3).fill(barColor);
  }
  doc.fontSize(8).fillColor(COLORS.white).font('Helvetica-Bold')
    .text(`${velocity.completionRate}%`, 45, barY + 2);

  return barY + 25;
}

function drawStreakAndFlashcards(doc, streak, flashcards) {
  const y = 520;

  sectionTitle(doc, 'Streak & Flashcards', y);

  const startY = y + 18;

  // Streak
  doc.fontSize(9).fillColor(COLORS.text).font('Helvetica');
  doc.text(`🔥 Current Streak: ${streak.current} day${streak.current !== 1 ? 's' : ''}`, 40, startY, { width: 250 });
  doc.text(`⭐ Longest Streak: ${streak.longest} day${streak.longest !== 1 ? 's' : ''}`, 40, startY + 14, { width: 250 });

  // Flashcards
  doc.text(`📚 Total Flashcards: ${flashcards.total}`, 310, startY, { width: 200 });
  doc.text(`📅 Due This Week: ${flashcards.dueThisWeek}`, 310, startY + 14, { width: 200 });
  doc.text(`⚠️ Overdue: ${flashcards.overdue}`, 310, startY + 28, { width: 200 });

  return startY + 45;
}

function drawRecommendations(doc, quiz, subjects, velocity, streak) {
  const y = 585;

  sectionTitle(doc, 'Recommendations', y);

  const recommendations = generateRecommendations(quiz, subjects, velocity, streak);

  doc.fontSize(8).fillColor(COLORS.text).font('Helvetica');
  recommendations.forEach((rec, i) => {
    if (i >= 4) return; // Max 4 recommendations
    doc.text(`→ ${rec}`, 40, y + 18 + i * 13, { width: 500 });
  });
}

function drawFooter(doc) {
  const y = 720;
  doc.fontSize(7).fillColor(COLORS.muted).font('Helvetica')
    .text('Generated by OpenPrep AI Learning Platform • For personal study use only', 40, y, {
      width: 515, align: 'center',
    });
}

function sectionTitle(doc, title, y) {
  doc.fontSize(11).fillColor(COLORS.primary).font('Helvetica-Bold')
    .text(title, 40, y);
  doc.moveTo(40, y + 14).lineTo(555, y + 14).strokeColor(COLORS.light).lineWidth(1).stroke();
}

function generateRecommendations(quiz, subjects, velocity, streak) {
  const recs = [];

  // Quiz-based
  if (quiz.totalAttempts === 0) {
    recs.push('Start taking quizzes to build a performance baseline.');
  } else if (quiz.trend === 'declining') {
    recs.push('Your scores are declining — review weak topics and take more practice quizzes.');
  } else if (quiz.averageScore < 50) {
    recs.push('Focus on fundamentals: revisit core concepts before advancing to harder material.');
  } else if (quiz.averageScore >= 80) {
    recs.push('Great scores! Challenge yourself with harder quizzes or focus on speed.');
  }

  // Subject-based
  const weakest = subjects.find(s => s.score > 0 && s.score < 50);
  if (weakest) {
    recs.push(`Priority: Spend more time on "${weakest.name}" (${weakest.score}% mastery).`);
  }

  const untested = subjects.filter(s => s.attempts === 0);
  if (untested.length > 0) {
    recs.push(`Take quizzes for untested subjects: ${untested.map(s => s.name).join(', ')}.`);
  }

  // Velocity-based
  if (velocity.completionRate < 30 && velocity.totalPlanned > 0) {
    recs.push('Low task completion — break study goals into smaller, achievable chunks.');
  } else if (velocity.consistency < 30) {
    recs.push('Study more consistently — aim for at least 30 minutes every day.');
  }

  // Streak-based
  if (streak.current === 0) {
    recs.push('Start a study streak today — even 15 minutes counts!');
  } else if (streak.current >= 7) {
    recs.push(`Amazing ${streak.current}-day streak! Keep the momentum going.`);
  }

  if (recs.length === 0) {
    recs.push('You\'re on a great track. Keep practicing and stay consistent!');
  }

  return recs;
}

module.exports = { generateProgressReport };
