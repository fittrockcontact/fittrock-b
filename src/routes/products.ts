import { Router, Request, Response } from 'express';
import { db } from '../lib/db/index.js';
import { products, productVariants, productImages, reviews } from '../lib/db/schema.js';
import { supabaseClient } from '../lib/db/supabase.js';
import { eq } from 'drizzle-orm';

const router = Router();

const DEFAULT_IMAGE = 'https://res.cloudinary.com/strangermingle/image/upload/v1775051643/Pune_Culture_hgjgum.webp';

function parsePrice(raw: any): number {
  if (!raw) return 0;
  const num = parseFloat(String(raw));
  return num > 100000 ? num / 100 : num;
}

function formatProduct(productRow: any, allVariants: any[], allImages: any[], allReviews: any[] = []) {
  const pVariants = allVariants.filter((v) => v.product_id === productRow.id || v.productId === productRow.id);
  const pImages = allImages.filter((img) => img.product_id === productRow.id || img.productId === productRow.id);
  const pReviews = allReviews.filter((r) => r.product_id === productRow.id || r.productId === productRow.id);

  const formattedReviews = pReviews.map((r: any) => ({
    id: r.id,
    customerName: r.author_name || r.authorName || r.title || 'Verified Customer',
    name: r.author_name || r.authorName || r.title || 'Verified Customer',
    role: r.author_role || r.authorRole || 'Verified Buyer',
    jobTitle: r.author_role || r.authorRole || 'Verified Buyer',
    avatar: r.author_avatar || r.authorAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    title: r.title || 'Verified Review',
    rating: Number(r.rating) || 5,
    comment: r.body || '',
    body: r.body || '',
    isVerifiedPurchase: r.is_verified_purchase ?? r.isVerifiedPurchase ?? true,
    createdAt: r.created_at || r.createdAt,
  }));

  // Cover Image: Image without a specific variant_id, or fallback to first product image
  const coverImageRow = pImages.find((img) => !img.variant_id && !img.variantId) || pImages[0];
  const coverImage = coverImageRow?.url || DEFAULT_IMAGE;

  const defaultVariant = pVariants.find((v) => v.is_default || v.isDefault) || pVariants[0];
  const basePriceNum = defaultVariant ? parsePrice(defaultVariant.price) : 0;
  const comparePriceNum = defaultVariant && (defaultVariant.compare_at_price || defaultVariant.compareAtPrice)
    ? parsePrice(defaultVariant.compare_at_price || defaultVariant.compareAtPrice)
    : undefined;

  const formattedVariants = pVariants.map((v) => {
    const vImageObjects = pImages.filter((img) => img.variant_id === v.id || img.variantId === v.id);
    const vImages = vImageObjects.map((img) => img.url);
    const vPrice = parsePrice(v.price);
    const rawCompare = v.compare_at_price || v.compareAtPrice;
    const vCompare = rawCompare ? parsePrice(rawCompare) : undefined;

    const variantImagesList = vImages.length > 0 ? vImages : [coverImage];

    const vFeatures = vImageObjects
      .filter((img) => img.features && (Array.isArray(img.features) ? img.features.length > 0 : (img.features.highlights?.length > 0 || img.features.title)))
      .map((img) => ({
        id: img.id,
        imageUrl: img.url,
        title: img.features.title || 'Product Feature',
        subtitle: img.features.subtitle || '',
        highlights: Array.isArray(img.features) ? img.features : img.features.highlights || [],
      }));

    return {
      id: v.id,
      sku: v.sku,
      title: v.title,
      name: productRow.title,
      color: v.title ? v.title.split('/')[0]?.trim() : 'Default Color',
      size: v.title ? v.title.split('/')[1]?.trim() : 'Standard',
      price: vPrice.toFixed(2),
      compareAtPrice: vCompare ? vCompare.toFixed(2) : undefined,
      stockQuantity: v.inventory_quantity ?? v.inventoryQuantity ?? 10,
      imageUrl: vImages[0] || coverImage,
      imageUrls: variantImagesList,
      features: vFeatures,
      featureShowcases: vFeatures,
      isDefault: v.is_default || v.isDefault,
    };
  });

  const allImagesCombined = pImages.map((img) => img.url);

  const formattedImages = pImages.map((img) => ({
    id: img.id,
    productId: img.product_id || img.productId,
    variantId: img.variant_id || img.variantId || null,
    url: img.url,
    altText: img.alt_text || img.altText || null,
    sortOrder: img.sort_order ?? img.sortOrder ?? 0,
    features: img.features || null,
  }));

  const featureShowcases = pImages
    .filter((img) => img.features && (Array.isArray(img.features) ? img.features.length > 0 : (img.features.highlights?.length > 0 || img.features.title)))
    .map((img) => ({
      id: img.id,
      imageUrl: img.url,
      title: img.features.title || 'Product Feature',
      subtitle: img.features.subtitle || '',
      highlights: Array.isArray(img.features) ? img.features : img.features.highlights || [],
    }));

  return {
    id: productRow.id,
    name: productRow.title,
    title: productRow.title,
    slug: productRow.slug,
    description: productRow.description,
    brand: productRow.brand,
    basePrice: basePriceNum.toFixed(2),
    compareAtPrice: comparePriceNum ? comparePriceNum.toFixed(2) : undefined,
    imageUrl: coverImage,
    imageUrls: allImagesCombined.length > 0 ? allImagesCombined : [coverImage],
    images: formattedImages,
    featureShowcases,
    features: featureShowcases,
    variants: formattedVariants,
    reviews: formattedReviews,
  };
}

// GET /api/products - Fetch all active products dynamically from Supabase database
router.get('/', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data: prods, error: pErr } = await supabaseClient
        .from('products')
        .select('*')
        .eq('status', 'active');

      if (pErr) throw pErr;

      const { data: vars } = await supabaseClient.from('product_variants').select('*');
      const { data: imgs } = await supabaseClient.from('product_images').select('*');
      const { data: revs } = await supabaseClient.from('reviews').select('*').order('created_at', { ascending: false });

      const result = (prods || []).map((p) => formatProduct(p, vars || [], imgs || [], revs || []));
      return res.json({ products: result });
    }

    const allProducts = await db.select().from(products).where(eq(products.status, 'active'));
    const allVariants = await db.select().from(productVariants);
    const allImages = await db.select().from(productImages);
    const allReviews = await db.select().from(reviews);

    const result = allProducts.map((p) => formatProduct(p, allVariants, allImages, allReviews));
    return res.json({ products: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch products from Supabase database';
    console.error('Error fetching products from database:', message);
    return res.status(500).json({ error: message });
  }
});

// GET /api/products/testimonials/all - Fetch all approved customer reviews across catalog
router.get('/testimonials/all', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data: revs, error: rErr } = await supabaseClient
        .from('reviews')
        .select('*, products(id, title, slug)')
        .order('created_at', { ascending: false });

      if (rErr) throw rErr;

      const formatted = (revs || []).map((r: any) => ({
        id: r.id,
        name: r.author_name || r.title || 'Verified Customer',
        customerName: r.author_name || r.title || 'Verified Customer',
        role: r.author_role || 'Verified Buyer',
        jobTitle: r.author_role || 'Verified Buyer',
        avatar: r.author_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
        rating: Number(r.rating) || 5,
        comment: r.body || '',
        body: r.body || '',
        productName: r.products?.title || 'Fittrock Ergonomics',
        productSlug: r.products?.slug || 'fittrock-pro-motorized-standing-table',
        isVerifiedPurchase: r.is_verified_purchase ?? true,
        createdAt: r.created_at,
      }));

      return res.json({ reviews: formatted });
    }

    const allRevs = await db.select().from(reviews);
    const allProds = await db.select().from(products);
    const prodMap = new Map(allProds.map((p) => [p.id, p]));

    const formatted = allRevs.map((r) => {
      const p = prodMap.get(r.productId);
      return {
        id: r.id,
        name: r.authorName || r.title || 'Verified Customer',
        customerName: r.authorName || r.title || 'Verified Customer',
        role: r.authorRole || 'Verified Buyer',
        jobTitle: r.authorRole || 'Verified Buyer',
        avatar: r.authorAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
        rating: Number(r.rating) || 5,
        comment: r.body || '',
        body: r.body || '',
        productName: p?.title || 'Fittrock Ergonomics',
        productSlug: p?.slug || 'fittrock-pro-motorized-standing-table',
        isVerifiedPurchase: r.isVerifiedPurchase ?? true,
        createdAt: r.createdAt,
      };
    });

    return res.json({ reviews: formatted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch testimonials';
    return res.status(500).json({ error: message });
  }
});

// POST /api/products/reviews/new - Submit a new review directly to Supabase database
router.post('/reviews/new', async (req: Request, res: Response) => {
  try {
    const { name, authorName, rating, title, body, comment, productId } = req.body;

    const customerName = (name || authorName || '').trim();
    const reviewText = (body || comment || '').trim();
    const starRating = Math.max(1, Math.min(5, Number(rating) || 5));
    const reviewTitle = (title || 'Customer Review').trim();

    if (!customerName) {
      return res.status(400).json({ error: 'Please provide your name.' });
    }
    if (!reviewText) {
      return res.status(400).json({ error: 'Please provide review comments.' });
    }

    const defaultAvatars = [
      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80',
      'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=200&q=80',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80',
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
    ];
    const avatar = defaultAvatars[Math.floor(Math.random() * defaultAvatars.length)];

    if (supabaseClient) {
      // Find a default product_id if not provided
      let targetProductId = productId;
      if (!targetProductId) {
        const { data: firstProd } = await supabaseClient.from('products').select('id').limit(1).single();
        targetProductId = firstProd?.id;
      }

      const { data: newReview, error: insertError } = await supabaseClient
        .from('reviews')
        .insert({
          product_id: targetProductId,
          author_name: customerName,
          author_role: 'Verified Customer',
          author_avatar: avatar,
          rating: starRating,
          title: reviewTitle,
          body: reviewText,
          is_approved: true,
          is_verified_purchase: true,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      return res.status(201).json({
        success: true,
        message: 'Review submitted successfully!',
        review: {
          id: newReview.id,
          name: newReview.author_name,
          customerName: newReview.author_name,
          role: newReview.author_role,
          avatar: newReview.author_avatar,
          rating: newReview.rating,
          comment: newReview.body,
          body: newReview.body,
          createdAt: newReview.created_at,
        },
      });
    }

    const [inserted] = await db
      .insert(reviews)
      .values({
        productId: productId || 'e3ad2658-600b-4f9d-a418-b009d70f6239',
        authorName: customerName,
        authorRole: 'Verified Customer',
        authorAvatar: avatar,
        rating: starRating,
        title: reviewTitle,
        body: reviewText,
        isApproved: true,
        isVerifiedPurchase: true,
      })
      .returning();

    return res.status(201).json({
      success: true,
      message: 'Review submitted successfully!',
      review: inserted,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to submit review';
    console.error('Error submitting review to Supabase:', message);
    return res.status(500).json({ error: message });
  }
});

// GET /api/products/:slug - Fetch product by slug dynamically from Supabase database
router.get('/:slug', async (req: Request, res: Response) => {
  const slugParam = req.params.slug;
  if (!slugParam) {
    return res.status(400).json({ error: 'Slug parameter is required' });
  }

  try {
    if (supabaseClient) {
      const { data: prods, error: pErr } = await supabaseClient
        .from('products')
        .select('*')
        .eq('slug', slugParam);

      if (pErr) throw pErr;
      const productRow = prods?.[0];
      if (!productRow) {
        return res.status(404).json({ error: 'Product not found in Supabase database' });
      }

      const { data: vars } = await supabaseClient.from('product_variants').select('*').eq('product_id', productRow.id);
      const { data: imgs } = await supabaseClient.from('product_images').select('*').eq('product_id', productRow.id);
      const { data: revs } = await supabaseClient.from('reviews').select('*').eq('product_id', productRow.id).order('created_at', { ascending: false });

      const formatted = formatProduct(productRow, vars || [], imgs || [], revs || []);
      return res.json({ product: formatted });
    }

    const [productRow] = await db.select().from(products).where(eq(products.slug, slugParam));
    if (!productRow) {
      return res.status(404).json({ error: 'Product not found in Supabase database' });
    }

    const pVariants = await db.select().from(productVariants).where(eq(productVariants.productId, productRow.id));
    const pImages = await db.select().from(productImages).where(eq(productImages.productId, productRow.id));
    const pReviews = await db.select().from(reviews).where(eq(reviews.productId, productRow.id));

    const formatted = formatProduct(productRow, pVariants, pImages, pReviews);
    return res.json({ product: formatted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch product from Supabase database';
    console.error(`Error fetching product ${slugParam} from database:`, message);
    return res.status(500).json({ error: message });
  }
});

export default router;

