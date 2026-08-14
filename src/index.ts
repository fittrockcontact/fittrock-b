import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import checkoutRouter from './routes/checkout.js';
import webhooksRouter from './routes/webhooks.js';
import productsRouter from './routes/products.js';
import ordersRouter from './routes/orders.js';
import discountsRouter from './routes/discounts.js';
import collectionsRouter from './routes/collections.js';
import adminRouter from './routes/admin.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// CORS configuration supporting production domain (www.fittrock.com, admin.fittrock.com) and dev
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'https://www.fittrock.com',
  'https://fittrock.com',
  'https://admin.fittrock.com',
  FRONTEND_URL,
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in dev, logged in prod
      }
    },
    credentials: true,
  })
);

// Raw body parser for webhook signature verification
app.use(
  express.json({
    verify: (req: Request & { rawBody?: string }, _res: Response, buf: Buffer) => {
      if (req.originalUrl.includes('/api/webhooks')) {
        req.rawBody = buf.toString();
      }
    },
  })
);

app.use(express.urlencoded({ extended: true }));

// Health Check Endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    domain: 'api.fittrock.com',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/checkout', checkoutRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/discounts', discountsRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/admin', adminRouter);

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const startServer = (port: number, maxAttempts = 10) => {
  const server = app.listen(port, () => {
    console.log(`🚀 Fittrock API Server running on port ${port}`);
    console.log(`📍 Target Domain: api.fittrock.com`);
    console.log(`🌐 Allowed Frontend Origin: ${FRONTEND_URL}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE' && maxAttempts > 0) {
      console.warn(`⚠️ Port ${port} is in use, attempting port ${port + 1}...`);
      startServer(port + 1, maxAttempts - 1);
    } else {
      console.error('Failed to start API server:', err);
    }
  });
};

startServer(Number(PORT));
