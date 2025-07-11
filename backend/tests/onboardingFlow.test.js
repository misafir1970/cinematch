const request = require('supertest');
const express = require('express');
const authRoutes = require('../routes/auth');
const userRoutes = require('../routes/user');
const { runMigrations } = require('../scripts/migrate');
const { shutdown } = require('../config/database');

// Ensure JWT secrets for test environment
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret';

// Build an isolated app instance for tests
const buildTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  return app;
};

const app = buildTestApp();

describe('User onboarding flow', () => {
  const testEmail = `test_${Date.now()}@example.com`;
  const password = 'Passw0rd!';
  let accessToken;

  beforeAll(async () => {
    // Ensure DB schema is up-to-date
    await runMigrations();
  });

  afterAll(async () => {
    await shutdown();
  });

  it('registers a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password,
        firstName: 'Test',
        lastName: 'User'
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.tokens).toBeDefined();
    accessToken = res.body.tokens.accessToken;
  });

  it('blocks access to profile before completing onboarding', async () => {
    const res = await request(app)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Onboarding/);
  });

  it('allows user to rate 10 movies', async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await request(app)
        .post('/api/user/ratings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          movieId: i,
          movieTitle: `Movie ${i}`,
          rating: 8.0
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });

  it('grants access to profile after onboarding complete', async () => {
    const res = await request(app)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.profile).toBeDefined();
  });
});