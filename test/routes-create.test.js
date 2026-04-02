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

const validCreateBody = {
  title: 'Morning walk',
  start_label: 'Jester West',
  end_label: 'GDC',
  start_time: '2023-10-27T10:00:00.000Z',
  end_time: '2023-10-27T10:15:00.000Z',
  tags: [],
  points: [
    {
      seq: 1,
      lat: 30.2849,
      lng: -97.7341,
      time: '2023-10-27T10:00:00.000Z',
    },
    {
      seq: 2,
      lat: 30.2855,
      lng: -97.735,
      time: '2023-10-27T10:15:00.000Z',
    },
  ],
};

describe('POST /api/v1/routes (create)', () => {
  beforeEach(() => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'creator-1', email: 'creator@utexas.edu' } },
      error: null,
    });

    supabase.rpc.mockImplementation(async (name) => {
      if (name === 'create_route_with_geography') {
        return { data: 'new-route-uuid', error: null };
      }
      if (name === 'insert_route_points') {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    supabase.from.mockImplementation(() => ({
      insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('accepts create payload without description (optional field omitted)', async () => {
    const res = await request(app)
      .post('/api/v1/routes')
      .set('Authorization', 'Bearer valid-token')
      .send(validCreateBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ route_id: 'new-route-uuid' });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_route_with_geography',
      expect.objectContaining({
        p_title: 'Morning walk',
        p_description: null,
      }),
    );
  });

  it('rejects description: null (Zod optional does not allow null)', async () => {
    const res = await request(app)
      .post('/api/v1/routes')
      .set('Authorization', 'Bearer valid-token')
      .send({ ...validCreateBody, description: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.issues.some((i) => i.field === 'description')).toBe(true);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('accepts non-empty description', async () => {
    const res = await request(app)
      .post('/api/v1/routes')
      .set('Authorization', 'Bearer valid-token')
      .send({ ...validCreateBody, description: '  Nice shade  ' });

    expect(res.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_route_with_geography',
      expect.objectContaining({
        p_description: 'Nice shade',
      }),
    );
  });
});
