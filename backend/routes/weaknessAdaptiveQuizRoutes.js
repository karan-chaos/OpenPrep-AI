const express = require('express');
const { protect } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const {
  getWeaknessProfile,
  generateAdaptiveQuiz,
  getStudyRecommendations,
  getSubjectWeakness,
  getWeaknessProgress,
} = require('../controllers/weaknessAdaptiveQuizController');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Weakness-Adaptive Quiz
 *   description: AI-powered quiz generation targeting the user's weakest knowledge areas
 */

/**
 * @swagger
 * /api/weakness-adaptive/profile:
 *   get:
 *     summary: Get full weakness profile analysis across all subjects
 *     tags: [Weakness-Adaptive Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: examId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter analysis to a specific exam
 *     responses:
 *       200:
 *         description: Full weakness profile with per-topic scores
 *       401:
 *         description: Not authenticated
 */
router.get('/profile', protect, getWeaknessProfile);

/**
 * @swagger
 * /api/weakness-adaptive/generate:
 *   post:
 *     summary: Generate a weakness-adaptive quiz targeting the weakest topics
 *     tags: [Weakness-Adaptive Quiz]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subjectId:
 *                 type: string
 *                 format: uuid
 *               examId:
 *                 type: string
 *                 format: uuid
 *               count:
 *                 type: integer
 *                 minimum: 3
 *                 maximum: 30
 *                 default: 10
 *               language:
 *                 type: string
 *                 default: english
 *     responses:
 *       201:
 *         description: Adaptive quiz generated
 *       200:
 *         description: No weak topics found
 *       400:
 *         description: Validation error
 *       429:
 *         description: Rate limit exceeded
 *       503:
 *         description: AI service unavailable
 */
router.post('/generate', protect, aiLimiter, generateAdaptiveQuiz);

/**
 * @swagger
 * /api/weakness-adaptive/recommendations:
 *   get:
 *     summary: Get weakness-based study recommendations
 *     tags: [Weakness-Adaptive Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: examId
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Prioritized study recommendations
 */
router.get('/recommendations', protect, getStudyRecommendations);

/**
 * @swagger
 * /api/weakness-adaptive/subject/{subjectId}:
 *   get:
 *     summary: Get weakness details for a specific subject
 *     tags: [Weakness-Adaptive Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subjectId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Subject weakness breakdown
 *       404:
 *         description: Subject not found
 */
router.get('/subject/:subjectId', protect, getSubjectWeakness);

/**
 * @swagger
 * /api/weakness-adaptive/progress:
 *   get:
 *     summary: Get weakness progress comparison over time
 *     tags: [Weakness-Adaptive Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: examId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: periodDays
 *         schema:
 *           type: integer
 *           default: 30
 *     responses:
 *       200:
 *         description: Progress report with improving and declining topics
 */
router.get('/progress', protect, getWeaknessProgress);

module.exports = router;
