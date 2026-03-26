const request = require('supertest');

const ORIGINAL_ENV = { ...process.env };

function buildSupabaseMock() {
  const mockFrom = () => ({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test-user', email: 'student@utexas.edu' } },
        error: null,
      }),
    },
    from: jest.fn(mockFrom),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
}

function loadApp(envOverrides = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }

  jest.doMock('../src/config/supabase', () => buildSupabaseMock());

  return require('../src/index');
}

describe('Security middleware', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('allows configured browser origins', async () => {
    const app = loadApp({ ALLOWED_ORIGINS: 'https://app.example.com' });

    const res = await request(app).get('/health').set('Origin', 'https://app.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });

  it('rejects disallowed browser origins', async () => {
    const app = loadApp({ ALLOWED_ORIGINS: 'https://app.example.com' });

    const res = await request(app).get('/health').set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Origin not allowed',
      message: 'This origin is not allowed to access the API.',
    });
  });

  it('throttles repeated school email verification attempts', async () => {
    const app = loadApp({
      RATE_LIMIT_VERIFY_SCHOOL_EMAIL_MAX: '2',
      RATE_LIMIT_WINDOW_MS: '600000',
    });

    const body = { email: 'student@utexas.edu' };

    const first = await request(app).post('/api/v1/auth/verify-school-email').send(body);
    const second = await request(app).post('/api/v1/auth/verify-school-email').send(body);
    const third = await request(app).post('/api/v1/auth/verify-school-email').send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body).toEqual({
      error: 'Too many requests',
      message: 'Please try again later.',
    });
  });
});
