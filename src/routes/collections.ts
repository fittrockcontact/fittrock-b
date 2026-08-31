import { Router, Request, Response } from 'express';
import { db } from '../lib/db/index.js';
import { collections, products, productCollections, productVariants, productImages } from '../lib/db/schema.js';
import { supabaseClient } from '../lib/db/supabase.js';
import { eq, inArray } from 'drizzle-orm';

const router = Router();

const DEFAULT_IMAGE = 'https://res.cloudinary.com/strangermingle/image/upload/v1775051643/Pune_Culture_hgjgum.webp';

function parsePrice(raw: any): number {
  if (!raw) return 0;
  const num = parseFloat(String(raw));
  return num > 100000 ? num / 100 : num;
}

// GET /api/collections - Fetch all active categories dynamically from Supabase database
router.get('/', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('categories')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      return res.json({ collections: data || [] });
    }

    const allCollections = await db
      .select()
      .from(collections)
      .where(eq(collections.isActive, true));

    return res.json({ collections: allCollections });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch collections from Supabase database';
    console.error('Error fetching collections from database:', message);
    return res.status(500).json({ error: message });
  }
});

// GET /api/collections/:slug - Fetch collection and its products dynamically from Supabase database
router.get('/:slug', async (req: Request, res: Response) => {
  const slugParam = req.params.slug;
  if (!slugParam) {
    return res.status(400).json({ error: 'Slug parameter is required' });
  }

  try {
    if (supabaseClient) {
      const { data: cols, error: cErr } = await supabaseClient
        .from('categories')
        .select('*')
        .eq('slug', slugParam);

      if (cErr) throw cErr;
      const col = cols?.[0];
      if (!col) {
        return res.status(404).json({ error: 'Collection not found in Supabase database' });
      }

      const { data: pcRows } = await supabaseClient
        .from('product_categories')
        .select('product_id')
        .eq('category_id', col.id);

      const productIds = (pcRows || []).map((r) => r.product_id);

      let colProducts: any[] = [];
      if (productIds.length > 0) {
        const { data: prods } = await supabaseClient
          .from('products')
          .select('*')
          .in('id', productIds)
          .eq('status', 'active');
        const { data: vars } = await supabaseClient.from('product_variants').select('*').in('product_id', productIds);
        const { data: imgs } = await supabaseClient.from('product_images').select('*').in('product_id', productIds);

        colProducts = (prods || []).map((p) => {
          const pVariants = (vars || []).filter((v) => v.product_id === p.id);
          const pImages = (imgs || []).filter((img) => img.product_id === p.id);

          const coverImageRow = pImages.find((img) => !img.variant_id) || pImages[0];
          const coverImage = coverImageRow?.url || DEFAULT_IMAGE;

          const defaultVariant = pVariants.find((v) => v.is_default) || pVariants[0];
          const basePriceNum = defaultVariant ? parsePrice(defaultVariant.price) : 0;
          const comparePriceNum = defaultVariant && defaultVariant.compare_at_price ? parsePrice(defaultVariant.compare_at_price) : undefined;

          return {
            id: p.id,
            name: p.title,
            title: p.title,
            slug: p.slug,
            description: p.description,
            basePrice: basePriceNum.toFixed(2),
            compareAtPrice: comparePriceNum ? comparePriceNum.toFixed(2) : undefined,
            imageUrl: coverImage,
            imageUrls: pImages.length > 0 ? pImages.map((i) => i.url) : [coverImage],
            variants: pVariants,
          };
        });
      }

      return res.json({ collection: { ...col, products: colProducts } });
    }

    const [col] = await db.select().from(collections).where(eq(collections.slug, slugParam));
    if (!col) {
      return res.status(404).json({ error: 'Collection not found in Supabase database' });
    }

    const rows = await db
      .select({ product: products })
      .from(productCollections)
      .innerJoin(products, eq(productCollections.productId, products.id))
      .where(eq(productCollections.collectionId, col.id));

    const productIds = rows.map((r) => r.product.id);

    let colProducts: any[] = [];
    if (productIds.length > 0) {
      const prods = await db.select().from(products).where(inArray(products.id, productIds));
      const variants = await db.select().from(productVariants).where(inArray(productVariants.productId, productIds));
      const images = await db.select().from(productImages).where(inArray(productImages.productId, productIds));

      colProducts = prods.map((p) => {
        const pVariants = variants.filter((v) => v.productId === p.id);
        const pImages = images.filter((img) => img.productId === p.id);

        const coverImageRow = pImages.find((img) => !img.variantId) || pImages[0];
        const coverImage = coverImageRow?.url || DEFAULT_IMAGE;

        const defaultVariant = pVariants.find((v) => v.isDefault) || pVariants[0];
        const basePriceNum = defaultVariant ? parsePrice(defaultVariant.price) : 0;
        const comparePriceNum = defaultVariant && defaultVariant.compareAtPrice ? parsePrice(defaultVariant.compareAtPrice) : undefined;

        return {
          id: p.id,
          name: p.title,
          title: p.title,
          slug: p.slug,
          description: p.description,
          basePrice: basePriceNum.toFixed(2),
          compareAtPrice: comparePriceNum ? comparePriceNum.toFixed(2) : undefined,
          imageUrl: coverImage,
          imageUrls: pImages.length > 0 ? pImages.map((i) => i.url) : [coverImage],
          variants: pVariants,
        };
      });
    }

    return res.json({
      collection: {
        ...col,
        products: colProducts,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch collection from Supabase database';
    console.error(`Error fetching collection ${slugParam} from database:`, message);
    return res.status(500).json({ error: message });
  }
});

export default router;
