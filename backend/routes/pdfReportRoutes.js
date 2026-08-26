const express = require('express');
const { protect } = require('../middleware/auth');
const {
  getProgressReportPdf,
  getProgressData,
} = require('../controllers/pdfReportController');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Downloadable study progress reports and analytics data
 */

/**
 * @swagger
 * /api/reports/progress-pdf:
 *   get:
 *     summary: Download a one-page PDF progress report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: windowDays
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 30
 *         description: Analysis window in days
 *       - in: query
 *         name: examId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter report to a specific exam
 *       - in: query
 *         name: locale
 *         schema:
 *           type: string
 *           default: en-US
 *         description: Locale for date formatting
 *     responses:
 *       200:
 *         description: PDF file stream
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 */
router.get('/progress-pdf', protect, getProgressReportPdf);

/**
 * @swagger
 * /api/reports/progress-data:
 *   get:
 *     summary: Get progress report data as JSON for frontend charts
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: windowDays
 *         schema:
 *           type: integer
 *           default: 30
 *       - in: query
 *         name: examId
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Progress data payload
 */
router.get('/progress-data', protect, getProgressData);

module.exports = router;
