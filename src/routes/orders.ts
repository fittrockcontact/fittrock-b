import { Router, Request, Response } from 'express';
import { db } from '../lib/db/index.js';
import { orders, orderItems } from '../lib/db/schema.js';
import { eq, desc } from 'drizzle-orm';

const router = Router();

// GET /api/orders - List all orders (Admin / Service)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const allOrders = await db
      .select()
      .from(orders)
      .orderBy(desc(orders.placedAt));

    return res.json({ orders: allOrders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch orders';
    return res.status(500).json({ error: message });
  }
});

// GET /api/orders/:id - Get specific order by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    return res.json({ order: { ...order, items } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch order';
    return res.status(500).json({ error: message });
  }
});

export default router;
