import { db } from './index.js';
import {
  products,
  productVariants,
  collections,
  productCollections,
  discounts,
  reviews,
} from './schema.js';

const PUNE_CULTURE_IMAGE = 'https://res.cloudinary.com/strangermingle/image/upload/v1775051643/Pune_Culture_hgjgum.webp';

async function seed() {
  console.log('🌱 Starting database seeding for Supabase Cloud Database...');

  try {
    await db.delete(reviews);
    await db.delete(discounts);
    await db.delete(productCollections);
    await db.delete(productVariants);
    await db.delete(products);
    await db.delete(collections);
    console.log('Cleared existing catalog data.');

    const [standingDesks, ergoChairs] = await db
      .insert(collections)
      .values([
        {
          name: 'Standing Desks',
          slug: 'standing-desks',
          description: 'Dual-motor motorized height-adjustable standing desks designed for maximum posture health.',
          imageUrl: PUNE_CULTURE_IMAGE,
        },
        {
          name: 'Ergonomic Chairs',
          slug: 'ergonomic-chairs',
          description: 'Precision-engineered lumbar support chairs crafted for long hours of posture comfort.',
          imageUrl: PUNE_CULTURE_IMAGE,
        },
      ])
      .returning();

    const [deskProduct] = await db
      .insert(products)
      .values({
        title: 'Fittrock Pro Dual-Motor Standing Desk (Pune Culture Edition)',
        slug: 'fittrock-pro-standing-desk-pune-culture',
        description:
          'Fittrock flagship dual-motor electric standing desk featuring custom Pune Culture ergonomic tabletop finish. Ultra-silent dual motors (<42dB), 6-axis gyro anti-collision safety system, 4 digital memory presets, and 125kg load capacity with 10-Year Frame Warranty.',
        status: 'active',
      })
      .returning();

    await db.insert(productCollections).values({
      productId: deskProduct.id,
      collectionId: standingDesks.id,
    });

    await db.insert(productVariants).values([
      {
        productId: deskProduct.id,
        sku: 'FT-DESK-PUNE-140',
        title: 'Pune Culture Solid Oak / 140x70cm',
        price: '3499900',
        compareAtPrice: '4299900',
        inventoryQuantity: 25,
        isDefault: true,
      },
      {
        productId: deskProduct.id,
        sku: 'FT-DESK-PUNE-160',
        title: 'Pune Culture Dark Walnut / 160x80cm',
        price: '3999900',
        compareAtPrice: '4799900',
        inventoryQuantity: 15,
        isDefault: false,
      },
    ]);

    const [chairProduct] = await db
      .insert(products)
      .values({
        title: 'Fittrock Executive Ergonomic Chair (Pune Culture Edition)',
        slug: 'fittrock-executive-chair-pune-culture',
        description:
          'High-performance ergonomic office chair with dynamic self-adjusting lumbar support, breathable Italian mesh weave, 4D soft-padded armrests, adjustable headrest, and 135-degree synchro tilt mechanism.',
        status: 'active',
      })
      .returning();

    await db.insert(productCollections).values({
      productId: chairProduct.id,
      collectionId: ergoChairs.id,
    });

    await db.insert(productVariants).values([
      {
        productId: chairProduct.id,
        sku: 'FT-CHAIR-PUNE-BLK',
        title: 'Pune Culture Stealth Mesh / Universal High Back',
        price: '2199900',
        compareAtPrice: '2799900',
        inventoryQuantity: 18,
        isDefault: true,
      },
    ]);

    console.log('✅ Seeding completed successfully in Supabase database!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database seeding failed:', err);
    process.exit(1);
  }
}

seed();
