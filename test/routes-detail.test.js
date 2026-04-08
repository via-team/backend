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
  api.getServiceRoleClient = jest.fn(() => null);
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
    limit: jest.fn(() => builder),
    delete: jest.fn(() => {
      state.operation = 'delete';
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
    creator: {
      id: 'creator-1',
      full_name: 'Creator One',
      email: 'creator@utexas.edu',
    },
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
    queryHandlers.votes = async () => ({
      data: [
        { vote_type: 'up', user_id: 'u1' },
        { vote_type: 'down', user_id: 'u2' },
      ],
      error: null,
    });
    queryHandlers.comments = async () => ({ data: [], error: null });
    queryHandlers.route_images = async () => ({ data: [], error: null });
    rpcHandlers.get_route_points_with_coords = async () => ({
      data: [{ sequence: 1, lat: 30.2849, lng: -97.7341, accuracy_meters: 3.5, recorded_at: '2023-10-27T10:00:00Z' }],
      error: null,
    });

    const res = await request(app).get('/api/v1/routes/route-1');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('notes');
    expect(res.body.tags).toEqual(['shade']);
    expect(res.body.creator).toMatchObject({ id: 'creator-1' });
    expect(res.body.upvotes).toBe(1);
    expect(res.body.downvotes).toBe(1);
    expect(res.body.comment_count).toBe(0);
    expect(res.body.images).toEqual([]);
    expect(res.body.preview_polyline).toBeTruthy();
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it('optionally attaches user for GET route detail when Authorization is present', async () => {
    queryHandlers.routes = async () => ({ data: baseRoute(), error: null });
    queryHandlers.votes = async () => ({
      data: [{ vote_type: 'up', user_id: 'creator-1' }],
      error: null,
    });
    queryHandlers.comments = async () => ({ data: [], error: null });
    queryHandlers.route_images = async () => ({ data: [], error: null });
    queryHandlers.saved_routes = async () => ({ data: [{ route_id: 'route-1' }], error: null });
    rpcHandlers.get_route_points_with_coords = async () => ({ data: [], error: null });

    const res = await request(app)
      .get('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('notes');
    expect(supabase.auth.getUser).toHaveBeenCalled();
    expect(res.body.user_vote).toBe('up');
    expect(res.body.is_saved).toBe(true);
  });

  it('GET route detail succeeds when Bearer token is stale (treated as anonymous)', async () => {
    supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'invalid' },
    });
    queryHandlers.routes = async () => ({ data: baseRoute(), error: null });
    queryHandlers.votes = async () => ({ data: [], error: null });
    queryHandlers.comments = async () => ({ data: [], error: null });
    queryHandlers.route_images = async () => ({ data: [], error: null });
    rpcHandlers.get_route_points_with_coords = async () => ({ data: [], error: null });

    const res = await request(app)
      .get('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer stale-token');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('notes');
    expect(supabase.auth.getUser).toHaveBeenCalled();
    expect(res.body.user_vote).toBeNull();
    expect(res.body.is_saved).toBe(false);
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

  it('allows the creator to delete their route', async () => {
    queryHandlers.routes = async (state) => {
      if (state.operation === 'select') {
        return {
          data: { id: 'route-1', creator_id: 'creator-1' },
          error: null,
        };
      }

      if (state.operation === 'delete') {
        return { data: { id: 'route-1' }, error: null };
      }

      return { data: null, error: null };
    };

    queryHandlers.route_notes = async () => ({ data: [], error: null });
    queryHandlers.route_tags = async () => ({ data: [], error: null });
    queryHandlers.votes = async () => ({ data: [], error: null });
    queryHandlers.saved_routes = async () => ({ data: [], error: null });
    queryHandlers.route_usage = async () => ({ data: [], error: null });
    queryHandlers.comments = async () => ({ data: [], error: null });
    queryHandlers.route_images = async () => ({ data: [], error: null });
    queryHandlers.route_points = async () => ({ data: [], error: null });

    const res = await request(app)
      .delete('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Route deleted successfully' });
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
      data: null,
      error: null,
    });

    const res = await request(app)
      .delete('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'Route not found',
      message: 'No route found with id route-1',
    });
  });

  it('returns 500 when a dependent delete fails', async () => {
    queryHandlers.routes = async (state) => {
      if (state.operation === 'select') {
        return {
          data: { id: 'route-1', creator_id: 'creator-1' },
          error: null,
        };
      }
      if (state.operation === 'delete') {
        return { data: { id: 'route-1' }, error: null };
      }
      return { data: null, error: null };
    };

    queryHandlers.route_notes = async () => ({
      data: null,
      error: { message: 'boom' },
    });

    const res = await request(app)
      .delete('/api/v1/routes/route-1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to delete route');
  });

  it('POST /routes/:id/images registers metadata for the route creator', async () => {
    queryHandlers.routes = async (state) => {
      if (state.operation === 'select') {
        return {
          data: { id: 'route-1', creator_id: 'creator-1', is_active: true },
          error: null,
        };
      }
      return { data: null, error: null };
    };

    queryHandlers.route_images = async (state) => {
      if (state.operation === 'insert') {
        expect(state.payload).toMatchObject({
          route_id: 'route-1',
          public_url: 'https://example.com/photo.jpg',
          storage_path: 'route-photos/route-1/x.jpg',
          sort_order: 0,
          created_by: 'creator-1',
        });
        return {
          data: {
            id: 'img-1',
            public_url: 'https://example.com/photo.jpg',
            sort_order: 0,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const res = await request(app)
      .post('/api/v1/routes/route-1/images')
      .set('Authorization', 'Bearer valid-token')
      .send({
        public_url: 'https://example.com/photo.jpg',
        storage_path: 'route-photos/route-1/x.jpg',
        sort_order: 0,
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 'img-1',
      public_url: 'https://example.com/photo.jpg',
      sort_order: 0,
    });
  });

  it('POST /routes/:id/images forbids non-creators', async () => {
    supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'someone-else', email: 'other@utexas.edu' } },
      error: null,
    });
    queryHandlers.routes = async () => ({
      data: { id: 'route-1', creator_id: 'creator-1', is_active: true },
      error: null,
    });

    const res = await request(app)
      .post('/api/v1/routes/route-1/images')
      .set('Authorization', 'Bearer valid-token')
      .send({
        public_url: 'https://example.com/photo.jpg',
        storage_path: 'route-photos/route-1/x.jpg',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });
});
