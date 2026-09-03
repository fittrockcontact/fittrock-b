import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// --- PRODUCTS --- (Matches public.products)
export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    shortDescription: text('short_description'),
    brand: text('brand').default('Fittrock'),
    status: text('status').default('active').notNull(),
    weightCapacityKg: numeric('weight_capacity_kg', { precision: 6, scale: 2 }),
    heightRangeMm: text('height_range_mm'),
    warrantyMonths: integer('warranty_months').default(24),
    motorType: text('motor_type'),
    isFeatured: boolean('is_featured').default(false),
    avgRating: numeric('avg_rating', { precision: 2, scale: 1 }).default('0'),
    reviewCount: integer('review_count').default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('products_slug_idx').on(table.slug),
    index('products_status_idx').on(table.status),
  ]
);

export const productsRelations = relations(products, ({ many }) => ({
  variants: many(productVariants),
  images: many(productImages),
  collections: many(productCollections),
  reviews: many(reviews),
}));

// --- PRODUCT VARIANTS --- (Matches public.product_variants)
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull().unique(),
    title: text('title'),
    price: numeric('price', { precision: 12, scale: 0 }).notNull(),
    compareAtPrice: numeric('compare_at_price', { precision: 12, scale: 0 }),
    costPrice: numeric('cost_price', { precision: 12, scale: 0 }),
    inventoryQuantity: integer('inventory_quantity').default(0).notNull(),
    inventoryPolicy: text('inventory_policy').default('deny'),
    weightGrams: integer('weight_grams'),
    barcode: text('barcode'),
    isDefault: boolean('is_default').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('variants_product_id_idx').on(table.productId),
    index('variants_sku_idx').on(table.sku),
  ]
);

export const productVariantsRelations = relations(
  productVariants,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
    images: many(productImages),
    orderItems: many(orderItems),
  })
);

// --- PRODUCT IMAGES --- (Matches public.product_images with variant_id FK)
export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    altText: text('alt_text'),
    sortOrder: integer('sort_order').default(0).notNull(),
    features: jsonb('features'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('images_product_idx').on(table.productId)]
);

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

// --- COLLECTIONS / CATEGORIES --- (Matches public.categories)
export const collections = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    parentId: uuid('parent_id').references((): any => collections.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    imageUrl: text('image_url'),
    isActive: boolean('is_active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('categories_slug_idx').on(table.slug)]
);

export const collectionsRelations = relations(collections, ({ many }) => ({
  products: many(productCollections),
}));

// --- PRODUCT CATEGORIES --- (Matches public.product_categories)
export const productCollections = pgTable(
  'product_categories',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    collectionId: uuid('category_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.collectionId] }),
  ]
);

export const productCollectionsRelations = relations(
  productCollections,
  ({ one }) => ({
    product: one(products, {
      fields: [productCollections.productId],
      references: [products.id],
    }),
    collection: one(collections, {
      fields: [productCollections.collectionId],
      references: [collections.id],
    }),
  })
);

// --- CUSTOMERS / PROFILES --- (Matches public.profiles)
export const customers = pgTable('profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  fullName: text('full_name'),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),
  isBusiness: boolean('is_business').default(false),
  gstNumber: text('gst_number'),
  businessName: text('business_name'),
  marketingOptIn: boolean('marketing_opt_in').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const customersRelations = relations(customers, ({ many }) => ({
  addresses: many(addresses),
  orders: many(orders),
}));

// --- ADDRESSES --- (Matches public.addresses)
export const addresses = pgTable('addresses', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  type: text('type').default('shipping').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull(),
  line1: text('line1').notNull(),
  line2: text('line2'),
  city: text('city').notNull(),
  state: text('state').notNull(),
  postalCode: text('postal_code').notNull(),
  country: text('country').default('India').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const addressesRelations = relations(addresses, ({ one }) => ({
  customer: one(customers, {
    fields: [addresses.userId],
    references: [customers.id],
  }),
}));

// --- ORDERS --- (Matches public.orders)
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderNumber: text('order_number').default(sql`'FR-' || floor(random()*900000 + 100000)::text`),
    userId: uuid('user_id').references(() => customers.id, { onDelete: 'set null' }),
    status: text('status').default('pending').notNull(),
    shippingAddressId: uuid('shipping_address_id').references(() => addresses.id),
    billingAddressId: uuid('billing_address_id').references(() => addresses.id),
    subtotal: numeric('subtotal', { precision: 12, scale: 0 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 0 }).default('0'),
    shippingAmount: numeric('shipping_amount', { precision: 12, scale: 0 }).default('0'),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 0 }).default('0'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 0 }).notNull(),
    razorpayOrderId: text('razorpay_order_id'),
    razorpayPaymentId: text('razorpay_payment_id'),
    razorpaySignature: text('razorpay_signature'),
    discountId: uuid('discount_id'),
    requiresGstInvoice: boolean('requires_gst_invoice').default(false),
    gstNumber: text('gst_number'),
    customerNote: text('customer_note'),
    internalNote: text('internal_note'),
    placedAt: timestamp('placed_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('orders_user_idx').on(table.userId),
    index('orders_status_idx').on(table.status),
  ]
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.userId],
    references: [customers.id],
  }),
  items: many(orderItems),
  shipments: many(shipments),
}));

// --- ORDER ITEMS --- (Matches public.order_items)
export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
  productTitle: text('product_title').notNull(),
  variantTitle: text('variant_title'),
  sku: text('sku'),
  unitPrice: numeric('unit_price', { precision: 12, scale: 0 }).notNull(),
  quantity: integer('quantity').notNull(),
  lineTotal: numeric('line_total', { precision: 12, scale: 0 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

// --- DISCOUNTS --- (Matches public.discounts)
export const discounts = pgTable('discounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').unique(),
  description: text('description'),
  type: text('type').notNull(),
  value: numeric('value', { precision: 10, scale: 2 }).notNull(),
  maxDiscountAmount: numeric('max_discount_amount', { precision: 12, scale: 0 }),
  minOrderAmount: numeric('min_order_amount', { precision: 12, scale: 0 }),
  applicablePaymentMethod: text('applicable_payment_method'),
  newCustomersOnly: boolean('new_customers_only').default(false),
  usageLimitTotal: integer('usage_limit_total'),
  usageLimitPerUser: integer('usage_limit_per_user').default(1),
  startsAt: timestamp('starts_at'),
  endsAt: timestamp('ends_at'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- REVIEWS --- (Matches public.reviews)
export const reviews = pgTable('reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => customers.id, { onDelete: 'set null' }),
  orderItemId: uuid('order_item_id').references(() => orderItems.id, { onDelete: 'set null' }),
  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body'),
  authorName: text('author_name'),
  authorRole: text('author_role'),
  authorAvatar: text('author_avatar'),
  imageUrls: text('image_urls').array(),
  isVerifiedPurchase: boolean('is_verified_purchase').default(false),
  isApproved: boolean('is_approved').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, {
    fields: [reviews.productId],
    references: [products.id],
  }),
}));

// --- CONTACT INQUIRIES --- (Matches public.contact_inquiries)
export const contactInquiries = pgTable('contact_inquiries', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  message: text('message').notNull(),
  status: text('status').default('new').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// --- NEWSLETTER SUBSCRIBERS --- (Matches public.newsletter_subscribers)
export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  subscribedAt: timestamp('subscribed_at').defaultNow().notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

// --- CUSTOMER CARTS (Cross-device cloud cart sync) ---
export const customerCarts = pgTable('customer_carts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => customers.id, { onDelete: 'cascade' }),
  items: jsonb('items').notNull(),
  appliedDiscount: jsonb('applied_discount'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// --- LEADS / CRM ---
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone').notNull(),
    company: text('company'),
    city: text('city'),
    state: text('state'),
    gstNumber: text('gst_number'),
    dealValue: numeric('deal_value', { precision: 12, scale: 0 }).default('0'),
    stage: text('stage').default('new').notNull(), // new, contacted, qualified, proposal_sent, negotiation, won, lost
    priority: text('priority').default('warm').notNull(), // hot, warm, cold
    source: text('source').default('manual').notNull(), // website_inquiry, phone, whatsapp, b2b, referral, manual
    notes: text('notes'),
    assignedTo: text('assigned_to'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('leads_phone_idx').on(table.phone),
    index('leads_stage_idx').on(table.stage),
    index('leads_priority_idx').on(table.priority),
  ]
);

export const leadsRelations = relations(leads, ({ many }) => ({
  activities: many(leadActivities),
  reminders: many(leadReminders),
}));

// --- LEAD ACTIVITIES (Calls, WhatsApp, Meetings, Notes) ---
export const leadActivities = pgTable(
  'lead_activities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // call, whatsapp, email, meeting, note
    outcome: text('outcome'), // connected, busy, no_answer, interested, not_interested, callback_requested
    durationSeconds: integer('duration_seconds').default(0),
    notes: text('notes'),
    performedBy: text('performed_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('lead_activities_lead_idx').on(table.leadId)]
);

export const leadActivitiesRelations = relations(leadActivities, ({ one }) => ({
  lead: one(leads, {
    fields: [leadActivities.leadId],
    references: [leads.id],
  }),
}));

// --- LEAD REMINDERS / FOLLOW-UPS ---
export const leadReminders = pgTable(
  'lead_reminders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .references(() => leads.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    dueAt: timestamp('due_at').notNull(),
    priority: text('priority').default('medium').notNull(), // low, medium, high, urgent
    status: text('status').default('pending').notNull(), // pending, completed, snoozed
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('lead_reminders_due_idx').on(table.dueAt),
    index('lead_reminders_status_idx').on(table.status),
  ]
);

export const leadRemindersRelations = relations(leadReminders, ({ one }) => ({
  lead: one(leads, {
    fields: [leadReminders.leadId],
    references: [leads.id],
  }),
}));

// --- SHIPMENTS (Multi-courier & Direct Delivery) ---
export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    deliveryType: text('delivery_type').default('courier').notNull(), // courier | direct
    carrierName: text('carrier_name'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    driverName: text('driver_name'),
    driverPhone: text('driver_phone'),
    deliveryNotes: text('delivery_notes'),
    status: text('status').default('in_transit').notNull(), // pending, in_transit, out_for_delivery, delivered
    shippedAt: timestamp('shipped_at').defaultNow(),
    deliveredAt: timestamp('delivered_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('shipments_order_idx').on(table.orderId)]
);

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  order: one(orders, {
    fields: [shipments.orderId],
    references: [orders.id],
  }),
}));



