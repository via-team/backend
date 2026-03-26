const request = require('supertest');

jest.mock('../src/config/supabase', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn(),
}));

const supabase = require('../src/config/supabase');
const app = require('../src/index');

// ─── Mock builder ────────────────────────────────────────────────────────────

/**
 * Builds a chainable Supabase query builder that records the full call chain
 * and resolves via the provided `resolveQuery` callback.
 *
 * Tracks: table, operation, payload, eq filters, or clauses, in filters,
 * whether `.single()` was called, and selected columns.
 */
function buildQuery(table, resolveQuery) {
  const state = {
    table,
    operation: 'select',
    payload: undefined,
    filters: [],
    orClauses: [],
    inFilters: [],
    columns: undefined,
    expectsSingle: false,
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
    eq: jest.fn((field, value) => {
      state.filters.push({ field, value });
      return builder;
    }),
    or: jest.fn((clause) => {
      state.orClauses.push(clause);
      return builder;
    }),
    in: jest.fn((field, values) => {
      state.inFilters.push({ field, values });
      return builder;
    }),
    single: jest.fn(() => {
      state.expectsSingle = true;
      return resolveQuery({ ...state });
    }),
    then: (onFulfilled, onRejected) =>
      resolveQuery({ ...state }).then(onFulfilled, onRejected),
    catch: (onRejected) =>
      resolveQuery({ ...state }).catch(onRejected),
  };

  return builder;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USER_A = 'a0000000-0000-4000-8000-000000000001';
const USER_B = 'b0000000-0000-4000-8000-000000000002';
const USER_C = 'c0000000-0000-4000-8000-000000000003';
const BEARER  = 'Authorization';
const TOKEN   = 'Bearer valid-token';

function mockAuth(id = USER_A, email = 'a@utexas.edu') {
  supabase.auth.getUser.mockResolvedValue({
    data: { user: { id, email } },
    error: null,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Friendship endpoints', () => {
  let queryHandlers;

  beforeEach(() => {
    queryHandlers = {};
    supabase.from.mockImplementation((table) =>
      buildQuery(table, async (state) => {
        const handler = queryHandlers[table];
        if (!handler) return { data: null, error: null };
        return handler(state);
      })
    );
    mockAuth();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Auth guard ──────────────────────────────────────────────────────────────

  it('requires auth on POST /friends/request', async () => {
    supabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad token' } });
    const res = await request(app)
      .post('/api/v1/users/friends/request')
      .set(BEARER, 'Bearer bad')
      .send({ friend_id: USER_B });
    expect(res.status).toBe(401);
  });

  it('requires auth on POST /friends/:id/accept', async () => {
    supabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad token' } });
    const res = await request(app)
      .post(`/api/v1/users/friends/${USER_B}/accept`)
      .set(BEARER, 'Bearer bad');
    expect(res.status).toBe(401);
  });

  it('requires auth on GET /me/friends', async () => {
    supabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad token' } });
    const res = await request(app).get('/api/v1/users/me/friends').set(BEARER, 'Bearer bad');
    expect(res.status).toBe(401);
  });

  it('requires auth on DELETE /friends/:id', async () => {
    supabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad token' } });
    const res = await request(app).delete(`/api/v1/users/friends/${USER_B}`).set(BEARER, 'Bearer bad');
    expect(res.status).toBe(401);
  });

  // ── POST /friends/request ───────────────────────────────────────────────────

  it('rejects a self-request with 400', async () => {
    const res = await request(app)
      .post('/api/v1/users/friends/request')
      .set(BEARER, TOKEN)
      .send({ friend_id: USER_A });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('returns 400 when friend_id is not a UUID', async () => {
    const res = await request(app)
      .post('/api/v1/users/friends/request')
      .set(BEARER, TOKEN)
      .send({ friend_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('returns 404 when the target user does not exist', async () => {
    queryHandlers.profiles = async (state) => {
      if (state.expectsSingle) return { data: null, error: { message: 'not found' } };
      return { data: [], error: null };
    };
    const res = await request(app)
      .post('/api/v1/users/friends/request')
      .set(BEARER, TOKEN)
      .send({ friend_id: USER_B });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('creates a pending request when no relationship exists (201)', async () => {
    // profiles check — target exists
    queryHandlers.profiles = async (state) => {
      if (state.expectsSingle) return { data: { id: USER_B }, error: null };
      return { data: [], error: null };
    };
    // friends pair lookup — no rows
    queryHandlers.friends = async (state) => {
      if (state.operation === 'select') return { data: [], error: null };
      if (state.operation === 'insert') return { data: null, error: null };
      return { data: null, error: null };
    };

    const res = await request(app)
      .post('/api/v1/users/friends/request')
      .set(BEARER, TOKEN)
      .send({ friend_id: USER_B });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.friend_id).toBe(USER_B);
  });

  it('auto-accepts a reciprocal pending request (200)', async () => {
    queryHandlers.profiles = async (state) => {
      if (state.expectsSingle) return { data: { id: USER_B }, error: null };
      return { data: [], error: null };
    };
    // Inbound pending row: B → A
    queryHandlers.friends = async (state) => {
      if (state.operation === 'select') {
        return {
          data: [{ requester_id: USER_B, addressee_id: USER_A, status: 'pending', created_at: '2024-01-01T00:00:00Z' }],
          error: null,
        };
      }
      if (state.operation === 'update') return { data: null, error: null };
      return { data: null, error: null };
    };

    const res = await request(app)
      .post('/api/v1/users/friends/request')
      .set(BEARER, TOKEN)
      .send({ friend_id: USER_B });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
  });

  it('returns 409 when a pending outbound request already exists', async () => {
    queryHandlers.profiles = async (state) => {
      if (state.expectsSingle) return { data: { id: USER_B }, error: null };
      return { data: [], error: null };
    };
    // Outbound pending: A → B
    queryHandlers.friends = async () => ({
      data: [{ requester_id: USER_A, addressee_id: USER_B, status: 'pending', created_at: '2024-01-01T00:00:00Z' }],
      error: null,
    });

    const res = await request(app)
      .post('/api/v1/users/friends/request')
      .set(BEARER, TOKEN)
      .send({ friend_id: USER_B });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Conflict');
    expect(res.body.message).toMatch(/already pending/);
  });

  it('returns 409 when the pair is already accepted friends', async () => {
    queryHandlers.profiles = async (state) => {
      if (state.expectsSingle) return { data: { id: USER_B }, error: null };
      return { data: [], error: null };
    };
    queryHandlers.friends = async () => ({
      data: [{ requester_id: USER_A, addressee_id: USER_B, status: 'accepted', created_at: '2024-01-01T00:00:00Z' }],
      error: null,
    });

    const res = await request(app)
      .post('/api/v1/users/friends/request')
      .set(BEARER, TOKEN)
      .send({ friend_id: USER_B });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already friends/);
  });

  // ── POST /friends/:id/accept ────────────────────────────────────────────────

  it('returns 400 when :id is not a UUID', async () => {
    const res = await request(app)
      .post('/api/v1/users/friends/not-a-uuid/accept')
      .set(BEARER, TOKEN);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('returns 400 on self-accept', async () => {
    const res = await request(app)
      .post(`/api/v1/users/friends/${USER_A}/accept`)
      .set(BEARER, TOKEN);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('returns 404 when no inbound pending request exists', async () => {
    queryHandlers.friends = async (state) => {
      if (state.expectsSingle) return { data: null, error: { message: 'not found' } };
      return { data: null, error: null };
    };

    const res = await request(app)
      .post(`/api/v1/users/friends/${USER_B}/accept`)
      .set(BEARER, TOKEN);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });

  it('returns 409 when friendship is already accepted', async () => {
    queryHandlers.friends = async (state) => {
      if (state.expectsSingle) return { data: { status: 'accepted' }, error: null };
      return { data: null, error: null };
    };

    const res = await request(app)
      .post(`/api/v1/users/friends/${USER_B}/accept`)
      .set(BEARER, TOKEN);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already friends/);
  });

  it('accepts an inbound pending request (200)', async () => {
    let callCount = 0;
    queryHandlers.friends = async (state) => {
      callCount++;
      if (callCount === 1 && state.expectsSingle) {
        return { data: { status: 'pending' }, error: null };
      }
      if (state.operation === 'update') return { data: null, error: null };
      return { data: null, error: null };
    };

    const res = await request(app)
      .post(`/api/v1/users/friends/${USER_B}/accept`)
      .set(BEARER, TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.friend_id).toBe(USER_B);
  });

  // ── GET /me/friends ─────────────────────────────────────────────────────────

  it('returns an empty list when the user has no accepted friends', async () => {
    queryHandlers.friends = async () => ({ data: [], error: null });

    const res = await request(app).get('/api/v1/users/me/friends').set(BEARER, TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('returns accepted friends with profile info', async () => {
    queryHandlers.friends = async (state) => {
      if (state.operation === 'select') {
        return {
          data: [
            { requester_id: USER_A, addressee_id: USER_B, created_at: '2024-06-01T00:00:00Z' },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    };
    queryHandlers.profiles = async () => ({
      data: [{ id: USER_B, full_name: 'Bob Student', email: 'bob@utexas.edu' }],
      error: null,
    });

    const res = await request(app).get('/api/v1/users/me/friends').set(BEARER, TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const [friend] = res.body.data;
    expect(friend.id).toBe(USER_B);
    expect(friend.display_name).toBe('Bob Student');
    expect(friend.friends_since).toBe('2024-06-01T00:00:00Z');
  });

  // ── DELETE /friends/:id ─────────────────────────────────────────────────────

  it('returns 400 when :id is not a UUID', async () => {
    const res = await request(app)
      .delete('/api/v1/users/friends/not-a-uuid')
      .set(BEARER, TOKEN);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('returns 404 when no relationship exists', async () => {
    queryHandlers.friends = async () => ({ data: [], error: null });

    const res = await request(app)
      .delete(`/api/v1/users/friends/${USER_B}`)
      .set(BEARER, TOKEN);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });

  it('removes an accepted friendship (204)', async () => {
    let deleteWasCalled = false;
    queryHandlers.friends = async (state) => {
      if (state.operation === 'select') {
        return {
          data: [{ requester_id: USER_A, addressee_id: USER_B, status: 'accepted', created_at: '2024-01-01T00:00:00Z' }],
          error: null,
        };
      }
      if (state.operation === 'delete') {
        deleteWasCalled = true;
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    const res = await request(app)
      .delete(`/api/v1/users/friends/${USER_B}`)
      .set(BEARER, TOKEN);

    expect(res.status).toBe(204);
    expect(deleteWasCalled).toBe(true);
  });

  it('removes a pending outbound request (cancel, 204)', async () => {
    queryHandlers.friends = async (state) => {
      if (state.operation === 'select') {
        return {
          data: [{ requester_id: USER_A, addressee_id: USER_B, status: 'pending', created_at: '2024-01-01T00:00:00Z' }],
          error: null,
        };
      }
      if (state.operation === 'delete') return { data: null, error: null };
      return { data: null, error: null };
    };

    const res = await request(app)
      .delete(`/api/v1/users/friends/${USER_B}`)
      .set(BEARER, TOKEN);

    expect(res.status).toBe(204);
  });

  it('removes a pending inbound request (decline, 204)', async () => {
    queryHandlers.friends = async (state) => {
      if (state.operation === 'select') {
        return {
          data: [{ requester_id: USER_B, addressee_id: USER_A, status: 'pending', created_at: '2024-01-01T00:00:00Z' }],
          error: null,
        };
      }
      if (state.operation === 'delete') return { data: null, error: null };
      return { data: null, error: null };
    };

    const res = await request(app)
      .delete(`/api/v1/users/friends/${USER_B}`)
      .set(BEARER, TOKEN);

    expect(res.status).toBe(204);
  });

  // ── Regression: GET /users/me still reports accepted friendship count ────────

  it('GET /users/me reports correct friends_count after accepted friendship', async () => {
    queryHandlers.profiles = async (state) => {
      if (state.expectsSingle) {
        return { data: { id: USER_A, email: 'a@utexas.edu', full_name: 'Alice', created_at: '2024-01-01T00:00:00Z' }, error: null };
      }
      return { data: [], error: null };
    };
    queryHandlers.routes = async () => ({ count: 2, error: null });
    queryHandlers.route_usage = async () => ({ count: 5, error: null });
    // Two accepted friendships (user is requester in one, addressee in the other)
    queryHandlers.friends = async () => ({
      data: [
        { requester_id: USER_A, addressee_id: USER_B, status: 'accepted' },
        { requester_id: USER_C, addressee_id: USER_A, status: 'accepted' },
      ],
      error: null,
    });

    const res = await request(app).get('/api/v1/users/me').set(BEARER, TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.stats.friends_count).toBe(2);
  });
});
