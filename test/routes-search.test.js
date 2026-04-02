/**
 * GET /api/v1/routes/search — matched vs nearby fallback.
 */
const request = require('supertest');

jest.mock('../src/config/supabase', () => ({
  auth: { getUser: jest.fn() },
  from: jest.fn(),
  rpc: jest.fn(),
}));

jest.mock('../src/services/routeList', () => ({
  ROUTE_LIST_SELECT: 'id',
  enrichRoutesForList: jest.fn(async (_supabase, routes) => ({
    items: (routes || []).map((r) => ({ ...r, enriched: true })),
  })),
  fetchNearbyRouteIds: jest.fn(),
}));

const supabase = require('../src/config/supabase');
const { fetchNearbyRouteIds } = require('../src/services/routeList');
const app = require('../src/index');

function buildInQuery(resolve) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => Promise.resolve(resolve())),
  };
  return builder;
}

describe('GET /api/v1/routes/search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns matched true when get_routes_between returns ids', async () => {
    supabase.rpc.mockResolvedValue({
      data: [{ id: 'route-a' }],
      error: null,
    });

    supabase.from.mockImplementation(() =>
      buildInQuery(() => ({
        data: [
          {
            id: 'route-a',
            title: 'Quick path',
            duration_seconds: 120,
          },
        ],
        error: null,
      })),
    );

    const res = await request(app).get('/api/v1/routes/search').query({
      from_lat: 30.284,
      from_lng: -97.734,
      to_lat: 30.286,
      to_lng: -97.731,
    });

    expect(res.status).toBe(200);
    expect(res.body.search.matched).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].id).toBe('route-a');
    expect(res.body.data[0].enriched).toBe(true);
    expect(fetchNearbyRouteIds).not.toHaveBeenCalled();
  });

  it('returns matched false and nearby fallback when no between matches', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });
    fetchNearbyRouteIds.mockResolvedValue({
      ids: ['near-1'],
      error: null,
    });

    supabase.from.mockImplementation(() =>
      buildInQuery(() => ({
        data: [{ id: 'near-1', title: 'Nearby only' }],
        error: null,
      })),
    );

    const res = await request(app).get('/api/v1/routes/search').query({
      from_lat: 30.284,
      from_lng: -97.734,
      to_lat: 30.286,
      to_lng: -97.731,
    });

    expect(res.status).toBe(200);
    expect(res.body.search.matched).toBe(false);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].id).toBe('near-1');
    expect(fetchNearbyRouteIds).toHaveBeenCalled();
  });

  it('returns 400 when query params are missing', async () => {
    const res = await request(app).get('/api/v1/routes/search').query({
      from_lat: 30.284,
    });
    expect(res.status).toBe(400);
  });
});
