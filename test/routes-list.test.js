/**
 * GET /api/v1/routes — pagination (F8), filters, and validation.
 */
const request = require('supertest');

jest.mock('../src/config/supabase', () => ({
  auth: { getUser: jest.fn() },
  from: jest.fn(),
  rpc: jest.fn(),
}));

const supabase = require('../src/config/supabase');
const app = require('../src/index');

function buildQuery(table, resolveQuery) {
  const state = { table, filters: [] };
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn((field, value) => {
      state.filters.push({ field, value });
      return builder;
    }),
    in: jest.fn((field, value) => {
      state.filters.push({ field, value, op: 'in' });
      return builder;
    }),
    then: (onFulfilled, onRejected) =>
      resolveQuery({ ...state }).then(onFulfilled, onRejected),
  };
  return builder;
}

function listRouteRow(i) {
  const day = String(i).padStart(2, '0');
  return {
    id: `r-${i}`,
    creator_id: 'creator-1',
    title: `Route ${i}`,
    start_label: 'A',
    end_label: 'B',
    distance_meters: i * 100,
    created_at: `2024-01-${day}T12:00:00Z`,
    route_tags: [{ tags: { name: i % 2 === 0 ? 'shade' : 'quiet' } }],
    creator: null,
  };
}

describe('GET /api/v1/routes', () => {
  let queryHandlers;
  let rpcHandlers;

  beforeEach(() => {
    queryHandlers = {};
    rpcHandlers = {};

    supabase.from.mockImplementation((table) =>
      buildQuery(table, async (state) => {
        const handler = queryHandlers[table];
        if (!handler) {
          return { data: null, error: null };
        }
        return handler(state);
      }),
    );

    supabase.rpc.mockImplementation(async (name, args) => {
      const handler = rpcHandlers[name];
      if (!handler) {
        return { data: null, error: null };
      }
      return handler(args);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('defaults to limit 20 and offset 0, returns total and filters metadata', async () => {
    const rows = Array.from({ length: 25 }, (_, j) => listRouteRow(j + 1));
    queryHandlers.routes = async () => ({ data: rows, error: null });
    queryHandlers.votes = async () => ({ data: [], error: null });
    rpcHandlers.get_route_points_with_coords = async () => ({ data: [], error: null });

    const res = await request(app).get('/api/v1/routes').query({ sort: 'recent' });

    expect(res.status).toBe(200);
    expect(res.body.filters).toMatchObject({
      limit: 20,
      offset: 0,
      total: 25,
      sort: 'recent',
    });
    expect(res.body.count).toBe(20);
    expect(res.body.data).toHaveLength(20);
    // recent: newest first — Jan 25 > Jan 1
    expect(res.body.data[0].id).toBe('r-25');
  });

  it('applies custom limit and offset after sort', async () => {
    const rows = Array.from({ length: 25 }, (_, j) => listRouteRow(j + 1));
    queryHandlers.routes = async () => ({ data: rows, error: null });
    queryHandlers.votes = async () => ({ data: [], error: null });
    rpcHandlers.get_route_points_with_coords = async () => ({ data: [], error: null });

    const res = await request(app)
      .get('/api/v1/routes')
      .query({ sort: 'recent', limit: 10, offset: 20 });

    expect(res.status).toBe(200);
    expect(res.body.filters.total).toBe(25);
    expect(res.body.count).toBe(5);
    expect(res.body.data.map((r) => r.id)).toEqual(['r-5', 'r-4', 'r-3', 'r-2', 'r-1']);
  });

  it('paginates after tag filter so total reflects filtered set', async () => {
    const rows = Array.from({ length: 10 }, (_, j) => listRouteRow(j + 1));
    queryHandlers.routes = async () => ({ data: rows, error: null });
    queryHandlers.votes = async () => ({ data: [], error: null });
    rpcHandlers.get_route_points_with_coords = async () => ({ data: [], error: null });

    const res = await request(app)
      .get('/api/v1/routes')
      .query({ tags: 'shade', sort: 'recent', limit: 2, offset: 2 });

    expect(res.status).toBe(200);
    expect(res.body.filters.total).toBe(5);
    expect(res.body.count).toBe(2);
    expect(res.body.data.map((r) => r.id)).toEqual(['r-6', 'r-4']);
    expect(res.body.data.every((r) => r.tags.map((t) => t.toLowerCase()).includes('shade'))).toBe(
      true,
    );
  });

  it('rejects limit above 100', async () => {
    const res = await request(app).get('/api/v1/routes').query({ limit: 101 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('rejects negative offset', async () => {
    const res = await request(app).get('/api/v1/routes').query({ offset: -1 });
    expect(res.status).toBe(400);
  });
});
