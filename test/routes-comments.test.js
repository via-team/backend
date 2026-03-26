const request = require('supertest');

jest.mock('../src/config/supabase', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn(),
  rpc: jest.fn(),
}));

const supabase = require('../src/config/supabase');
const app = require('../src/index');

function buildQuery(table, resolveQuery) {
  const state = {
    table,
    operation: 'select',
    payload: undefined,
    filters: [],
    columns: undefined,
    orders: [],
    limit: undefined,
  };

  const builder = {
    select: jest.fn((columns) => {
      state.columns = columns;
      return builder;
    }),
    insert: jest.fn((payload) => {
      state.operation = 'insert';
      state.payload = payload;
      return builder;
    }),
    eq: jest.fn((field, value) => {
      state.filters.push({ type: 'eq', field, value });
      return builder;
    }),
    gt: jest.fn((field, value) => {
      state.filters.push({ type: 'gt', field, value });
      return builder;
    }),
    in: jest.fn((field, values) => {
      state.filters.push({ type: 'in', field, value: values });
      return builder;
    }),
    order: jest.fn((field, options) => {
      state.orders.push({ field, options });
      return builder;
    }),
    limit: jest.fn((value) => {
      state.limit = value;
      return builder;
    }),
    single: jest.fn(() => resolveQuery({ ...state, expectsSingle: true })),
    then: (onFulfilled, onRejected) =>
      resolveQuery({ ...state, expectsSingle: false }).then(onFulfilled, onRejected),
    catch: (onRejected) => resolveQuery({ ...state, expectsSingle: false }).catch(onRejected),
  };

  return builder;
}

function sortCommentsAscending(comments) {
  return [...comments].sort((a, b) => {
    const createdAtCompare = new Date(a.created_at) - new Date(b.created_at);
    if (createdAtCompare !== 0) {
      return createdAtCompare;
    }

    return a.id.localeCompare(b.id);
  });
}

function resolveCommentsQuery(state, comments) {
  let rows = sortCommentsAscending(comments);

  for (const filter of state.filters) {
    if (filter.type === 'eq') {
      rows = rows.filter((row) => row[filter.field] === filter.value);
    }

    if (filter.type === 'gt') {
      rows = rows.filter((row) => row[filter.field] > filter.value);
    }
  }

  if (state.limit !== undefined) {
    rows = rows.slice(0, state.limit);
  }

  if (state.expectsSingle) {
    return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'Not found' } };
  }

  return { data: rows, error: null };
}

describe('Route comments endpoint', () => {
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('lists the first page of comments with author display names', async () => {
    const comments = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        route_id: 'route-1',
        user_id: 'user-1',
        content: 'First',
        created_at: '2024-09-01T12:00:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        route_id: 'route-1',
        user_id: 'user-2',
        content: 'Second',
        created_at: '2024-09-01T12:05:00.000Z',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        route_id: 'route-1',
        user_id: 'user-3',
        content: 'Third',
        created_at: '2024-09-01T12:10:00.000Z',
      },
    ];

    queryHandlers.routes = async () => ({ data: { id: 'route-1' }, error: null });
    queryHandlers.comments = async (state) => resolveCommentsQuery(state, comments);
    queryHandlers.profiles = async () => ({
      data: [
        { id: 'user-1', full_name: 'Alice' },
        { id: 'user-2', full_name: 'Bob' },
      ],
      error: null,
    });

    const res = await request(app).get('/api/v1/routes/route-1/comments?limit=2');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      comments: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          route_id: 'route-1',
          user_id: 'user-1',
          content: 'First',
          created_at: '2024-09-01T12:00:00.000Z',
          author_display_name: 'Alice',
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          route_id: 'route-1',
          user_id: 'user-2',
          content: 'Second',
          created_at: '2024-09-01T12:05:00.000Z',
          author_display_name: 'Bob',
        },
      ],
      next_cursor: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('pages forward from a cursor and falls back to null author display names', async () => {
    const comments = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        route_id: 'route-1',
        user_id: 'user-1',
        content: 'First',
        created_at: '2024-09-01T12:00:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        route_id: 'route-1',
        user_id: 'user-2',
        content: 'Second',
        created_at: '2024-09-01T12:00:00.000Z',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        route_id: 'route-1',
        user_id: 'user-3',
        content: 'Third',
        created_at: '2024-09-01T12:05:00.000Z',
      },
    ];

    queryHandlers.routes = async () => ({ data: { id: 'route-1' }, error: null });
    queryHandlers.comments = async (state) => resolveCommentsQuery(state, comments);
    queryHandlers.profiles = async (state) => {
      const profileFilter = state.filters.find((filter) => filter.type === 'in' && filter.field === 'id');
      expect(profileFilter.value).toEqual(['user-2', 'user-3']);

      return {
        data: [{ id: 'user-2', full_name: 'Bob' }],
        error: null,
      };
    };

    const res = await request(app).get(
      '/api/v1/routes/route-1/comments?limit=2&cursor=11111111-1111-4111-8111-111111111111',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      comments: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          route_id: 'route-1',
          user_id: 'user-2',
          content: 'Second',
          created_at: '2024-09-01T12:00:00.000Z',
          author_display_name: 'Bob',
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          route_id: 'route-1',
          user_id: 'user-3',
          content: 'Third',
          created_at: '2024-09-01T12:05:00.000Z',
          author_display_name: null,
        },
      ],
      next_cursor: null,
    });
  });

  it('rejects cursors that do not belong to the route', async () => {
    queryHandlers.routes = async () => ({ data: { id: 'route-1' }, error: null });
    queryHandlers.comments = async (state) => resolveCommentsQuery(state, []);

    const res = await request(app).get(
      '/api/v1/routes/route-1/comments?cursor=11111111-1111-4111-8111-111111111111',
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Invalid cursor',
      message: 'cursor must reference an existing comment for this route',
    });
  });

  it('returns 404 for inactive or missing routes', async () => {
    queryHandlers.routes = async () => ({ data: null, error: { message: 'Not found' } });

    const res = await request(app).get('/api/v1/routes/route-1/comments');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'Route not found',
      message: 'No active route found with id route-1',
    });
  });
});
