/**
 * GET /api/v1/tags — public tag lookup list.
 */
const request = require('supertest');

const mockTagsRows = [
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'quiet', category: 'environment' },
  { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'shade', category: null },
];

jest.mock('../src/config/supabase', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn((table) => {
    if (table === 'tags') {
      const chain = {
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: mockTagsRows, error: null }),
      };
      return chain;
    }
    return {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  }),
  rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
}));

const supabase = require('../src/config/supabase');
const app = require('../src/index');

describe('GET /api/v1/tags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.from.mockImplementation((table) => {
      if (table === 'tags') {
        return {
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({ data: mockTagsRows, error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
  });

  it('returns 200 with tags ordered by name (mocked)', async () => {
    const res = await request(app).get('/api/v1/tags');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('quiet');
    expect(res.body[1].name).toBe('shade');
    expect(supabase.from).toHaveBeenCalledWith('tags');
  });

  it('returns 200 with an empty array when no tags exist', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'tags') {
        return {
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    const res = await request(app).get('/api/v1/tags');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 when Supabase returns an error', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'tags') {
        return {
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'permission denied for table tags' },
          }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    const res = await request(app).get('/api/v1/tags');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
    expect(res.body.message).toBe('permission denied for table tags');
  });
});
