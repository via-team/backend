const request = require('supertest');

jest.mock('../src/config/supabase', () => {
  const api = {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  };
  api.createUserClient = jest.fn(() => api);
  return api;
});

const supabase = require('../src/config/supabase');
const app = require('../src/index');

function buildQuery(table, resolveQuery) {
  const state = {
    table,
    operation: 'select',
    payload: undefined,
    filters: [],
    columns: undefined,
  };

  const builder = {
    select: jest.fn((columns) => {
      state.columns = columns;
      return builder;
    }),
    update: jest.fn((payload) => {
      state.operation = 'update';
      state.payload = payload;
      return builder;
    }),
    insert: jest.fn((payload) => {
      state.operation = 'insert';
      state.payload = payload;
      return builder;
    }),
    eq: jest.fn((field, value) => {
      state.filters.push({ field, value });
      return builder;
    }),
    single: jest.fn(() => resolveQuery({ ...state, expectsSingle: true })),
    then: (onFulfilled, onRejected) =>
      resolveQuery({ ...state, expectsSingle: false }).then(onFulfilled, onRejected),
    catch: (onRejected) => resolveQuery({ ...state, expectsSingle: false }).catch(onRejected),
  };

  return builder;
}

function baseRoute(overrides = {}) {
  return {
    id: 'route-1',
    creator_id: 'creator-1',
    title: 'Quiet path',
    description: 'Avoids Speedway.',
    start_label: 'Jester West',
    end_label: 'GDC',
    distance_meters: 820,
    duration_seconds: 900,
    start_time: '2023-10-27T10:00:00Z',
    end_time: '2023-10-27T10:15:00Z',
    created_at: '2023-10-27T10:15:00Z',
    is_active: true,
    route_tags: [{ tags: { name: 'shade' } }],
    ...overrides,
  };
}

describe('Route detail and update endpoints', () => {
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

    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'creator-1', email: 'creator@utexas.edu' } },
      error: null,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns route detail without a notes field (geo-notes use GET /routes/:id/notes)', async () => {
    queryHandlers.routes = async () => ({ data: baseRoute(), error: null });
    queryHandlers.votes = async () => ({ data: [{ vote_type: 'up' }, { vote_type: 'down' }], error: null });
    rpcHandlers.get_route_points_with_coords = async () => ({
      data: [{ sequence: 1, lat: 30.2849, lng: -97.7341, accuracy_meters: 3.5, recorded_at: '2023-10-27T10:00:00Z' }],
      error: null,
    });

    const res = await request(app).get('/api/v1/routes/route-1');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('notes');
    expect(res.body.tags).toEqual(['shade']);
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it('does not validate Authorization on GET route detail (public endpoint)', async () => {
    queryHandlers.routes = async () => ({ data: baseRoute(), error: null });
    queryHandlers.votes = async () => ({ data: [{ vote_type: 'up' }], error: null });
    rpcHandlers.get_route_points_with_coords = async () => ({ data: [], error: null });

    const res = await request(app)
      .get('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('notes');
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it('GET route detail succeeds even when Bearer token is stale (auth not consulted)', async () => {
    queryHandlers.routes = async () => ({ data: baseRoute(), error: null });
    queryHandlers.votes = async () => ({ data: [], error: null });
    rpcHandlers.get_route_points_with_coords = async () => ({ data: [], error: null });

    const res = await request(app)
      .get('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer stale-token');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('notes');
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it('allows the creator to clear description via PATCH', async () => {
    queryHandlers.routes = async (state) => {
      if (state.operation === 'select') {
        return {
          data: { id: 'route-1', creator_id: 'creator-1', is_active: true },
          error: null,
        };
      }

      if (state.operation === 'update') {
        expect(state.payload).toEqual({
          description: null,
        });
        return {
          data: {
            id: 'route-1',
            title: 'Quiet path',
            description: null,
          },
          error: null,
        };
      }

      return { data: null, error: null };
    };

    const res = await request(app)
      .patch('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token')
      .send({
        description: '',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'route-1',
      title: 'Quiet path',
      description: null,
    });
  });

  it('forbids updates by non-creators', async () => {
    supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'someone-else', email: 'other@utexas.edu' } },
      error: null,
    });
    queryHandlers.routes = async () => ({
      data: { id: 'route-1', creator_id: 'creator-1', is_active: true },
      error: null,
    });

    const res = await request(app)
      .patch('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token')
      .send({ title: 'Hacked title' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Forbidden',
      message: 'You can only update routes you created',
    });
  });

  it('rejects empty route updates', async () => {
    const res = await request(app)
      .patch('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Validation error',
      issues: [{ field: '(root)', message: 'At least one field must be provided' }],
    });
  });

  it('allows the creator to soft-delete an active route', async () => {
    queryHandlers.routes = async (state) => {
      if (state.operation === 'select') {
        return {
          data: { id: 'route-1', creator_id: 'creator-1', is_active: true },
          error: null,
        };
      }

      if (state.operation === 'update') {
        expect(state.payload).toEqual({ is_active: false });
        return { data: { id: 'route-1' }, error: null };
      }

      return { data: null, error: null };
    };

    const res = await request(app)
      .delete('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Route deactivated successfully' });
  });

  it('forbids deletes by non-creators', async () => {
    supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'someone-else', email: 'other@utexas.edu' } },
      error: null,
    });
    queryHandlers.routes = async () => ({
      data: { id: 'route-1', creator_id: 'creator-1', is_active: true },
      error: null,
    });

    const res = await request(app)
      .delete('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Forbidden',
      message: 'You can only delete routes you created',
    });
  });

  it('returns 404 when deleting an inactive or missing route', async () => {
    queryHandlers.routes = async () => ({
      data: { id: 'route-1', creator_id: 'creator-1', is_active: false },
      error: null,
    });

    const res = await request(app)
      .delete('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'Route not found',
      message: 'No active route found with id route-1',
    });
  });

  it('returns 404 when soft-delete updates zero rows', async () => {
    queryHandlers.routes = async (state) => {
      if (state.operation === 'select') {
        return {
          data: { id: 'route-1', creator_id: 'creator-1', is_active: true },
          error: null,
        };
      }
      if (state.operation === 'update') {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    const res = await request(app)
      .delete('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Route not found');
  });
});
