require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { corsOptionsDelegate, isOriginAllowed, jsonBodyLimit, trustProxy } = require('./config/security');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const routeRoutes = require('./routes/routes');
const eventRoutes = require('./routes/events');
const tagRoutes = require('./routes/tags');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', trustProxy);

app.use(helmet());
app.use((req, res, next) => {
  const origin = req.get('Origin');

  if (!isOriginAllowed(origin)) {
    return res.status(403).json({
      error: 'Origin not allowed',
      message: 'This origin is not allowed to access the API.',
    });
  }

  return next();
});
app.use(cors(corsOptionsDelegate));
app.use(express.json({ limit: jsonBodyLimit }));

app.get('/', (req, res) => {
  res.json({ message: 'VIA API' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/v1/auth', authRoutes);

app.use('/api/v1/tags', tagRoutes);

// All user endpoints require authentication
app.use('/api/v1/users', requireAuth, userRoutes);

// GET /routes and GET /routes/:id are public; write operations require authentication
app.use('/api/v1/routes', routeRoutes);

// GET /events is public; POST and DELETE require authentication (handled per-route)
app.use('/api/v1/events', eventRoutes);

// Only start server when run directly (not when required for tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
