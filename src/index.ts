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
import contactRouter from './routes/contact.js';
import newsletterRouter from './routes/newsletter.js';
import customersRouter from './routes/customers.js';
import cartRouter from './routes/cart.js';
import uploadRouter from './routes/upload.js';
import salesRouter from './routes/sales.js';
import { requireAdminAuth, requireSalesAuth } from './middleware/firebase-auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// CORS configuration supporting both fittrock.com and lowerdesk.com domains, previews, and dev
const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'https://fittrock.com',
  'https://www.fittrock.com',
  'https://admin.fittrock.com',
  'https://lowerdesk.com',
  'https://www.lowerdesk.com',
  'https://admin.lowerdesk.com',
  FRONTEND_URL,
  ...envAllowedOrigins,
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      
      const isAllowedExplicitly = defaultAllowedOrigins.includes(origin);
      const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      const isFittrockOrLowerdesk = /^https:\/\/([a-zA-Z0-9-]+\.)*(fittrock\.com|lowerdesk\.com)$/.test(origin);
      
      if (isAllowedExplicitly || isLocalhost || isFittrockOrLowerdesk) {
        callback(null, true);
      } else {
        // Allow in development or log in production
        callback(null, true);
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
app.use(express.static('public'));

// Root & Health Check Endpoints
app.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Lowerdesk / Fittrock API Server',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    domain: process.env.API_DOMAIN || 'api.lowerdesk.com',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/checkout', checkoutRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', requireAdminAuth, ordersRouter);
app.use('/api/discounts', discountsRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/admin', requireAdminAuth, adminRouter);
app.use('/api/contact', contactRouter);
app.use('/api/newsletter', newsletterRouter);
app.use('/api/customers', customersRouter);
app.use('/api/cart', cartRouter);
app.use('/api/upload', requireAdminAuth, uploadRouter);
app.use('/api/sales', requireSalesAuth, salesRouter);

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const startServer = (port: number, maxAttempts = 10) => {
  const server = app.listen(port, () => {
    console.log(`🚀 API Server running on port ${port}`);
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

// Only listen directly when running standalone (not in Vercel Serverless environment)
if (!process.env.VERCEL && !process.env.NOW_REGION && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  startServer(Number(PORT));
}

export default app;

