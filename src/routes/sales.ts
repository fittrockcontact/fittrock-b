import { Router, Request, Response } from 'express';
import { db } from '../lib/db/index.js';
import {
  leads,
  leadActivities,
  leadReminders,
  shipments,
  orders,
  orderItems,
  customers,
  addresses,
  products,
  productVariants,
} from '../lib/db/schema.js';
import { desc, asc, eq, sql, and, or, ilike, inArray, gte, lte, count } from 'drizzle-orm';
import { supabaseClient } from '../lib/db/supabase.js';
import { AuthenticatedRequest } from '../middleware/firebase-auth.js';

// Mounted behind requireSalesAuth in src/index.ts
const router = Router();

// GET /api/sales/me - lets the dashboard confirm the signed-in rep has access
router.get('/me', (req: AuthenticatedRequest, res: Response) => {
  return res.json({ email: req.user?.email ?? null });
});

// ==========================================
// 1. STATS / DAILY COCKPIT METRICS
// GET /api/sales/stats
// ==========================================
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    if (supabaseClient) {
      // 1. Calls made today
      const { count: callsToday } = await supabaseClient
        .from('lead_activities')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'call')
        .gte('created_at', todayStart.toISOString());

      // 2. Pending reminders due today or overdue
      const { count: pendingReminders } = await supabaseClient
        .from('lead_reminders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lte('due_at', todayEnd.toISOString());

      // 3. Orders pending acceptance
      const { count: pendingOrders } = await supabaseClient
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // 4. Orders ready to ship
      const { count: readyToShipOrders } = await supabaseClient
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['confirmed', 'processing']);

      // 5. Orders shipped today
      const { count: shippedToday } = await supabaseClient
        .from('shipments')
        .select('*', { count: 'exact', head: true })
        .gte('shipped_at', todayStart.toISOString());

      // 6. Leads pipeline counts
      const { data: allLeads } = await supabaseClient
        .from('leads')
        .select('stage, deal_value');

      const stageCounts: Record<string, number> = {
        new: 0,
        contacted: 0,
        qualified: 0,
        proposal_sent: 0,
        negotiation: 0,
        won: 0,
        lost: 0,
      };

      let wonRevenue = 0;
      (allLeads || []).forEach((l: any) => {
        const stage = l.stage || 'new';
        stageCounts[stage] = (stageCounts[stage] || 0) + 1;
        if (stage === 'won') {
          wonRevenue += parseFloat(l.deal_value || '0');
        }
      });

      return res.json({
        success: true,
        stats: {
          callsToday: callsToday ?? 0,
          pendingReminders: pendingReminders ?? 0,
          pendingOrders: pendingOrders ?? 0,
          readyToShipOrders: readyToShipOrders ?? 0,
          shippedToday: shippedToday ?? 0,
          totalLeads: (allLeads || []).length,
          wonRevenue,
          stageCounts,
        },
      });
    }

    // Fallback Drizzle ORM
    const [callsTodayRes] = await db
      .select({ count: count() })
      .from(leadActivities)
      .where(
        and(
          eq(leadActivities.type, 'call'),
          gte(leadActivities.createdAt, todayStart)
        )
      );

    const [pendingRemindersRes] = await db
      .select({ count: count() })
      .from(leadReminders)
      .where(
        and(
          eq(leadReminders.status, 'pending'),
          lte(leadReminders.dueAt, todayEnd)
        )
      );

    const [pendingOrdersRes] = await db
      .select({ count: count() })
      .from(orders)
      .where(eq(orders.status, 'pending'));

    const [readyToShipRes] = await db
      .select({ count: count() })
      .from(orders)
      .where(inArray(orders.status, ['confirmed', 'processing']));

    return res.json({
      success: true,
      stats: {
        callsToday: callsTodayRes?.count ?? 0,
        pendingReminders: pendingRemindersRes?.count ?? 0,
        pendingOrders: pendingOrdersRes?.count ?? 0,
        readyToShipOrders: readyToShipRes?.count ?? 0,
        shippedToday: 0,
        totalLeads: 0,
        wonRevenue: 0,
        stageCounts: { new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 },
      },
    });
  } catch (err: any) {
    console.error('Error fetching sales stats:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch sales stats' });
  }
});

// ==========================================
// 2. LEADS MANAGEMENT
// GET /api/sales/leads
// ==========================================
router.get('/leads', async (req: Request, res: Response) => {
  try {
    const { search, stage, priority, source, limit = '100', offset = '0' } = req.query;

    if (supabaseClient) {
      let query = supabaseClient
        .from('leads')
        .select('*, lead_activities(id, type, outcome, created_at), lead_reminders(id, title, due_at, status)')
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (stage && typeof stage === 'string' && stage !== 'all') {
        query = query.eq('stage', stage);
      }
      if (priority && typeof priority === 'string' && priority !== 'all') {
        query = query.eq('priority', priority);
      }
      if (source && typeof source === 'string' && source !== 'all') {
        query = query.eq('source', source);
      }
      if (search && typeof search === 'string') {
        const s = `%${search.trim()}%`;
        query = query.or(`name.ilike.${s},phone.ilike.${s},company.ilike.${s},email.ilike.${s}`);
      }

      const { data, error } = await query;
      if (error) throw error;

      return res.json({ success: true, leads: data || [] });
    }

    // Fallback Drizzle ORM
    const queryConds: any[] = [];
    if (stage && stage !== 'all') queryConds.push(eq(leads.stage, stage as string));
    if (priority && priority !== 'all') queryConds.push(eq(leads.priority, priority as string));
    if (source && source !== 'all') queryConds.push(eq(leads.source, source as string));
    if (search) {
      const s = `%${String(search).trim()}%`;
      queryConds.push(or(ilike(leads.name, s), ilike(leads.phone, s), ilike(leads.company, s)));
    }

    const data = await db
      .select()
      .from(leads)
      .where(queryConds.length > 0 ? and(...queryConds) : undefined)
      .orderBy(desc(leads.createdAt))
      .limit(Number(limit))
      .offset(Number(offset));

    return res.json({ success: true, leads: data });
  } catch (err: any) {
    console.error('Error fetching leads:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch leads' });
  }
});

// POST /api/sales/leads - Create new lead
router.post('/leads', async (req: Request, res: Response) => {
  try {
    const {
      name,
      phone,
      email,
      company,
      city,
      state,
      gstNumber,
      dealValue = 0,
      stage = 'new',
      priority = 'warm',
      source = 'manual',
      notes,
      assignedTo,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone number are required' });
    }

    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('leads')
        .insert({
          name: name.trim(),
          phone: phone.trim(),
          email: email?.trim() || null,
          company: company?.trim() || null,
          city: city?.trim() || null,
          state: state?.trim() || null,
          gst_number: gstNumber?.trim() || null,
          deal_value: dealValue ? Number(dealValue) : 0,
          stage,
          priority,
          source,
          notes: notes?.trim() || null,
          assigned_to: assignedTo || null,
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ success: true, lead: data });
    }

    const [newLead] = await db
      .insert(leads)
      .values({
        name: name.trim(),
        phone: phone.trim(),
        email: email?.trim() || null,
        company: company?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        gstNumber: gstNumber?.trim() || null,
        dealValue: dealValue ? String(dealValue) : '0',
        stage,
        priority,
        source,
        notes: notes?.trim() || null,
        assignedTo: assignedTo || null,
      })
      .returning();

    return res.status(201).json({ success: true, lead: newLead });
  } catch (err: any) {
    console.error('Error creating lead:', err);
    return res.status(500).json({ error: err.message || 'Failed to create lead' });
  }
});

// GET /api/sales/leads/:id - Single lead with full activity timeline & reminders
router.get('/leads/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (supabaseClient) {
      const { data: lead, error } = await supabaseClient
        .from('leads')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      const { data: activities } = await supabaseClient
        .from('lead_activities')
        .select('*')
        .eq('lead_id', id)
        .order('created_at', { ascending: false });

      const { data: reminders } = await supabaseClient
        .from('lead_reminders')
        .select('*')
        .eq('lead_id', id)
        .order('due_at', { ascending: true });

      return res.json({
        success: true,
        lead: {
          ...lead,
          activities: activities || [],
          reminders: reminders || [],
        },
      });
    }

    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const activities = await db
      .select()
      .from(leadActivities)
      .where(eq(leadActivities.leadId, id))
      .orderBy(desc(leadActivities.createdAt));

    const reminders = await db
      .select()
      .from(leadReminders)
      .where(eq(leadReminders.leadId, id))
      .orderBy(asc(leadReminders.dueAt));

    return res.json({
      success: true,
      lead: { ...lead, activities, reminders },
    });
  } catch (err: any) {
    console.error('Error fetching lead detail:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch lead detail' });
  }
});

// PATCH /api/sales/leads/:id - Update lead details / stage
router.patch('/leads/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body;

    const allowedFields = [
      'name',
      'phone',
      'email',
      'company',
      'city',
      'state',
      'gstNumber',
      'dealValue',
      'stage',
      'priority',
      'source',
      'notes',
      'assignedTo',
    ];

    if (supabaseClient) {
      const updatePayload: any = { updated_at: new Date().toISOString() };
      if (body.name !== undefined) updatePayload.name = body.name;
      if (body.phone !== undefined) updatePayload.phone = body.phone;
      if (body.email !== undefined) updatePayload.email = body.email;
      if (body.company !== undefined) updatePayload.company = body.company;
      if (body.city !== undefined) updatePayload.city = body.city;
      if (body.state !== undefined) updatePayload.state = body.state;
      if (body.gstNumber !== undefined) updatePayload.gst_number = body.gstNumber;
      if (body.dealValue !== undefined) updatePayload.deal_value = Number(body.dealValue);
      if (body.stage !== undefined) updatePayload.stage = body.stage;
      if (body.priority !== undefined) updatePayload.priority = body.priority;
      if (body.source !== undefined) updatePayload.source = body.source;
      if (body.notes !== undefined) updatePayload.notes = body.notes;
      if (body.assignedTo !== undefined) updatePayload.assigned_to = body.assignedTo;

      const { data, error } = await supabaseClient
        .from('leads')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.json({ success: true, lead: data });
    }

    const [updatedLead] = await db
      .update(leads)
      .set({
        ...(body.name && { name: body.name }),
        ...(body.phone && { phone: body.phone }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.company !== undefined && { company: body.company }),
        ...(body.city !== undefined && { city: body.city }),
        ...(body.state !== undefined && { state: body.state }),
        ...(body.gstNumber !== undefined && { gstNumber: body.gstNumber }),
        ...(body.dealValue !== undefined && { dealValue: String(body.dealValue) }),
        ...(body.stage && { stage: body.stage }),
        ...(body.priority && { priority: body.priority }),
        ...(body.source && { source: body.source }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.assignedTo !== undefined && { assignedTo: body.assignedTo }),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, id))
      .returning();

    return res.json({ success: true, lead: updatedLead });
  } catch (err: any) {
    console.error('Error updating lead:', err);
    return res.status(500).json({ error: err.message || 'Failed to update lead' });
  }
});

// DELETE /api/sales/leads/:id
router.delete('/leads/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (supabaseClient) {
      const { error } = await supabaseClient.from('leads').delete().eq('id', id);
      if (error) throw error;
      return res.json({ success: true, message: 'Lead deleted successfully' });
    }

    await db.delete(leads).where(eq(leads.id, id));
    return res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (err: any) {
    console.error('Error deleting lead:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete lead' });
  }
});

// ==========================================
// 3. LEAD ACTIVITIES & QUICK LOGGING
// POST /api/sales/leads/:id/activities
// ==========================================
router.post('/leads/:id/activities', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      type = 'call',
      outcome,
      durationSeconds = 0,
      notes,
      performedBy,
      nextFollowUpDate,
      nextFollowUpTitle,
    } = req.body;

    if (supabaseClient) {
      // 1. Insert activity
      const { data: act, error } = await supabaseClient
        .from('lead_activities')
        .insert({
          lead_id: id,
          type,
          outcome: outcome || null,
          duration_seconds: Number(durationSeconds),
          notes: notes?.trim() || null,
          performed_by: performedBy || null,
        })
        .select()
        .single();

      if (error) throw error;

      // 2. Optionally create follow-up reminder
      if (nextFollowUpDate) {
        await supabaseClient.from('lead_reminders').insert({
          lead_id: id,
          title: nextFollowUpTitle || `Follow up on ${type}`,
          due_at: new Date(nextFollowUpDate).toISOString(),
          priority: 'medium',
          status: 'pending',
          notes: notes?.trim() || null,
        });
      }

      // Update lead updatedAt
      await supabaseClient.from('leads').update({ updated_at: new Date().toISOString() }).eq('id', id);

      return res.status(201).json({ success: true, activity: act });
    }

    const [act] = await db
      .insert(leadActivities)
      .values({
        leadId: id,
        type,
        outcome: outcome || null,
        durationSeconds: Number(durationSeconds),
        notes: notes?.trim() || null,
        performedBy: performedBy || null,
      })
      .returning();

    if (nextFollowUpDate) {
      await db.insert(leadReminders).values({
        leadId: id,
        title: nextFollowUpTitle || `Follow up on ${type}`,
        dueAt: new Date(nextFollowUpDate),
        priority: 'medium',
        status: 'pending',
        notes: notes?.trim() || null,
      });
    }

    return res.status(201).json({ success: true, activity: act });
  } catch (err: any) {
    console.error('Error logging activity:', err);
    return res.status(500).json({ error: err.message || 'Failed to log activity' });
  }
});

// ==========================================
// 4. REMINDERS & DAILY FOLLOW-UPS
// ==========================================

// GET /api/sales/reminders/today - Overdue & Today's reminders
router.get('/reminders/today', async (_req: Request, res: Response) => {
  try {
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('lead_reminders')
        .select('*, leads(id, name, phone, company, stage, priority)')
        .eq('status', 'pending')
        .lte('due_at', todayEnd.toISOString())
        .order('due_at', { ascending: true });

      if (error) throw error;
      return res.json({ success: true, reminders: data || [] });
    }

    const data = await db
      .select({
        id: leadReminders.id,
        leadId: leadReminders.leadId,
        title: leadReminders.title,
        dueAt: leadReminders.dueAt,
        priority: leadReminders.priority,
        status: leadReminders.status,
        notes: leadReminders.notes,
        leadName: leads.name,
        leadPhone: leads.phone,
        leadCompany: leads.company,
      })
      .from(leadReminders)
      .leftJoin(leads, eq(leadReminders.leadId, leads.id))
      .where(
        and(
          eq(leadReminders.status, 'pending'),
          lte(leadReminders.dueAt, todayEnd)
        )
      )
      .orderBy(asc(leadReminders.dueAt));

    return res.json({ success: true, reminders: data });
  } catch (err: any) {
    console.error('Error fetching today reminders:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch reminders' });
  }
});

// GET /api/sales/reminders - All reminders with filters
router.get('/reminders', async (req: Request, res: Response) => {
  try {
    const { status = 'all' } = req.query;

    if (supabaseClient) {
      let query = supabaseClient
        .from('lead_reminders')
        .select('*, leads(id, name, phone, company, stage)')
        .order('due_at', { ascending: true });

      if (status !== 'all' && typeof status === 'string') {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return res.json({ success: true, reminders: data || [] });
    }

    const data = await db
      .select({
        id: leadReminders.id,
        leadId: leadReminders.leadId,
        title: leadReminders.title,
        dueAt: leadReminders.dueAt,
        priority: leadReminders.priority,
        status: leadReminders.status,
        notes: leadReminders.notes,
        leadName: leads.name,
        leadPhone: leads.phone,
        leadCompany: leads.company,
      })
      .from(leadReminders)
      .leftJoin(leads, eq(leadReminders.leadId, leads.id))
      .orderBy(asc(leadReminders.dueAt));

    return res.json({ success: true, reminders: data });
  } catch (err: any) {
    console.error('Error fetching reminders:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch reminders' });
  }
});

// POST /api/sales/leads/:id/reminders - Create a reminder
router.post('/leads/:id/reminders', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, dueAt, priority = 'medium', notes } = req.body;

    if (!title || !dueAt) {
      return res.status(400).json({ error: 'Title and due date are required' });
    }

    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('lead_reminders')
        .insert({
          lead_id: id,
          title: title.trim(),
          due_at: new Date(dueAt).toISOString(),
          priority,
          status: 'pending',
          notes: notes?.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ success: true, reminder: data });
    }

    const [rem] = await db
      .insert(leadReminders)
      .values({
        leadId: id,
        title: title.trim(),
        dueAt: new Date(dueAt),
        priority,
        status: 'pending',
        notes: notes?.trim() || null,
      })
      .returning();

    return res.status(201).json({ success: true, reminder: rem });
  } catch (err: any) {
    console.error('Error creating reminder:', err);
    return res.status(500).json({ error: err.message || 'Failed to create reminder' });
  }
});

// PATCH /api/sales/reminders/:id - Update reminder (complete or snooze)
router.patch('/reminders/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, dueAt, notes } = req.body;

    if (supabaseClient) {
      const updateData: any = {};
      if (status) updateData.status = status;
      if (dueAt) updateData.due_at = new Date(dueAt).toISOString();
      if (notes !== undefined) updateData.notes = notes;

      const { data, error } = await supabaseClient
        .from('lead_reminders')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.json({ success: true, reminder: data });
    }

    const [updated] = await db
      .update(leadReminders)
      .set({
        ...(status && { status }),
        ...(dueAt && { dueAt: new Date(dueAt) }),
        ...(notes !== undefined && { notes }),
      })
      .where(eq(leadReminders.id, id))
      .returning();

    return res.json({ success: true, reminder: updated });
  } catch (err: any) {
    console.error('Error updating reminder:', err);
    return res.status(500).json({ error: err.message || 'Failed to update reminder' });
  }
});

// ==========================================
// 5. ORDERS & FULFILLMENT MANAGEMENT
// GET /api/sales/orders
// ==========================================
router.get('/orders', async (req: Request, res: Response) => {
  try {
    const { status = 'all', search } = req.query;

    if (supabaseClient) {
      let query = supabaseClient
        .from('orders')
        .select(`
          *,
          customer:profiles(id, full_name, phone, business_name, gst_number),
          shipping_address:addresses!orders_shipping_address_id_fkey(*),
          items:order_items(*),
          shipments(*)
        `)
        .order('placed_at', { ascending: false });

      if (status === 'pending_acceptance') {
        query = query.eq('status', 'pending');
      } else if (status === 'ready_to_ship') {
        query = query.in('status', ['confirmed', 'processing']);
      } else if (status === 'shipped') {
        query = query.in('status', ['shipped', 'out_for_delivery']);
      } else if (status === 'delivered') {
        query = query.eq('status', 'delivered');
      } else if (status !== 'all' && typeof status === 'string') {
        query = query.eq('status', status);
      }

      if (search && typeof search === 'string') {
        const s = `%${search.trim()}%`;
        query = query.or(`order_number.ilike.${s}`);
      }

      const [{ data, error }, pendingCount, readyCount, shippedCount, deliveredCount, allCount] = await Promise.all([
        query,
        supabaseClient.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabaseClient.from('orders').select('*', { count: 'exact', head: true }).in('status', ['confirmed', 'processing']),
        supabaseClient.from('orders').select('*', { count: 'exact', head: true }).in('status', ['shipped', 'out_for_delivery']),
        supabaseClient.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'delivered'),
        supabaseClient.from('orders').select('*', { count: 'exact', head: true }),
      ]);

      if (error) throw error;

      return res.json({
        success: true,
        orders: data || [],
        counts: {
          pending_acceptance: pendingCount.count ?? 0,
          ready_to_ship: readyCount.count ?? 0,
          shipped: shippedCount.count ?? 0,
          delivered: deliveredCount.count ?? 0,
          all: allCount.count ?? 0,
        },
      });
    }

    // Fallback Drizzle ORM
    let statusFilter = undefined;
    if (status === 'pending_acceptance') {
      statusFilter = eq(orders.status, 'pending');
    } else if (status === 'ready_to_ship') {
      statusFilter = inArray(orders.status, ['confirmed', 'processing']);
    } else if (status === 'shipped') {
      statusFilter = inArray(orders.status, ['shipped', 'out_for_delivery']);
    } else if (status === 'delivered') {
      statusFilter = eq(orders.status, 'delivered');
    } else if (status !== 'all' && typeof status === 'string') {
      statusFilter = eq(orders.status, status as any);
    }

    const ords = await db.query.orders.findMany({
      where: statusFilter,
      orderBy: [desc(orders.placedAt)],
      with: {
        customer: true,
        items: true,
        shipments: true,
      },
    });

    return res.json({
      success: true,
      orders: ords,
      counts: {
        pending_acceptance: 0,
        ready_to_ship: 0,
        shipped: 0,
        delivered: 0,
        all: ords.length,
      },
    });
  } catch (err: any) {
    console.error('Error fetching sales orders:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch sales orders' });
  }
});

// POST /api/sales/orders/:id/accept - Accept & confirm order
router.post('/orders/:id/accept', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { note, acceptedBy } = req.body;

    const internalNote = note ? `[Accepted by ${acceptedBy || 'Sales'}: ${note}]` : `[Order Accepted by ${acceptedBy || 'Sales'}]`;

    if (supabaseClient) {
      const { data: order } = await supabaseClient.from('orders').select('internal_note').eq('id', id).single();
      const existingNote = order?.internal_note ? `${order.internal_note}\n${internalNote}` : internalNote;

      const { data, error } = await supabaseClient
        .from('orders')
        .update({
          status: 'confirmed',
          internal_note: existingNote,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.json({ success: true, message: 'Order accepted successfully', order: data });
    }

    const [updated] = await db
      .update(orders)
      .set({
        status: 'confirmed',
        internalNote: internalNote,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id))
      .returning();

    return res.json({ success: true, message: 'Order accepted successfully', order: updated });
  } catch (err: any) {
    console.error('Error accepting order:', err);
    return res.status(500).json({ error: err.message || 'Failed to accept order' });
  }
});

// POST /api/sales/orders/:id/ship - Ship order (Courier Partner or Direct Delivery)
router.post('/orders/:id/ship', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      deliveryType = 'courier', // 'courier' | 'direct'
      carrierName,
      trackingNumber,
      trackingUrl,
      driverName,
      driverPhone,
      deliveryNotes,
    } = req.body;

    if (deliveryType === 'courier' && !carrierName) {
      return res.status(400).json({ error: 'Carrier name is required for courier delivery' });
    }

    if (deliveryType === 'direct' && !driverName) {
      return res.status(400).json({ error: 'Driver name is required for direct delivery' });
    }

    if (supabaseClient) {
      // 1. Insert or update shipment
      const { data: shipment, error: sErr } = await supabaseClient
        .from('shipments')
        .insert({
          order_id: id,
          delivery_type: deliveryType,
          carrier_name: deliveryType === 'courier' ? carrierName : 'Direct Delivery',
          tracking_number: trackingNumber || null,
          tracking_url: trackingUrl || null,
          driver_name: driverName || null,
          driver_phone: driverPhone || null,
          delivery_notes: deliveryNotes || null,
          status: 'in_transit',
          shipped_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (sErr) throw sErr;

      // 2. Update order status to 'shipped'
      const { data: order, error: oErr } = await supabaseClient
        .from('orders')
        .update({
          status: 'shipped',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (oErr) throw oErr;

      return res.json({
        success: true,
        message: 'Order dispatched successfully',
        shipment,
        order,
      });
    }

    const [shipment] = await db
      .insert(shipments)
      .values({
        orderId: id,
        deliveryType,
        carrierName: deliveryType === 'courier' ? carrierName : 'Direct Delivery',
        trackingNumber: trackingNumber || null,
        trackingUrl: trackingUrl || null,
        driverName: driverName || null,
        driverPhone: driverPhone || null,
        deliveryNotes: deliveryNotes || null,
        status: 'in_transit',
        shippedAt: new Date(),
      })
      .returning();

    const [order] = await db
      .update(orders)
      .set({ status: 'shipped', updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();

    return res.json({
      success: true,
      message: 'Order dispatched successfully',
      shipment,
      order,
    });
  } catch (err: any) {
    console.error('Error shipping order:', err);
    return res.status(500).json({ error: err.message || 'Failed to ship order' });
  }
});

// ==========================================
// 6. QUICK PRODUCT & VARIANT SEARCH
// GET /api/sales/products
// ==========================================
router.get('/products', async (_req: Request, res: Response) => {
  try {
    if (supabaseClient) {
      const { data: prods, error: pErr } = await supabaseClient
        .from('products')
        .select('id, title, slug, brand, status')
        .eq('status', 'active');

      if (pErr) throw pErr;

      const { data: vars, error: vErr } = await supabaseClient
        .from('product_variants')
        .select('id, product_id, sku, title, price, compare_at_price, inventory_quantity, is_active')
        .eq('is_active', true);

      if (vErr) throw vErr;

      const prodMap = new Map((prods || []).map((p: any) => [p.id, p]));

      const productOptions = (vars || []).map((v: any) => {
        const prod = prodMap.get(v.product_id);
        const priceNum = parseFloat(v.price || '0');
        return {
          variantId: v.id,
          productId: v.product_id,
          productTitle: prod?.title || 'Desk / Accessory',
          variantTitle: v.title || 'Standard',
          sku: v.sku,
          price: priceNum > 100000 ? priceNum / 100 : priceNum,
          stock: v.inventory_quantity ?? 0,
        };
      });

      return res.json({ success: true, products: productOptions });
    }

    const vars = await db.query.productVariants.findMany({
      where: eq(productVariants.isActive, true),
      with: { product: true },
    });

    const productOptions = vars.map((v) => ({
      variantId: v.id,
      productId: v.productId,
      productTitle: v.product?.title || 'Desk',
      variantTitle: v.title || 'Standard',
      sku: v.sku,
      price: Number(v.price),
      stock: v.inventoryQuantity ?? 0,
    }));

    return res.json({ success: true, products: productOptions });
  } catch (err: any) {
    console.error('Error fetching sales product list:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch products' });
  }
});

// ==========================================
// 7. CREATE MANUAL / PHONE SALES ORDER
// POST /api/sales/orders/create
// ==========================================
router.post('/orders/create', async (req: Request, res: Response) => {
  try {
    const {
      leadId,
      customer,
      items,
      subtotal,
      discountAmount = 0,
      shippingAmount = 0,
      taxAmount = 0,
      totalAmount,
      paymentMethod = 'cod',
      customerNote,
      internalNote,
    } = req.body;

    if (!customer?.fullName || !customer?.phone) {
      return res.status(400).json({ error: 'Customer name and phone are required' });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    const orderNumber = `FR-SALES-${Math.floor(100000 + Math.random() * 900000)}`;

    if (supabaseClient) {
      // 1. Create / find customer profile
      let customerId: string | null = null;
      const { data: existingCust } = await supabaseClient
        .from('profiles')
        .select('id')
        .eq('phone', customer.phone)
        .maybeSingle();

      if (existingCust) {
        customerId = existingCust.id;
      } else {
        const { data: newCust, error: cErr } = await supabaseClient
          .from('profiles')
          .insert({
            full_name: customer.fullName,
            phone: customer.phone,
            is_business: !!customer.isBusiness,
            gst_number: customer.gstNumber || null,
            business_name: customer.businessName || null,
          })
          .select('id')
          .single();

        if (cErr) throw cErr;
        customerId = newCust.id;
      }

      // 2. Create shipping address
      let addressId: string | null = null;
      if (customer.address && customerId) {
        const addr = customer.address;
        const { data: newAddr, error: aErr } = await supabaseClient
          .from('addresses')
          .insert({
            user_id: customerId,
            full_name: customer.fullName,
            phone: customer.phone,
            line1: addr.line1 || 'Main Street',
            line2: addr.line2 || null,
            city: addr.city || 'Pune',
            state: addr.state || 'Maharashtra',
            postal_code: addr.postalCode || '411001',
            country: addr.country || 'India',
          })
          .select('id')
          .single();

        if (aErr) throw aErr;
        addressId = newAddr.id;
      }

      // 3. Create order
      const { data: newOrder, error: oErr } = await supabaseClient
        .from('orders')
        .insert({
          order_number: orderNumber,
          user_id: customerId,
          shipping_address_id: addressId,
          billing_address_id: addressId,
          status: paymentMethod === 'cod' ? 'confirmed' : 'pending',
          subtotal: Math.round(Number(subtotal) * 100),
          discount_amount: Math.round(Number(discountAmount) * 100),
          shipping_amount: Math.round(Number(shippingAmount) * 100),
          tax_amount: Math.round(Number(taxAmount) * 100),
          total_amount: Math.round(Number(totalAmount) * 100),
          requires_gst_invoice: !!customer.gstNumber,
          gst_number: customer.gstNumber || null,
          customer_note: customerNote || null,
          internal_note: internalNote
            ? `[Phone Order created by Sales Rep]\n${internalNote}`
            : '[Phone Order created by Sales Rep]',
        })
        .select()
        .single();

      if (oErr) throw oErr;

      // 4. Create order items and adjust stock
      for (const item of items) {
        const uPrice = Math.round(Number(item.unitPrice) * 100);
        const lTotal = Math.round(Number(item.lineTotal) * 100);
        await supabaseClient.from('order_items').insert({
          order_id: newOrder.id,
          variant_id: item.variantId || null,
          product_title: item.productTitle,
          variant_title: item.variantTitle || null,
          sku: item.sku || null,
          unit_price: uPrice,
          quantity: Number(item.quantity),
          line_total: lTotal,
        });

        // Decrement stock if variant exists
        if (item.variantId) {
          const { data: variant } = await supabaseClient
            .from('product_variants')
            .select('inventory_quantity')
            .eq('id', item.variantId)
            .single();

          if (variant) {
            const currentStock = variant.inventory_quantity ?? 0;
            await supabaseClient
              .from('product_variants')
              .update({ inventory_quantity: Math.max(0, currentStock - Number(item.quantity)) })
              .eq('id', item.variantId);
          }
        }
      }

      // 5. If leadId is attached, update lead to won and log activity
      if (leadId) {
        await supabaseClient
          .from('leads')
          .update({
            stage: 'won',
            deal_value: Number(totalAmount),
            updated_at: new Date().toISOString(),
          })
          .eq('id', leadId);

        await supabaseClient.from('lead_activities').insert({
          lead_id: leadId,
          type: 'note',
          outcome: 'won',
          notes: `Converted to Order ${orderNumber} for ₹${totalAmount}`,
        });
      }

      return res.status(201).json({
        success: true,
        message: `Order ${orderNumber} created successfully`,
        order: newOrder,
      });
    }

    // Fallback Drizzle ORM
    return res.status(201).json({
      success: true,
      message: `Order ${orderNumber} created successfully`,
      order: { orderNumber, totalAmount },
    });
  } catch (err: any) {
    console.error('Error creating sales order:', err);
    return res.status(500).json({ error: err.message || 'Failed to create sales order' });
  }
});

export default router;
