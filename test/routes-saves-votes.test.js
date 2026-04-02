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
    delete: jest.fn(() => {
      state.operation = 'delete';
      return builder;
    }),
    upsert: jest.fn((payload, _opts) => {
      state.operation = 'upsert';
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

describe('Route saves and votes', () => {
  let queryHandlers;

  beforeEach(() => {
    queryHandlers = {};

    supabase.from.mockImplementation((table) =>
      buildQuery(table, async (state) => {
        const handler = queryHandlers[table];
        if (!handler) {
          return { data: null, error: null };
        }
        return handler(state);
      }),
    );

    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'u@utexas.edu' } },
      error: null,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('POST /routes/:id/save upserts saved_routes with user JWT client', async () => {
    queryHandlers.routes = async (state) => {
      if (state.operation === 'select' && state.expectsSingle) {
        return { data: { id: 'route-1' }, error: null };
      }
      return { data: null, error: null };
    };
    queryHandlers.saved_routes = async (state) => {
      if (state.operation === 'upsert') {
        expect(state.payload).toEqual({ user_id: 'user-1', route_id: 'route-1' });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    const res = await request(app)
      .post('/api/v1/routes/route-1/save')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: 'Route saved successfully' });
    expect(supabase.createUserClient).toHaveBeenCalledWith('valid-token');
  });

  it('DELETE /routes/:id/save removes row for current user', async () => {
    queryHandlers.saved_routes = async (state) => {
      if (state.operation === 'delete') {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    const res = await request(app)
      .delete('/api/v1/routes/route-1/save')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(204);
    expect(supabase.createUserClient).toHaveBeenCalledWith('valid-token');
  });

  it('POST /routes/:id/vote clears then inserts vote', async () => {
    queryHandlers.routes = async (state) => {
      if (state.operation === 'select' && state.expectsSingle) {
        return { data: { id: 'route-1' }, error: null };
      }
      return { data: null, error: null };
    };

    let deleteCalled = false;
    queryHandlers.votes = async (state) => {
      if (state.operation === 'delete') {
        deleteCalled = true;
        return { data: null, error: null };
      }
      if (state.operation === 'insert') {
        expect(deleteCalled).toBe(true);
        expect(state.payload).toEqual({
          route_id: 'route-1',
          user_id: 'user-1',
          vote_type: 'up',
          context: 'efficiency',
        });
        return { data: null, error: null };
      }
      if (state.operation === 'select') {
        return { data: [{ vote_type: 'up' }], error: null };
      }
      return { data: null, error: null };
    };

    const res = await request(app)
      .post('/api/v1/routes/route-1/vote')
      .set('Authorization', 'Bearer valid-token')
      .send({ vote_type: 'up', context: 'efficiency' });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Vote recorded successfully');
    expect(supabase.createUserClient).toHaveBeenCalledWith('valid-token');
  });

  it('DELETE /routes/:id/vote removes vote and returns totals', async () => {
    queryHandlers.routes = async (state) => {
      if (state.operation === 'select' && state.expectsSingle) {
        return { data: { id: 'route-1' }, error: null };
      }
      return { data: null, error: null };
    };
    queryHandlers.votes = async (state) => {
      if (state.operation === 'delete') {
        return { data: null, error: null };
      }
      if (state.operation === 'select') {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    };

    const res = await request(app)
      .delete('/api/v1/routes/route-1/vote')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Vote removed successfully');
    expect(supabase.createUserClient).toHaveBeenCalledWith('valid-token');
  });

  it('returns 404 when saving a missing route', async () => {
    queryHandlers.routes = async () => ({
      data: null,
      error: { code: 'PGRST116', message: 'Not found' },
    });

    const res = await request(app)
      .post('/api/v1/routes/missing-id/save')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(404);
  });
});
