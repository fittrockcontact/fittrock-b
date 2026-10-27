import { Router, Request, Response } from 'express';
import { db } from '../lib/db/index.js';
import { orders, products, customers, productVariants, productImages, reviews, addresses, orderItems } from '../lib/db/schema.js';
import { desc, count, sql, eq } from 'drizzle-orm';
import { supabaseClient } from '../lib/db/supabase.js';

// Mounted behind requireAdminAuth in src/index.ts
const router = Router();

// GET /api/admin/stats - get comprehensive dashboard metrics
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { count: ordsCount } = await supabaseClient.from('orders').select('*', { count: 'exact', head: true });
      const { count: prodsCount } = await supabaseClient.from('products').select('*', { count: 'exact', head: true });
      const { count: custsCount } = await supabaseClient.from('profiles').select('*', { count: 'exact', head: true });
      const { count: revsCount } = await supabaseClient.from('reviews').select('*', { count: 'exact', head: true });

      const { data: revOrders } = await supabaseClient
        .from('orders')
        .select('total_amount, status');

      const { data: recOrders } = await supabaseClient
        .from('orders')
        .select('*')
        .order('placed_at', { ascending: false })
        .limit(6);

      const totalRevPaise = (revOrders || [])
        .filter((o: any) => ['paid', 'shipped', 'delivered'].includes(o.status))
        .reduce((sum: number, o: any) => sum + parseFloat(o.total_amount || '0'), 0);

      const totalRev = totalRevPaise > 100000 ? totalRevPaise / 100 : totalRevPaise;
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

    const rawTotalRevNum = parseFloat(revenueResult?.total ?? '0');
    const totalRevNum = rawTotalRevNum > 100000 ? rawTotalRevNum / 100 : rawTotalRevNum;
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

// GET /api/admin/products/:id - fetch single product for editing
router.get('/products/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    if (supabaseClient) {
      const { data: prod, error: pErr } = await supabaseClient
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

      if (pErr || !prod) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const { data: vars } = await supabaseClient
        .from('product_variants')
        .select('*')
        .eq('product_id', id);

      const { data: imgs } = await supabaseClient
        .from('product_images')
        .select('*')
        .eq('product_id', id)
        .order('sort_order', { ascending: true });

      return res.json({
        product: {
          ...prod,
          variants: (vars || []).map((v: any) => ({
            id: v.id,
            sku: v.sku,
            title: v.title,
            price: v.price > 100000 ? (v.price / 100).toFixed(0) : v.price,
            compareAtPrice: v.compare_at_price > 100000 ? (v.compare_at_price / 100).toFixed(0) : v.compare_at_price,
            stockQuantity: v.inventory_quantity ?? 0,
            isDefault: v.is_default,
          })),
          images: imgs || [],
        },
      });
    }

    const [prod] = await db.select().from(products).where(eq(products.id, id));
    if (!prod) return res.status(404).json({ error: 'Product not found' });
    const vars = await db.select().from(productVariants).where(eq(productVariants.productId, id));
    const imgs = await db.select().from(productImages).where(eq(productImages.productId, id));
    return res.json({ product: { ...prod, variants: vars, images: imgs } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch product';
    return res.status(500).json({ error: message });
  }
});

// PUT /api/admin/products/:id - update product details, variants and images
router.put('/products/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { title, slug, description, brand, status, variants: rawVariants, images: rawImages } = req.body;

    if (!title || !slug) {
      return res.status(400).json({ error: 'Title and Slug are required' });
    }

    if (supabaseClient) {
      const { data: updatedProd, error: pErr } = await supabaseClient
        .from('products')
        .update({
          title,
          slug,
          description: description || null,
          brand: brand || 'Fittrock',
          status: status || 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (pErr) throw pErr;

      // Update Variants
      if (Array.isArray(rawVariants)) {
        await supabaseClient.from('product_variants').delete().eq('product_id', id);

        if (rawVariants.length > 0) {
          const variantRows = rawVariants.map((v: any, idx: number) => {
            const rawPrice = parseFloat(v.price || '0');
            const pricePaise = rawPrice < 100000 ? Math.round(rawPrice * 100) : rawPrice;
            const rawComp = v.compareAtPrice ? parseFloat(v.compareAtPrice) : null;
            const compPaise = rawComp ? (rawComp < 100000 ? Math.round(rawComp * 100) : rawComp) : null;

            return {
              product_id: id,
              sku: v.sku || `FT-${slug.toUpperCase()}-${idx + 1}`,
              title: v.title || `${v.color || 'Standard'} / ${v.size || 'Standard'}`,
              price: pricePaise,
              compare_at_price: compPaise,
              inventory_quantity: Number(v.stockQuantity ?? v.inventory_quantity ?? 10),
              is_default: idx === 0 || v.isDefault,
            };
          });
          await supabaseClient.from('product_variants').insert(variantRows);
        }
      }

      // Update Images
      if (Array.isArray(rawImages)) {
        await supabaseClient.from('product_images').delete().eq('product_id', id);

        if (rawImages.length > 0) {
          const imageRows = rawImages.map((img: any, idx: number) => ({
            product_id: id,
            url: img.url,
            alt_text: img.altText || img.alt_text || title,
            sort_order: idx + 1,
            features: img.features || null,
          }));
          await supabaseClient.from('product_images').insert(imageRows);
        }
      }

      return res.json({ success: true, product: updatedProd, message: 'Product updated successfully' });
    }

    return res.json({ success: true, message: 'Product updated' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update product';
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

      const { data: profs } = await supabaseClient.from('profiles').select('*');
      let authMap = new Map<string, any>();
      try {
        const { data: authData } = await supabaseClient.auth.admin.listUsers();
        (authData?.users || []).forEach((u: any) => {
          authMap.set(u.id, u);
        });
      } catch (authErr) {
        console.warn('Could not list auth users in orders:', authErr);
      }

      const { data: items } = await supabaseClient.from('order_items').select('*');
      const { data: allShipments } = await supabaseClient.from('shipments').select('*');
      const shipmentMap = new Map<string, any[]>();
      (allShipments || []).forEach((sh: any) => {
        const list = shipmentMap.get(sh.order_id) || [];
        list.push(sh);
        shipmentMap.set(sh.order_id, list);
      });

      const custMap = new Map((profs || []).map((p: any) => {
        const authUser = authMap.get(p.id);
        const fullName = p.full_name || authUser?.user_metadata?.full_name || '';
        const nameParts = fullName.trim().split(' ');
        return [
          p.id,
          {
            id: p.id,
            first_name: nameParts[0] || '',
            last_name: nameParts.slice(1).join(' ') || '',
            email: authUser?.email || '',
            phone: p.phone || authUser?.phone || '',
          },
        ];
      }));

      const itemsMap = new Map<string, any[]>();
      (items || []).forEach((item: any) => {
        const list = itemsMap.get(item.order_id) || [];
        list.push(item);
        itemsMap.set(item.order_id, list);
      });

      const formatted = (ords || []).map((o: any) => {
        const rawTotal = parseFloat(o.total_amount || '0');
        const totalRupees = rawTotal > 100000 ? (rawTotal / 100).toFixed(0) : rawTotal;

        let customerInfo = custMap.get(o.user_id);
        if (!customerInfo && o.customer_note) {
          const parts = o.customer_note.split('|').map((s: string) => s.trim());
          const name = parts[0] || 'Customer';
          const email = parts[1] || '';
          const phone = parts[2] || '';
          customerInfo = {
            id: o.user_id,
            first_name: name.split(' ')[0] || name,
            last_name: name.split(' ').slice(1).join(' ') || '',
            email,
            phone,
          };
        }

        return {
          ...o,
          totalAmount: totalRupees,
          total_amount: totalRupees,
          customers: customerInfo || null,
          shipments: shipmentMap.get(o.id) || [],
          order_items: (itemsMap.get(o.id) || []).map((it: any) => {
            const rawUnit = parseFloat(it.unit_price || '0');
            const unitRupees = rawUnit > 100000 ? (rawUnit / 100).toFixed(0) : rawUnit;
            return {
              ...it,
              unitPrice: unitRupees,
              unit_price: unitRupees,
            };
          }),
        };
      });

      return res.json({ orders: formatted });
    }

    const allOrders = await db.select().from(orders).orderBy(desc(orders.placedAt));
    const allCustomers = await db.select().from(customers);
    const allOrderItems = await db.select().from(orderItems);

    const custMap = new Map(allCustomers.map((c) => {
      const nameParts = (c.fullName || '').trim().split(' ');
      return [
        c.id,
        {
          id: c.id,
          first_name: nameParts[0] || '',
          last_name: nameParts.slice(1).join(' ') || '',
          phone: c.phone || '',
        },
      ];
    }));

    const formatted = allOrders.map((o) => ({
      ...o,
      customers: o.userId ? custMap.get(o.userId) : null,
      order_items: allOrderItems.filter((item) => item.orderId === o.id),
      shipments: [],
    }));

    return res.json({ orders: formatted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch admin orders';
    return res.status(500).json({ error: message });
  }
});

// PATCH /api/admin/orders/:id/status - update order status and courier tracking
router.patch('/orders/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, carrierName, trackingNumber, trackingUrl } = req.body;

  try {
    if (supabaseClient) {
      const { error } = await supabaseClient
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      if (carrierName || trackingNumber || trackingUrl) {
        await supabaseClient.from('shipments').insert({
          order_id: id,
          carrier_name: carrierName || 'Courier Partner',
          tracking_number: trackingNumber || null,
          tracking_url: trackingUrl || null,
          status: status === 'delivered' ? 'delivered' : 'in_transit',
          shipped_at: new Date().toISOString(),
        });
      }

      return res.json({ success: true, message: `Order status updated to ${status}` });
    }

    await db.update(orders).set({ status, updatedAt: new Date() }).where(eq(orders.id, id));
    return res.json({ success: true, message: `Order status updated to ${status}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update order status';
    return res.status(500).json({ error: message });
  }
});

// GET /api/admin/inventory - list all variants across catalog with live stock
router.get('/inventory', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data: prods } = await supabaseClient.from('products').select('id, title, slug, status');
      const { data: vars, error: vErr } = await supabaseClient
        .from('product_variants')
        .select('*')
        .order('created_at', { ascending: false });

      if (vErr) throw vErr;

      const prodMap = new Map((prods || []).map((p: any) => [p.id, p]));

      const inventoryList = (vars || []).map((v: any) => {
        const prod = prodMap.get(v.product_id);
        const priceNum = parseFloat(v.price || '0');
        const compareNum = parseFloat(v.compare_at_price || '0');

        return {
          id: v.id,
          productId: v.product_id,
          productTitle: prod?.title || 'Desk / Accessory',
          productSlug: prod?.slug || '',
          productStatus: prod?.status || 'active',
          sku: v.sku,
          title: v.title || 'Standard',
          price: priceNum > 100000 ? (priceNum / 100).toFixed(0) : priceNum.toFixed(0),
          compareAtPrice: compareNum > 100000 ? (compareNum / 100).toFixed(0) : (compareNum > 0 ? compareNum.toFixed(0) : null),
          stockQuantity: v.inventory_quantity ?? 0,
          inventoryQuantity: v.inventory_quantity ?? 0,
          isDefault: v.is_default ?? false,
          updatedAt: v.updated_at,
        };
      });

      return res.json({ inventory: inventoryList });
    }

    return res.json({ inventory: [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch inventory';
    return res.status(500).json({ error: message });
  }
});

// PATCH /api/admin/inventory/:variantId - quick update stock quantity
router.patch('/inventory/:variantId', async (req: Request, res: Response) => {
  const { variantId } = req.params;
  const { stockQuantity, inventoryQuantity } = req.body;

  const newStock = Number(stockQuantity !== undefined ? stockQuantity : inventoryQuantity);
  if (isNaN(newStock) || newStock < 0) {
    return res.status(400).json({ error: 'Valid non-negative stock quantity is required' });
  }

  try {
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('product_variants')
        .update({
          inventory_quantity: newStock,
          updated_at: new Date().toISOString(),
        })
        .eq('id', variantId)
        .select()
        .single();

      if (error) throw error;
      return res.json({ success: true, variant: data, message: 'Stock quantity updated successfully' });
    }

    return res.json({ success: true, message: 'Stock updated' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update stock quantity';
    return res.status(500).json({ error: message });
  }
});

// GET /api/admin/discounts - list all discount coupons
router.get('/discounts', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data: dList, error } = await supabaseClient
        .from('discounts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formatted = (dList || []).map((d: any) => ({
        id: d.id,
        code: d.code,
        description: d.description,
        type: d.type,
        value: parseFloat(d.value || '0'),
        minOrderAmount: d.min_order_amount ? parseFloat(d.min_order_amount) : 0,
        maxDiscountAmount: d.max_discount_amount ? parseFloat(d.max_discount_amount) : null,
        usageLimitTotal: d.usage_limit_total,
        usageLimitPerUser: d.usage_limit_per_user,
        isActive: d.is_active ?? true,
        startsAt: d.starts_at,
        endsAt: d.ends_at,
        createdAt: d.created_at,
      }));

      return res.json({ discounts: formatted });
    }

    return res.json({ discounts: [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch discounts';
    return res.status(500).json({ error: message });
  }
});

// POST /api/admin/discounts - create new discount promo code
router.post('/discounts', async (req: Request, res: Response) => {
  try {
    const {
      code,
      description,
      type,
      value,
      minOrderAmount,
      maxDiscountAmount,
      usageLimitTotal,
      startsAt,
      endsAt,
      isActive,
    } = req.body;

    if (!code || value === undefined || value === null) {
      return res.status(400).json({ error: 'Coupon code and discount value are required' });
    }

    const normalizedCode = String(code).trim().toUpperCase();
    const discountType = type === 'fixed_amount' ? 'fixed_amount' : 'percentage';

    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('discounts')
        .insert({
          code: normalizedCode,
          description: description || null,
          type: discountType,
          value: parseFloat(value),
          min_order_amount: minOrderAmount ? parseFloat(minOrderAmount) : 0,
          max_discount_amount: maxDiscountAmount ? parseFloat(maxDiscountAmount) : null,
          usage_limit_total: usageLimitTotal ? parseInt(usageLimitTotal) : null,
          starts_at: startsAt || new Date().toISOString(),
          ends_at: endsAt || null,
          is_active: isActive !== undefined ? Boolean(isActive) : true,
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ success: true, discount: data, message: 'Discount coupon created successfully' });
    }

    return res.status(200).json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create discount';
    return res.status(500).json({ error: message });
  }
});

// PATCH /api/admin/discounts/:id - update or toggle active state
router.patch('/discounts/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    if (supabaseClient) {
      const updateData: any = {};
      if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
      if (updates.is_active !== undefined) updateData.is_active = updates.is_active;
      if (updates.value !== undefined) updateData.value = parseFloat(updates.value);
      if (updates.minOrderAmount !== undefined) updateData.min_order_amount = parseFloat(updates.minOrderAmount);
      if (updates.code !== undefined) updateData.code = String(updates.code).trim().toUpperCase();
      if (updates.description !== undefined) updateData.description = updates.description;

      const { data, error } = await supabaseClient
        .from('discounts')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.json({ success: true, discount: data, message: 'Discount updated' });
    }

    return res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update discount';
    return res.status(500).json({ error: message });
  }
});

// DELETE /api/admin/discounts/:id - delete discount code
router.delete('/discounts/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    if (supabaseClient) {
      const { error } = await supabaseClient.from('discounts').delete().eq('id', id);
      if (error) throw error;
      return res.json({ success: true, message: 'Discount coupon deleted' });
    }
    return res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete discount';
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

// GET /api/admin/customers - list customers with analytics, orders & addresses
router.get('/customers', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data: profs, error: pErr } = await supabaseClient
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (pErr) throw pErr;

      // Fetch Auth Users to get email addresses & creation timestamps
      const authMap = new Map<string, any>();
      try {
        const { data: authData } = await supabaseClient.auth.admin.listUsers();
        (authData?.users || []).forEach((u: any) => {
          authMap.set(u.id, u);
        });
      } catch (authErr) {
        console.warn('Could not list auth users from Supabase Admin:', authErr);
      }

      // Fetch all orders & addresses to aggregate lifetime customer value
      const { data: allOrders } = await supabaseClient.from('orders').select('*').order('placed_at', { ascending: false });
      const { data: allAddresses } = await supabaseClient.from('addresses').select('*').order('is_default', { ascending: false });

      const ordersByUser = new Map<string, any[]>();
      (allOrders || []).forEach((o: any) => {
        if (o.user_id) {
          const list = ordersByUser.get(o.user_id) || [];
          list.push(o);
          ordersByUser.set(o.user_id, list);
        }
      });

      const addressesByUser = new Map<string, any[]>();
      (allAddresses || []).forEach((a: any) => {
        if (a.user_id) {
          const list = addressesByUser.get(a.user_id) || [];
          list.push(a);
          addressesByUser.set(a.user_id, list);
        }
      });

      const processedUserIds = new Set<string>();

      const formatted = (profs || []).map((p: any) => {
        processedUserIds.add(p.id);
        const authUser = authMap.get(p.id);
        const cOrders = ordersByUser.get(p.id) || [];
        const cAddresses = addressesByUser.get(p.id) || [];

        const totalSpentPaise = cOrders
          .filter((o: any) => ['paid', 'shipped', 'delivered'].includes(o.status))
          .reduce((sum: number, o: any) => sum + parseFloat(o.total_amount || '0'), 0);

        const fullName = p.full_name || authUser?.user_metadata?.full_name || '';
        const nameParts = fullName.trim().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        const email = authUser?.email || '';
        const phone = p.phone || authUser?.phone || cAddresses[0]?.phone || '';

        return {
          id: p.id,
          email,
          fullName: fullName || 'Verified Customer',
          firstName,
          lastName,
          phone,
          avatarUrl: p.avatar_url || authUser?.user_metadata?.avatar_url || null,
          isBusiness: p.is_business ?? false,
          gstNumber: p.gst_number || null,
          businessName: p.business_name || null,
          marketingOptIn: p.marketing_opt_in ?? true,
          ordersCount: cOrders.length,
          totalSpent: (totalSpentPaise > 100000 ? totalSpentPaise / 100 : totalSpentPaise).toFixed(2),
          orders: cOrders.map((o: any) => ({
            id: o.id,
            orderNumber: o.order_number,
            totalAmount: o.total_amount,
            status: o.status,
            placedAt: o.placed_at,
          })),
          addresses: cAddresses,
          createdAt: p.created_at || authUser?.created_at || new Date().toISOString(),
          updatedAt: p.updated_at || null,
        };
      });

      // Also include any auth users that don't have a profile record yet
      authMap.forEach((authUser, uid) => {
        if (!processedUserIds.has(uid)) {
          processedUserIds.add(uid);
          const cOrders = ordersByUser.get(uid) || [];
          const cAddresses = addressesByUser.get(uid) || [];

          const totalSpentPaise = cOrders
            .filter((o: any) => ['paid', 'shipped', 'delivered'].includes(o.status))
            .reduce((sum: number, o: any) => sum + parseFloat(o.total_amount || '0'), 0);

          const fullName = authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Customer';
          const nameParts = fullName.trim().split(' ');

          formatted.push({
            id: uid,
            email: authUser.email || '',
            fullName,
            firstName: nameParts[0] || '',
            lastName: nameParts.slice(1).join(' ') || '',
            phone: authUser.phone || cAddresses[0]?.phone || '',
            avatarUrl: authUser.user_metadata?.avatar_url || null,
            isBusiness: false,
            gstNumber: null,
            businessName: null,
            marketingOptIn: true,
            ordersCount: cOrders.length,
            totalSpent: (totalSpentPaise > 100000 ? totalSpentPaise / 100 : totalSpentPaise).toFixed(2),
            orders: cOrders.map((o: any) => ({
              id: o.id,
              orderNumber: o.order_number,
              totalAmount: o.total_amount,
              status: o.status,
              placedAt: o.placed_at,
            })),
            addresses: cAddresses,
            createdAt: authUser.created_at || new Date().toISOString(),
            updatedAt: null,
          });
        }
      });

      return res.json({ customers: formatted });
    }

    const allCusts = await db.select().from(customers).orderBy(desc(customers.createdAt));
    const allOrders = await db.select().from(orders);
    const allAddresses = await db.select().from(addresses);

    const formatted = allCusts.map((c) => {
      const cOrders = allOrders.filter((o) => o.userId === c.id);
      const cAddresses = allAddresses.filter((a) => a.userId === c.id);
      const totalSpentPaise = cOrders
        .filter((o) => ['paid', 'shipped', 'delivered'].includes(o.status))
        .reduce((sum, o) => sum + parseFloat(o.totalAmount || '0'), 0);

      const fullName = c.fullName || 'Customer';
      const nameParts = fullName.trim().split(' ');

      return {
        id: c.id,
        email: '',
        fullName,
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        phone: c.phone || '',
        avatarUrl: c.avatarUrl || null,
        isBusiness: c.isBusiness ?? false,
        gstNumber: c.gstNumber || null,
        businessName: c.businessName || null,
        marketingOptIn: c.marketingOptIn ?? true,
        ordersCount: cOrders.length,
        totalSpent: (totalSpentPaise > 100000 ? totalSpentPaise / 100 : totalSpentPaise).toFixed(2),
        orders: cOrders,
        addresses: cAddresses,
        createdAt: c.createdAt.toISOString(),
      };
    });

    return res.json({ customers: formatted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch customers';
    console.error('Error fetching admin customers:', err);
    return res.status(500).json({ error: message });
  }
});

// GET /api/admin/customers/:id - get single customer profile details
router.get('/customers/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    if (supabaseClient) {
      const { data: prof } = await supabaseClient.from('profiles').select('*').eq('id', id).single();
      
      let authUser: any = null;
      try {
        const { data: uData } = await supabaseClient.auth.admin.getUserById(id);
        authUser = uData?.user || null;
      } catch (e) {
        console.warn('Error fetching auth user by id:', e);
      }

      const { data: userOrders } = await supabaseClient
        .from('orders')
        .select('*, order_items(*)')
        .eq('user_id', id)
        .order('placed_at', { ascending: false });

      const { data: userAddresses } = await supabaseClient
        .from('addresses')
        .select('*')
        .eq('user_id', id)
        .order('is_default', { ascending: false });

      const fullName = prof?.full_name || authUser?.user_metadata?.full_name || 'Customer';
      const nameParts = fullName.trim().split(' ');

      const totalSpentPaise = (userOrders || [])
        .filter((o: any) => ['paid', 'shipped', 'delivered'].includes(o.status))
        .reduce((sum: number, o: any) => sum + parseFloat(o.total_amount || '0'), 0);

      const customerProfile = {
        id,
        email: authUser?.email || '',
        fullName,
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        phone: prof?.phone || authUser?.phone || userAddresses?.[0]?.phone || '',
        avatarUrl: prof?.avatar_url || authUser?.user_metadata?.avatar_url || null,
        isBusiness: prof?.is_business ?? false,
        gstNumber: prof?.gst_number || null,
        businessName: prof?.business_name || null,
        marketingOptIn: prof?.marketing_opt_in ?? true,
        ordersCount: (userOrders || []).length,
        totalSpent: (totalSpentPaise > 100000 ? totalSpentPaise / 100 : totalSpentPaise).toFixed(2),
        orders: userOrders || [],
        addresses: userAddresses || [],
        createdAt: prof?.created_at || authUser?.created_at || new Date().toISOString(),
        updatedAt: prof?.updated_at || null,
      };

      return res.json({ customer: customerProfile });
    }

    const [prof] = await db.select().from(customers).where(eq(customers.id, id));
    const userOrders = await db.select().from(orders).where(eq(orders.userId, id));
    const userAddresses = await db.select().from(addresses).where(eq(addresses.userId, id));

    return res.json({
      customer: {
        ...prof,
        orders: userOrders,
        addresses: userAddresses,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch customer profile';
    return res.status(500).json({ error: message });
  }
});

export default router;

