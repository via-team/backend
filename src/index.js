require('dotenv').config();

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const routeRoutes = require('./routes/routes');
const eventRoutes = require('./routes/events');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({ origin: '*' }));

app.get('/', (req, res) => {
  res.json({ message: 'VIA API' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/v1/auth', authRoutes);

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
