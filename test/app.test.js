/**
 * Basic API tests for public endpoints.
 * Supabase is mocked to avoid external calls in CI.
 */
const request = require('supertest');

// Mock Supabase before app loads (jest.mock is hoisted)
jest.mock('../src/config/supabase', () => {
  const mockFrom = () => ({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  });
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test-id', email: 'test@utexas.edu' } },
        error: null,
      }),
    },
    from: jest.fn(mockFrom),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
});

const app = require('../src/index');

describe('API', () => {
  describe('GET /', () => {
    it('returns VIA API message', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'VIA API' });
    });
  });

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });
});
