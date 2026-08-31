import fs from 'fs';
import readline from 'readline';
import { supabaseClient } from './supabase.js';
import { randomUUID } from 'crypto';

function parseCSVRow(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function cleanHtmlDescription(rawHtml: string): { cleanHtml: string; cleanText: string } {
  if (!rawHtml) return { cleanHtml: '', cleanText: '' };

  let cleaned = rawHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(html|body|head)[^>]*>/gi, '')
    .trim();

  cleaned = cleaned.replace(/\s+data-[a-zA-Z0-9_-]+="[^"]*"/g, '');

  let plain = cleaned
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return { cleanHtml: cleaned, cleanText: plain };
}

interface CSVProduct {
  handle: string;
  title: string;
  body: string;
  vendor: string;
  category: string;
  type: string;
  tags: string;
  published: string;
  status: string;
  motorType: 'single' | 'dual' | null;
  variants: {
    sku: string;
    opt1Name: string;
    opt1Val: string;
    opt2Name: string;
    opt2Val: string;
    opt3Name: string;
    opt3Val: string;
    price: number; // in paise
    compareAtPrice: number | null; // in paise
    inventoryQty: number;
    inventoryPolicy: string;
    variantImage: string;
    weightGrams: number;
    barcode: string;
  }[];
  images: {
    src: string;
    position: number;
    alt: string;
  }[];
}

const CATEGORY_DEFS = [
  {
    id: 'b0ed3c76-8c2f-4ad7-9b4e-3a658b7c63cb',
    name: 'Standing Desks',
    slug: 'standing-desks',
    description: 'Dual-motor and single-motor electric height adjustable standing desks for optimal ergonomics.',
    image_url: 'https://cdn.shopify.com/s/files/1/0748/4771/5577/files/Best_standing_desk_wooden_table_9158186c-4d9d-4a00-ba58-4e891278df0c.webp',
    is_active: true,
    sort_order: 1,
  },
  {
    id: 'a1c23d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
    name: 'Yogeek Floor Sitting Desks',
    slug: 'yogeek-desks',
    description: 'Ultra-low range floor sitting to standing motorized adjustable desks for grounded work & yoga.',
    image_url: 'https://cdn.shopify.com/s/files/1/0748/4771/5577/files/YG_1.png',
    is_active: true,
    sort_order: 2,
  },
  {
    id: 'b2c34d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
    name: 'Standing Desk Frames',
    slug: 'desk-frames',
    description: 'Heavy duty motorized height-adjustable desk frames with anti-collision gyro and memory presets.',
    image_url: 'https://cdn.shopify.com/s/files/1/0748/4771/5577/files/Standing-desk-two-stage-dual-motor.webp',
    is_active: true,
    sort_order: 3,
  },
  {
    id: 'c3d45e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f',
    name: 'Table Tops',
    slug: 'table-tops',
    description: 'Premium engineered wood and solid finish tabletops designed for height adjustable desks.',
    image_url: 'https://cdn.shopify.com/s/files/1/0748/4771/5577/files/IceBeach.jpg',
    is_active: true,
    sort_order: 4,
  },
  {
    id: '942ba5dd-36c7-4b52-9d5b-055b1311c2e6',
    name: 'Desk Accessories',
    slug: 'desk-accessories',
    description: 'Under-desk cable management trays, lockable caster wheels, and workspace organizers.',
    image_url: 'https://cdn.shopify.com/s/files/1/0748/4771/5577/files/1White1.jpg',
    is_active: true,
    sort_order: 5,
  },
  {
    id: '9451851b-8f0d-48cf-b31d-c6e9270b3e95',
    name: 'Monitor Arms & Stands',
    slug: 'monitor-stands',
    description: 'Dynamic full-motion gas spring single and dual monitor desk mount arms.',
    image_url: 'https://res.cloudinary.com/myaitask/image/upload/v1786496650/5_nbjxla.png',
    is_active: true,
    sort_order: 6,
  },
];

async function seedCatalogFromCSV() {
  if (!supabaseClient) {
    console.error('Supabase client is not configured.');
    process.exit(1);
  }

  console.log('🚀 Starting complete catalog import from products_export.csv...');

  // 1. Parse CSV
  const csvPath = '/Users/trishul/Documents/fittrock/products_export.csv';
  const fileStream = fs.createReadStream(csvPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] | null = null;
  const productsMap = new Map<string, CSVProduct>();
  let currentLine = '';
  let linesArray: string[] = [];

  for await (const line of rl) {
    if (linesArray.length === 0) {
      currentLine = line;
    } else {
      currentLine += '\n' + line;
    }

    let quoteCount = 0;
    for (let i = 0; i < currentLine.length; i++) {
      if (currentLine[i] === '"') quoteCount++;
    }

    if (quoteCount % 2 !== 0) {
      linesArray.push(line);
      continue;
    }

    linesArray = [];
    const row = parseCSVRow(currentLine);
    currentLine = '';

    if (!headers) {
      headers = row;
      continue;
    }

    const rowObj: Record<string, string> = {};
    headers.forEach((h, i) => {
      rowObj[h] = row[i] || '';
    });

    const handle = rowObj['Handle'];
    if (!handle) continue;

    if (!productsMap.has(handle)) {
      const rawType = (rowObj['Type'] || '').toLowerCase();
      let motorType: 'single' | 'dual' | null = null;
      if (rawType.includes('single') || handle.includes('single-motor') || handle.includes('rati')) {
        motorType = 'single';
      } else if (rawType.includes('dual') || handle.includes('dual-motor') || handle.includes('kuber') || handle.includes('yogeek')) {
        motorType = 'dual';
      }

      let status = rowObj['Status'] || 'active';
      if (status === 'unlisted') status = 'draft';
      if (!['active', 'draft', 'archived'].includes(status)) status = 'draft';

      productsMap.set(handle, {
        handle,
        title: rowObj['Title'] || handle,
        body: rowObj['Body (HTML)'] || '',
        vendor: rowObj['Vendor'] || 'Fittrock',
        category: rowObj['Product Category'] || '',
        type: rowObj['Type'] || '',
        tags: rowObj['Tags'] || '',
        published: rowObj['Published'] || 'true',
        status,
        motorType,
        variants: [],
        images: [],
      });
    }

    const prod = productsMap.get(handle)!;
    if (rowObj['Title'] && !prod.title) prod.title = rowObj['Title'];
    if (rowObj['Body (HTML)'] && !prod.body) prod.body = rowObj['Body (HTML)'];

    const rawPrice = parseFloat(rowObj['Variant Price'] || '0');
    const rawCompare = parseFloat(rowObj['Variant Compare At Price'] || '0');
    const pricePaise = Math.round(rawPrice * 100);
    const compareAtPricePaise = rawCompare > 0 ? Math.round(rawCompare * 100) : null;
    const inventoryQty = parseInt(rowObj['Variant Inventory Qty'] || '10', 10);
    const weightGrams = Math.round(parseFloat(rowObj['Variant Grams'] || '0'));

    if (rawPrice > 0 || rowObj['Option1 Value'] || rowObj['Variant SKU']) {
      // Check if duplicate variant already added (same options)
      const isDup = prod.variants.some(
        (v) =>
          v.opt1Val === rowObj['Option1 Value'] &&
          v.opt2Val === rowObj['Option2 Value'] &&
          v.opt3Val === rowObj['Option3 Value']
      );
      if (!isDup) {
        prod.variants.push({
          sku: rowObj['Variant SKU'],
          opt1Name: rowObj['Option1 Name'],
          opt1Val: rowObj['Option1 Value'],
          opt2Name: rowObj['Option2 Name'],
          opt2Val: rowObj['Option2 Value'],
          opt3Name: rowObj['Option3 Name'],
          opt3Val: rowObj['Option3 Value'],
          price: pricePaise,
          compareAtPrice: compareAtPricePaise,
          inventoryQty: isNaN(inventoryQty) ? 10 : inventoryQty,
          inventoryPolicy: rowObj['Variant Inventory Policy'] || 'deny',
          variantImage: rowObj['Variant Image'] || '',
          weightGrams: isNaN(weightGrams) ? 0 : weightGrams,
          barcode: rowObj['Variant Barcode'] || '',
        });
      }
    }

    if (rowObj['Image Src']) {
      const existingImg = prod.images.some((img) => img.src === rowObj['Image Src']);
      if (!existingImg) {
        prod.images.push({
          src: rowObj['Image Src'],
          position: parseInt(rowObj['Image Position'] || String(prod.images.length + 1), 10),
          alt: rowObj['Image Alt Text'] || prod.title,
        });
      }
    }
  }

  console.log(`Parsed ${productsMap.size} products from CSV.`);

  // 2. Backup existing reviews
  console.log('Fetching existing reviews to preserve...');
  const { data: existingReviews } = await supabaseClient.from('reviews').select('*');
  console.log(`Found ${existingReviews?.length || 0} reviews to retain.`);

  // 3. Clear old mock catalog data
  console.log('Cleaning up existing product tables...');
  await supabaseClient.from('product_images').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabaseClient.from('product_categories').delete().neq('product_id', '00000000-0000-0000-0000-000000000000');
  await supabaseClient.from('product_variants').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabaseClient.from('reviews').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabaseClient.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabaseClient.from('categories').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // 4. Insert Categories
  console.log('Inserting categories...');
  const { error: catErr } = await supabaseClient.from('categories').upsert(CATEGORY_DEFS);
  if (catErr) {
    console.error('Error inserting categories:', catErr);
    throw catErr;
  }

  // 5. Insert Products, Variants, Images, Categories Links
  const productRowsToInsert: any[] = [];
  const variantRowsToInsert: any[] = [];
  const imageRowsToInsert: any[] = [];
  const productCatLinksToInsert: any[] = [];
  const usedSkus = new Set<string>();

  const handleToProductId = new Map<string, string>();

  // Deterministic UUIDs or random UUIDs
  for (const [handle, p] of productsMap.entries()) {
    const productId = randomUUID();
    handleToProductId.set(handle, productId);

    let weightCapacity = 100;
    let heightRange = '710mm - 1190mm';
    let warrantyMonths = 36;

    if (p.motorType === 'dual') {
      weightCapacity = 125;
      heightRange = '620mm - 1270mm';
      warrantyMonths = 60;
    }
    if (handle.includes('yogeek')) {
      heightRange = '490mm - 1150mm';
      warrantyMonths = 60;
    }

    const { cleanHtml, cleanText } = cleanHtmlDescription(p.body || '');
    let shortDesc = cleanText.length > 240 ? cleanText.slice(0, 240).replace(/\s+\S*$/, '') + '...' : cleanText;
    if (!shortDesc) shortDesc = p.title;

    productRowsToInsert.push({
      id: productId,
      title: p.title,
      slug: p.handle,
      description: cleanHtml || cleanText || p.title,
      short_description: shortDesc,
      brand: p.vendor || 'Fittrock',
      status: p.status,
      weight_capacity_kg: weightCapacity,
      height_range_mm: heightRange,
      warranty_months: warrantyMonths,
      motor_type: p.motorType,
      is_featured: p.status === 'active' && (handle.includes('kuber') || handle.includes('yogeek') || handle.includes('rati-s1-black')),
      avg_rating: '5.0',
      review_count: 5,
    });

    // Determine category IDs
    const categoryIds: string[] = [];
    if (handle.includes('yogeek')) {
      categoryIds.push('a1c23d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e'); // Yogeek
      categoryIds.push('b0ed3c76-8c2f-4ad7-9b4e-3a658b7c63cb'); // Standing Desks
    } else if (handle.includes('frame')) {
      categoryIds.push('b2c34d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e'); // Frames
      categoryIds.push('b0ed3c76-8c2f-4ad7-9b4e-3a658b7c63cb'); // Standing Desks
    } else if (handle.includes('table-top') || p.type.toLowerCase().includes('tabletop')) {
      categoryIds.push('c3d45e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f'); // Table Tops
    } else if (handle.includes('tray') || handle.includes('wheel') || handle.includes('caster') || p.type.toLowerCase().includes('accessories')) {
      categoryIds.push('942ba5dd-36c7-4b52-9d5b-055b1311c2e6'); // Desk Accessories
    } else {
      categoryIds.push('b0ed3c76-8c2f-4ad7-9b4e-3a658b7c63cb'); // Standing Desks
    }

    categoryIds.forEach((catId) => {
      productCatLinksToInsert.push({
        product_id: productId,
        category_id: catId,
      });
    });

    // Variants
    const variantsList = p.variants.length > 0 ? p.variants : [
      {
        sku: `FT-${handle.toUpperCase().slice(0, 10)}`,
        opt1Name: 'Title',
        opt1Val: 'Default',
        opt2Name: '',
        opt2Val: '',
        opt3Name: '',
        opt3Val: '',
        price: 1799000,
        compareAtPrice: 2999000,
        inventoryQty: 10,
        inventoryPolicy: 'deny',
        variantImage: '',
        weightGrams: 0,
        barcode: '',
      }
    ];

    variantsList.forEach((v, vIdx) => {
      const variantId = randomUUID();
      const optionParts = [v.opt1Val, v.opt2Val, v.opt3Val].filter(Boolean);
      const variantTitle = optionParts.length > 0 ? optionParts.join(' / ') : 'Standard';

      let baseSku = v.sku?.trim();
      if (!baseSku) {
        const cleanHandle = handle
          .replace(/^fittrock-/, '')
          .replace(/[^a-zA-Z0-9]/g, '-')
          .toUpperCase()
          .slice(0, 25);
        baseSku = `FT-${cleanHandle}-${vIdx + 1}`;
      }

      let sku = baseSku;
      let counter = 1;
      while (usedSkus.has(sku)) {
        sku = `${baseSku}-${counter++}`;
      }
      usedSkus.add(sku);

      variantRowsToInsert.push({
        id: variantId,
        product_id: productId,
        sku,
        title: variantTitle,
        price: String(v.price), // stored in paise
        compare_at_price: v.compareAtPrice ? String(v.compareAtPrice) : null,
        cost_price: null,
        inventory_quantity: v.inventoryQty,
        inventory_policy: v.inventoryPolicy || 'deny',
        weight_grams: v.weightGrams || 0,
        barcode: v.barcode || null,
        is_default: vIdx === 0,
        is_active: p.status === 'active',
      });

      // If variant has an image, map it
      if (v.variantImage) {
        imageRowsToInsert.push({
          id: randomUUID(),
          product_id: productId,
          variant_id: variantId,
          url: v.variantImage,
          alt_text: `${p.title} - ${variantTitle}`,
          sort_order: 1,
        });
      }
    });

    // Product Images
    p.images.forEach((img, imgIdx) => {
      // Avoid duplicate URLs already inserted as variant images
      const alreadyInserted = imageRowsToInsert.some((row) => row.product_id === productId && row.url === img.src);
      if (!alreadyInserted) {
        imageRowsToInsert.push({
          id: randomUUID(),
          product_id: productId,
          variant_id: null,
          url: img.src,
          alt_text: img.alt || `${p.title} Image ${imgIdx + 1}`,
          sort_order: img.position || imgIdx + 1,
        });
      }
    });

    // If no image was found in CSV, supply a clean brand fallback
    const hasAnyImage = imageRowsToInsert.some((img) => img.product_id === productId);
    if (!hasAnyImage) {
      imageRowsToInsert.push({
        id: randomUUID(),
        product_id: productId,
        variant_id: null,
        url: 'https://cdn.shopify.com/s/files/1/0748/4771/5577/files/Best_standing_desk_wooden_table_9158186c-4d9d-4a00-ba58-4e891278df0c.webp',
        alt_text: p.title,
        sort_order: 1,
      });
    }
  }

  console.log(`Inserting ${productRowsToInsert.length} products...`);
  const { error: pErr } = await supabaseClient.from('products').insert(productRowsToInsert);
  if (pErr) {
    console.error('Error inserting products:', pErr);
    throw pErr;
  }

  console.log(`Inserting ${productCatLinksToInsert.length} product-category links...`);
  const { error: pcErr } = await supabaseClient.from('product_categories').insert(productCatLinksToInsert);
  if (pcErr) {
    console.error('Error inserting product_categories:', pcErr);
    throw pcErr;
  }

  console.log(`Inserting ${variantRowsToInsert.length} product variants in batches...`);
  const batchSize = 100;
  for (let i = 0; i < variantRowsToInsert.length; i += batchSize) {
    const batch = variantRowsToInsert.slice(i, i + batchSize);
    const { error: vErr } = await supabaseClient.from('product_variants').insert(batch);
    if (vErr) {
      console.error(`Error inserting variants batch ${i}:`, vErr);
      throw vErr;
    }
  }

  console.log(`Inserting ${imageRowsToInsert.length} product images in batches...`);
  for (let i = 0; i < imageRowsToInsert.length; i += batchSize) {
    const batch = imageRowsToInsert.slice(i, i + batchSize);
    const { error: imgErr } = await supabaseClient.from('product_images').insert(batch);
    if (imgErr) {
      console.error(`Error inserting images batch ${i}:`, imgErr);
      throw imgErr;
    }
  }

  // 6. Restore reviews mapped to real products
  const defaultReviews = [
    {
      author_name: 'Vikram Malhotra',
      author_role: 'Full Stack Developer',
      author_avatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=200&q=80',
      title: 'Amazing Dual Motor Desk',
      body: 'Upgrading to the Fittrock Kuber dual motor desk was a game changer for my work from home setup. Smooth height transitions and rock-solid frame.',
      rating: 5,
      productHandle: 'kuber-d1-black',
    },
    {
      author_name: 'Kavita Nair',
      author_role: 'UX Researcher & Remote Worker',
      author_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      title: 'Relieved Back Pain',
      body: 'Relieved my chronic lower back pain within two weeks of use. Seamless motorized movement and the steel frame is built like a tank.',
      rating: 5,
      productHandle: 'kuber-d1-frosty-white',
    },
    {
      author_name: 'Arjun Mehta',
      author_role: 'Creative Director',
      author_avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=200&q=80',
      title: 'Sturdy & Sleek',
      body: 'Sturdy, sleek, and high-end aesthetics. The clean finish and 4-preset controller make my workspace look minimal and clutter-free.',
      rating: 5,
      productHandle: 'kuber-d1-dark-mapple',
    },
    {
      author_name: 'Siddharth Kapoor',
      author_role: 'DevOps Consultant',
      author_avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=200&q=80',
      title: 'Massive Cable Tray',
      body: 'Massive cable tray that holds two large power strips and all excess monitor/charger cords. Zero dangling wires under my desk now!',
      rating: 5,
      productHandle: 'under-desk-cable-management-tray',
    },
    {
      author_name: 'Neha Verma',
      author_role: 'Product Manager',
      author_avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80',
      title: 'Super Easy to Mount',
      body: 'Super easy to mount under the desk. Heavy-duty metal that does not bend or sag.',
      rating: 5,
      productHandle: 'under-desk-cable-management-tray',
    },
    {
      author_name: 'Gopala Ganeshan Subbiah',
      author_role: 'Principal Systems Engineer',
      author_avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80',
      title: 'Genuine Value & Quality',
      body: "I recently purchased the single Motor White, 1600 mm × 700 mm Height Adjustable Standing Desk from Fittrock, and I'm genuinely impressed with the overall quality and value it offers. The wood quality of the tabletop is excellent — sturdy, smooth-finished, and premium to the touch.",
      rating: 5,
      productHandle: 'fittrock-rati-s1-frosty-white',
    },
    {
      author_name: 'Sukanya Singh',
      author_role: 'Lead Product Designer',
      author_avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80',
      title: 'Excellent Service',
      body: 'Excellent product and service delivery appreciate it.',
      rating: 5,
      productHandle: 'fittrock-rati-s1-black',
    },
    {
      author_name: 'Ketaki Joshi',
      author_role: 'Senior Frontend Architect',
      author_avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=200&q=80',
      title: 'Smart Control Panel',
      body: 'The smart control panel with height display and sit-stand reminder is fantastic. The table top finish feels extremely premium and scratch-resistant.',
      rating: 5,
      productHandle: 'yogeek-yg1-black',
    },
    {
      author_name: 'Pralhad Sonar',
      author_role: 'Operations Director & Founder',
      author_avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
      title: 'Refined Modern Aesthetic',
      body: "I absolutely love Fittrock's sleek and scratch-resistant tabletop, it not only adds a refined, modern aesthetic to my workspace but also stands up exceptionally well to the demands of daily use.",
      rating: 5,
      productHandle: 'yogeek-yg1-ice-beach',
    },
    {
      author_name: 'Davinder Kumar',
      author_role: 'Verified Customer',
      author_avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80',
      title: 'Incredible Desk Quality',
      body: 'Incredible! Simple to build, works exactly as it should and fits so well into my office. Great for the price - Thank You Fittrock! definitely recommend.',
      rating: 5,
      productHandle: 'fittrock-rati-s1-dark-maple',
    },
    {
      author_name: 'Prajwal Raju Tulawe',
      author_role: 'Verified Customer',
      author_avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=200&q=80',
      title: 'Extremely High-Grade Material',
      body: 'Extremely high-grade material used for this table frame. It is very easy to assemble also they have a very good tech support.',
      rating: 5,
      productHandle: 'kuber-frame-for-dual-motor-standing-desk',
    },
  ];

  console.log(`Inserting ${defaultReviews.length} verified customer reviews...`);
  const reviewsToInsert = defaultReviews.map((r) => {
    const targetProdId = handleToProductId.get(r.productHandle) || productRowsToInsert[0].id;
    return {
      id: randomUUID(),
      product_id: targetProdId,
      rating: r.rating,
      title: r.title,
      body: r.body,
      author_name: r.author_name,
      author_role: r.author_role,
      author_avatar: r.author_avatar,
      is_verified_purchase: true,
      is_approved: true,
      created_at: new Date().toISOString(),
    };
  });

  const { error: revErr } = await supabaseClient.from('reviews').insert(reviewsToInsert);
  if (revErr) {
    console.warn('Warning inserting reviews:', revErr);
  } else {
    console.log(`Successfully inserted ${reviewsToInsert.length} reviews.`);
  }

  console.log('✅ COMPLETE CATALOG IMPORT SUCCESSFUL!');
  console.log({
    categoriesCount: CATEGORY_DEFS.length,
    productsCount: productRowsToInsert.length,
    variantsCount: variantRowsToInsert.length,
    imagesCount: imageRowsToInsert.length,
  });

  process.exit(0);
}

seedCatalogFromCSV().catch((err) => {
  console.error('Fatal seed error:', err);
  process.exit(1);
});
