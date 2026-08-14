import { Router, Request, Response } from 'express';
import { db } from '../lib/db/index.js';
import { orders, products, customers, productVariants, productImages, reviews } from '../lib/db/schema.js';
import { desc, count, sql, eq } from 'drizzle-orm';
import { supabaseClient } from '../lib/db/supabase.js';
import { optionalFirebaseAuth } from '../middleware/firebase-auth.js';

const router = Router();
router.use(optionalFirebaseAuth);

// GET /api/admin/stats - get comprehensive dashboard metrics
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { count: ordsCount } = await supabaseClient.from('orders').select('*', { count: 'exact', head: true });
      const { count: prodsCount } = await supabaseClient.from('products').select('*', { count: 'exact', head: true });
      const { count: custsCount } = await supabaseClient.from('customers').select('*', { count: 'exact', head: true });
      const { count: revsCount } = await supabaseClient.from('reviews').select('*', { count: 'exact', head: true });

      const { data: revOrders } = await supabaseClient
        .from('orders')
        .select('total_amount, status');

      const { data: recOrders } = await supabaseClient
        .from('orders')
        .select('*')
        .order('placed_at', { ascending: false })
        .limit(6);

      const totalRev = (revOrders || [])
        .filter((o: any) => ['paid', 'shipped', 'delivered'].includes(o.status))
        .reduce((sum: number, o: any) => sum + parseFloat(o.total_amount || '0'), 0);

      const totalOrdersNum = ordsCount ?? 0;
      const aov = totalOrdersNum > 0 ? (totalRev / totalOrdersNum).toFixed(0) : '0';

      return res.json({
        stats: {
          totalOrders: totalOrdersNum,
          totalProducts: prodsCount ?? 0,
          totalCustomers: custsCount ?? 0,
          totalReviews: revsCount ?? 0,
          totalRevenue: totalRev.toFixed(2),
          aov,
          recentOrders: (recOrders || []).map((o: any) => ({
            id: o.id,
            orderNumber: o.order_number,
            totalAmount: o.total_amount,
            status: o.status,
            placedAt: o.placed_at,
          })),
        },
      });
    }

    const [ordersCount] = await db.select({ value: count() }).from(orders);
    const [productsCount] = await db.select({ value: count() }).from(products);
    const [customersCount] = await db.select({ value: count() }).from(customers);
    const [reviewsCount] = await db.select({ value: count() }).from(reviews);

    const [revenueResult] = await db
      .select({ total: sql<string>`coalesce(sum(${orders.totalAmount}), 0)` })
      .from(orders)
      .where(sql`${orders.status} IN ('paid', 'shipped', 'delivered')`);

    const recentOrders = await db
      .select()
      .from(orders)
      .orderBy(desc(orders.placedAt))
      .limit(6);

    const totalRevNum = parseFloat(revenueResult?.total ?? '0');
    const totalOrdersNum = ordersCount?.value ?? 0;
    const aov = totalOrdersNum > 0 ? (totalRevNum / totalOrdersNum).toFixed(0) : '0';

    return res.json({
      stats: {
        totalOrders: totalOrdersNum,
        totalProducts: productsCount?.value ?? 0,
        totalCustomers: customersCount?.value ?? 0,
        totalReviews: reviewsCount?.value ?? 0,
        totalRevenue: totalRevNum.toFixed(2),
        aov,
        recentOrders,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch admin stats';
    return res.status(500).json({ error: message });
  }
});

// GET /api/admin/products - list all products with variants & images for admin
router.get('/products', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data: prods, error: pErr } = await supabaseClient
        .from('products')
        .select('*, product_variants(*), product_images(*)')
        .order('created_at', { ascending: false });

      if (pErr) throw pErr;

      const formatted = (prods || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        name: p.title,
        slug: p.slug,
        description: p.description,
        status: p.status,
        brand: p.brand,
        avgRating: p.avg_rating,
        reviewCount: p.review_count,
        createdAt: p.created_at,
        variants: p.product_variants || [],
        images: p.product_images || [],
      }));

      return res.json({ products: formatted });
    }

    const allProducts = await db.select().from(products).orderBy(desc(products.createdAt));
    const allVariants = await db.select().from(productVariants);
    const allImages = await db.select().from(productImages);

    const result = allProducts.map((p) => ({
      ...p,
      name: p.title,
      variants: allVariants.filter((v) => v.productId === p.id),
      images: allImages.filter((img) => img.productId === p.id),
    }));

    return res.json({ products: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch admin products';
    return res.status(500).json({ error: message });
  }
});

// POST /api/admin/products - create product with variants & feature images
router.post('/products', async (req: Request, res: Response) => {
  try {
    const { title, slug, description, brand, status, variants: rawVariants, images: rawImages } = req.body;

    if (!title || !slug) {
      return res.status(400).json({ error: 'Title and Slug are required' });
    }

    if (supabaseClient) {
      const { data: newProd, error: prodErr } = await supabaseClient
        .from('products')
        .insert({
          title,
          slug,
          description: description || null,
          brand: brand || 'Fittrock',
          status: status || 'active',
        })
        .select()
        .single();

      if (prodErr) throw prodErr;

      if (Array.isArray(rawVariants) && rawVariants.length > 0) {
        const variantRows = rawVariants.map((v: any, idx: number) => ({
          product_id: newProd.id,
          sku: v.sku || `FT-${slug.toUpperCase()}-${idx + 1}`,
          title: `${v.color || 'Standard'} / ${v.size || 'Standard'}`,
          price: v.price || 0,
          compare_at_price: v.compareAtPrice || null,
          inventory_quantity: v.stockQuantity || 10,
          is_default: idx === 0,
        }));
        await supabaseClient.from('product_variants').insert(variantRows);
      }

      if (Array.isArray(rawImages) && rawImages.length > 0) {
        const imageRows = rawImages.map((img: any, idx: number) => ({
          product_id: newProd.id,
          url: img.url,
          alt_text: img.altText || title,
          sort_order: idx + 1,
          features: img.features || null,
        }));
        await supabaseClient.from('product_images').insert(imageRows);
      }

      return res.status(201).json({ product: newProd, message: 'Product created successfully' });
    }

    return res.status(200).json({ message: 'Product created' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create product';
    return res.status(500).json({ error: message });
  }
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    if (supabaseClient) {
      const { error } = await supabaseClient.from('products').delete().eq('id', id);
      if (error) throw error;
      return res.json({ success: true, message: 'Product deleted successfully' });
    }
    await db.delete(products).where(eq(products.id, id));
    return res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete product';
    return res.status(500).json({ error: message });
  }
});

// GET /api/admin/orders - list all orders
router.get('/orders', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data: ords, error: oErr } = await supabaseClient
        .from('orders')
        .select('*')
        .order('placed_at', { ascending: false });

      if (oErr) throw oErr;

      const { data: custs } = await supabaseClient.from('customers').select('id, email, first_name, last_name');
      const { data: items } = await supabaseClient.from('order_items').select('*');

      const custMap = new Map((custs || []).map((c: any) => [c.id, c]));
      const itemsMap = new Map<string, any[]>();
      (items || []).forEach((item: any) => {
        const list = itemsMap.get(item.order_id) || [];
        list.push(item);
        itemsMap.set(item.order_id, list);
      });

      const formatted = (ords || []).map((o: any) => ({
        ...o,
        customers: custMap.get(o.user_id) || null,
        order_items: itemsMap.get(o.id) || [],
      }));

      return res.json({ orders: formatted });
    }

    const allOrders = await db.select().from(orders).orderBy(desc(orders.placedAt));
    return res.json({ orders: allOrders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch admin orders';
    return res.status(500).json({ error: message });
  }
});

// PATCH /api/admin/orders/:id/status - update order status
router.patch('/orders/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    if (supabaseClient) {
      const { error } = await supabaseClient
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      return res.json({ success: true, message: `Order status updated to ${status}` });
    }

    await db.update(orders).set({ status, updatedAt: new Date() }).where(eq(orders.id, id));
    return res.json({ success: true, message: `Order status updated to ${status}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update order status';
    return res.status(500).json({ error: message });
  }
});

// GET /api/admin/reviews - list all reviews
router.get('/reviews', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data: revs, error: rErr } = await supabaseClient
        .from('reviews')
        .select('*, products(id, title, slug)')
        .order('created_at', { ascending: false });

      if (rErr) throw rErr;

      const formatted = (revs || []).map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        productTitle: r.products?.title || 'Fittrock Desk',
        productSlug: r.products?.slug || '',
        authorName: r.author_name || r.title || 'Verified Customer',
        authorRole: r.author_role || 'Verified Buyer',
        authorAvatar: r.author_avatar || '',
        rating: Number(r.rating) || 5,
        title: r.title || '',
        body: r.body || '',
        isVerifiedPurchase: r.is_verified_purchase ?? true,
        isApproved: r.is_approved ?? true,
        createdAt: r.created_at,
      }));

      return res.json({ reviews: formatted });
    }

    const allRevs = await db.select().from(reviews).orderBy(desc(reviews.createdAt));
    return res.json({ reviews: allRevs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch admin reviews';
    return res.status(500).json({ error: message });
  }
});

// POST /api/admin/reviews - add a new review / testimonial
router.post('/reviews', async (req: Request, res: Response) => {
  try {
    const { productId, authorName, authorRole, authorAvatar, rating, body, isVerifiedPurchase } = req.body;

    if (!productId || !authorName || !body) {
      return res.status(400).json({ error: 'Product, Author Name, and Review text are required' });
    }

    if (supabaseClient) {
      const { data: newRev, error: rErr } = await supabaseClient
        .from('reviews')
        .insert({
          product_id: productId,
          title: authorName,
          author_name: authorName,
          author_role: authorRole || 'Verified Buyer',
          author_avatar: authorAvatar || null,
          rating: Number(rating) || 5,
          body,
          is_verified_purchase: isVerifiedPurchase ?? true,
          is_approved: true,
        })
        .select()
        .single();

      if (rErr) throw rErr;
      return res.status(201).json({ review: newRev, message: 'Review added successfully' });
    }

    return res.status(200).json({ message: 'Review recorded' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to add review';
    return res.status(500).json({ error: message });
  }
});

// PATCH /api/admin/reviews/:id/approve - toggle approval status
router.patch('/reviews/:id/approve', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { isApproved } = req.body;

  try {
    if (supabaseClient) {
      const { error } = await supabaseClient
        .from('reviews')
        .update({ is_approved: isApproved })
        .eq('id', id);

      if (error) throw error;
      return res.json({ success: true, isApproved });
    }
    return res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update review approval';
    return res.status(500).json({ error: message });
  }
});

// DELETE /api/admin/reviews/:id
router.delete('/reviews/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    if (supabaseClient) {
      const { error } = await supabaseClient.from('reviews').delete().eq('id', id);
      if (error) throw error;
      return res.json({ success: true, message: 'Review deleted successfully' });
    }
    await db.delete(reviews).where(eq(reviews.id, id));
    return res.json({ success: true, message: 'Review deleted successfully' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete review';
    return res.status(500).json({ error: message });
  }
});

// GET /api/admin/customers - list customers with analytics
router.get('/customers', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data: custs, error: cErr } = await supabaseClient
        .from('customers')
        .select('*, orders(id, total_amount, status, placed_at)')
        .order('created_at', { ascending: false });

      if (cErr) throw cErr;

      const formatted = (custs || []).map((c: any) => {
        const cOrders = c.orders || [];
        const totalSpent = cOrders
          .filter((o: any) => ['paid', 'shipped', 'delivered'].includes(o.status))
          .reduce((sum: number, o: any) => sum + parseFloat(o.total_amount || '0'), 0);

        return {
          id: c.id,
          email: c.email,
          firstName: c.first_name || '',
          lastName: c.last_name || '',
          phone: c.phone || '',
          ordersCount: cOrders.length,
          totalSpent: (totalSpent / 100).toFixed(2),
          createdAt: c.created_at,
        };
      });

      return res.json({ customers: formatted });
    }

    const allCusts = await db.select().from(customers).orderBy(desc(customers.createdAt));
    return res.json({ customers: allCusts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch customers';
    return res.status(500).json({ error: message });
  }
});

export default router;
