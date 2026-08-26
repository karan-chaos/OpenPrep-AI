const { expect, describe, it, vi, beforeEach } = require('vitest');

/**
 * Unit tests for pdfReportController.
 *
 * Service layer is mocked to exercise controller logic only.
 */

vi.mock('../../services/pdfProgressReportService', () => ({
  generateProgressReport: vi.fn(),
}));

vi.mock('../../models/ActivityLog', () => ({
  default: { create: vi.fn() },
}));

vi.mock('../../models/QuizAttempt', () => ({
  default: { findAll: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../models/Quiz', () => ({
  default: {},
}));

vi.mock('../../models/Subject', () => ({
  default: { findAll: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../models/StudyPlan', () => ({
  default: { findAll: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../models/FocusSession', () => ({
  default: { findAll: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../models/Flashcard', () => ({
  default: { count: vi.fn().mockResolvedValue(0) },
}));

vi.mock('../../models/User', () => ({
  default: { findByPk: vi.fn().mockResolvedValue(null) },
}));

const { generateProgressReport } = require('../../services/pdfProgressReportService').__viOriginal || require('../../services/pdfProgressReportService');

// We need to re-import after mocks are in place
const pdfReportService = require('../../services/pdfProgressReportService');
const {
  getProgressReportPdf,
  getProgressData,
} = require('../../controllers/pdfReportController');

// ── Helpers ────────────────────────────────────────────────────────────────

function mockReq(overrides = {}) {
  return {
    user: { id: 'user-1', name: 'Test User' },
    query: {},
    params: {},
    headers: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  // Mock stream.pipe
  res.pipe = vi.fn().mockReturnValue(res);
  return res;
}

function mockNext() {
  return vi.fn();
}

function mockStream() {
  return {
    pipe: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('pdfReportController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getProgressReportPdf', () => {
    it('returns 400 when windowDays is out of range', async () => {
      const req = mockReq({ query: { windowDays: '500' } });
      const res = mockRes();
      const next = mockNext();

      await getProgressReportPdf(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: expect.stringContaining('windowDays') })
      );
    });

    it('generates and streams a PDF with correct headers', async () => {
      const fakeStream = mockStream();
      pdfReportService.generateProgressReport.mockResolvedValue({
        stream: fakeStream,
        filename: 'openprep-progress-2026-08-27.pdf',
        contentType: 'application/pdf',
      });

      const req = mockReq({ query: { windowDays: '30' } });
      const res = mockRes();
      const next = mockNext();

      await getProgressReportPdf(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('openprep-progress-')
      );
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('uses default 30-day window when not specified', async () => {
      pdfReportService.generateProgressReport.mockResolvedValue({
        stream: mockStream(),
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });

      const req = mockReq({ query: {} });
      const res = mockRes();
      const next = mockNext();

      await getProgressReportPdf(req, res, next);

      expect(pdfReportService.generateProgressReport).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ windowDays: 30 })
      );
    });

    it('passes examId and locale to service', async () => {
      pdfReportService.generateProgressReport.mockResolvedValue({
        stream: mockStream(),
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });

      const req = mockReq({ query: { examId: 'exam-123', locale: 'de-DE', windowDays: '14' } });
      const res = mockRes();
      const next = mockNext();

      await getProgressReportPdf(req, res, next);

      expect(pdfReportService.generateProgressReport).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ examId: 'exam-123', locale: 'de-DE', windowDays: 14 })
      );
    });

    it('calls next(error) on service failure', async () => {
      pdfReportService.generateProgressReport.mockRejectedValue(new Error('PDF generation failed'));

      const req = mockReq({ query: {} });
      const res = mockRes();
      const next = mockNext();

      await getProgressReportPdf(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('accepts windowDays=1 as minimum', async () => {
      pdfReportService.generateProgressReport.mockResolvedValue({
        stream: mockStream(),
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });

      const req = mockReq({ query: { windowDays: '1' } });
      const res = mockRes();
      const next = mockNext();

      await getProgressReportPdf(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(400);
    });

    it('rejects windowDays=0', async () => {
      const req = mockReq({ query: { windowDays: '0' } });
      const res = mockRes();
      const next = mockNext();

      await getProgressReportPdf(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('getProgressData', () => {
    it('returns JSON progress data', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      const next = mockNext();

      await getProgressData(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            windowDays: 30,
            generatedAt: expect.any(String),
            user: expect.any(Object),
            quiz: expect.any(Object),
            subjects: expect.any(Array),
            velocity: expect.any(Object),
            time: expect.any(Object),
            flashcards: expect.any(Object),
          }),
        })
      );
    });

    it('uses default 30-day window', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      const next = mockNext();

      await getProgressData(req, res, next);

      const data = res.json.mock.calls[0][0].data;
      expect(data.windowDays).toBe(30);
    });

    it('accepts custom windowDays', async () => {
      const req = mockReq({ query: { windowDays: '7' } });
      const res = mockRes();
      const next = mockNext();

      await getProgressData(req, res, next);

      const data = res.json.mock.calls[0][0].data;
      expect(data.windowDays).toBe(7);
    });

    it('calls next(error) on failure', async () => {
      const User = require('../../models/User').default;
      User.findByPk.mockRejectedValue(new Error('DB error'));

      const req = mockReq({ query: {} });
      const res = mockRes();
      const next = mockNext();

      await getProgressData(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
