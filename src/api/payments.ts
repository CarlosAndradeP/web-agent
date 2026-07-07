import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { PixPaymentsRepository } from '../db/repositories/pix-payments.js';
import { UsersRepository } from '../db/repositories/users.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('PaymentsAPI');
const MERCADO_PAGO_API = 'https://api.mercadopago.com';

interface MercadoPagoPayment {
  id: number | string;
  status: string;
  external_reference?: string;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
}

export function createPaymentsRouter(db: Database.Database, usersRepo: UsersRepository, io: Server) {
  const router = Router();
  const pixRepo = new PixPaymentsRepository(db);

  router.get('/config', authMiddleware, (_req, res) => {
    res.json({
      pixEnabled: Boolean(config.mercadoPagoAccessToken),
      creditPriceBrl: config.pixCreditPriceBrl,
    });
  });

  router.post('/pix', authMiddleware, async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authorization required' });
      return;
    }
    if (!config.mercadoPagoAccessToken) {
      res.status(503).json({ error: 'Pix payments are not configured' });
      return;
    }

    const credits = Math.floor(Number(req.body?.credits));
    if (!Number.isFinite(credits) || credits < 1 || credits > 100000) {
      res.status(400).json({ error: 'credits must be an integer between 1 and 100000' });
      return;
    }

    const user = usersRepo.findById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const amountBrl = roundCurrency(credits * config.pixCreditPriceBrl);
    if (amountBrl < 0.01) {
      res.status(400).json({ error: 'Payment amount is too low' });
      return;
    }

    const localPayment = pixRepo.create(userId, credits, amountBrl);

    try {
      const mpPayment = await createMercadoPagoPixPayment({
        localPaymentId: localPayment.id,
        credits,
        amountBrl,
        payerEmail: user.email || `${user.username}@webagent.local`,
        payerName: user.username,
      });
      const txData = mpPayment.point_of_interaction?.transaction_data;
      pixRepo.attachProviderData(
        localPayment.id,
        String(mpPayment.id),
        txData?.qr_code ?? null,
        txData?.qr_code_base64 ?? null,
        txData?.ticket_url ?? null,
        mpPayment.status || 'pending',
      );

      res.status(201).json({ payment: pixRepo.findById(localPayment.id) });
    } catch (err: any) {
      pixRepo.updateStatus(localPayment.id, 'error');
      log.warn('Failed to create Mercado Pago Pix payment', { userId, paymentId: localPayment.id, error: err.message });
      res.status(502).json({ error: 'Could not create Pix payment' });
    }
  });

  router.get('/pix', authMiddleware, (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authorization required' });
      return;
    }
    res.json({ payments: pixRepo.listByUser(userId) });
  });

  router.get('/pix/:id', authMiddleware, async (req, res) => {
    const userId = req.user?.userId;
    const payment = pixRepo.findById(firstString(req.params.id));
    if (!userId || !payment || payment.userId !== userId) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    if (payment.providerPaymentId && config.mercadoPagoAccessToken && !payment.creditedAt) {
      try {
        const mpPayment = await getMercadoPagoPayment(payment.providerPaymentId);
        await applyMercadoPagoStatus(mpPayment);
      } catch (err: any) {
        log.warn('Failed to refresh Pix payment status', { paymentId: payment.id, error: err.message });
      }
    }

    res.json({ payment: pixRepo.findById(payment.id) });
  });

  router.post('/webhook/mercadopago', async (req, res) => {
    const paymentId = firstString(req.body?.data?.id ?? req.body?.id ?? req.query['data.id'] ?? req.query.id);
    if (!paymentId) {
      res.status(200).json({ received: true });
      return;
    }
    if (!verifyMercadoPagoWebhook(req, paymentId)) {
      res.status(401).json({ error: 'Invalid Mercado Pago webhook signature' });
      return;
    }

    try {
      const mpPayment = await getMercadoPagoPayment(paymentId);
      await applyMercadoPagoStatus(mpPayment);
    } catch (err: any) {
      log.warn('Mercado Pago webhook processing failed', { paymentId, error: err.message });
      res.status(200).json({ received: true });
      return;
    }

    res.json({ received: true });
  });

  async function applyMercadoPagoStatus(mpPayment: MercadoPagoPayment): Promise<void> {
    const providerPaymentId = String(mpPayment.id);
    const payment = pixRepo.findByProviderPaymentId(providerPaymentId);
    if (!payment) {
      log.warn('Mercado Pago payment not found locally', { providerPaymentId, externalReference: mpPayment.external_reference });
      return;
    }

    const status = mpPayment.status || 'pending';
    if (status !== 'approved') {
      pixRepo.updateStatus(payment.id, status);
      return;
    }

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      const claimed = db.prepare(
        'UPDATE pix_payments SET status = ?, credited_at = ?, updated_at = ? WHERE id = ? AND credited_at IS NULL'
      ).run(status, now, now, payment.id);
      if (claimed.changes === 0) return null;

      const userUpdate = db.prepare(
        'UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ?'
      ).run(payment.credits, now, payment.userId);
      if (userUpdate.changes === 0) throw new Error('User not found');

      const balanceRow = db.prepare('SELECT credits FROM users WHERE id = ?').get(payment.userId) as any;
      const newBalance = Number(balanceRow?.credits ?? 0);
      db.prepare(
        'INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(uuid(), payment.userId, payment.credits, newBalance, 'purchase', `Pix Mercado Pago #${providerPaymentId}`, null, now);

      return newBalance;
    });

    const newBalance = tx();
    if (newBalance !== null) {
      io.to(`user:${payment.userId}`).emit('credits:added', {
        userId: payment.userId,
        paymentId: payment.id,
        newBalance,
        added: payment.credits,
      });
      log.info('Pix payment approved and credited', { paymentId: payment.id, providerPaymentId, userId: payment.userId, credits: payment.credits });
    }
  }

  return router;
}

async function createMercadoPagoPixPayment(input: {
  localPaymentId: string;
  credits: number;
  amountBrl: number;
  payerEmail: string;
  payerName: string;
}): Promise<MercadoPagoPayment> {
  const notificationUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, '')}/api/payments/webhook/mercadopago`
    : undefined;

  return mercadoPagoRequest('/v1/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': input.localPaymentId,
    },
    body: JSON.stringify({
      transaction_amount: input.amountBrl,
      description: `${input.credits} créditos Web Agent`,
      payment_method_id: 'pix',
      external_reference: input.localPaymentId,
      notification_url: notificationUrl,
      payer: {
        email: input.payerEmail,
        first_name: input.payerName,
      },
    }),
  });
}

async function getMercadoPagoPayment(paymentId: string): Promise<MercadoPagoPayment> {
  return mercadoPagoRequest(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

async function mercadoPagoRequest(path: string, options: RequestInit): Promise<MercadoPagoPayment> {
  const res = await fetch(`${MERCADO_PAGO_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.mercadoPagoAccessToken}`,
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => null) as any;
  if (!res.ok) {
    const message = data?.message || data?.error || res.statusText;
    throw new Error(`Mercado Pago API error: ${message}`);
  }
  return data as MercadoPagoPayment;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return value == null ? '' : String(value);
}

function verifyMercadoPagoWebhook(req: any, paymentId: string): boolean {
  if (!config.mercadoPagoWebhookSecret) {
    log.warn('Mercado Pago webhook rejected because MERCADO_PAGO_WEBHOOK_SECRET is not configured');
    return false;
  }

  const signatureHeader = firstString(req.headers['x-signature']);
  const requestId = firstString(req.headers['x-request-id']);
  const parts = Object.fromEntries(
    signatureHeader
      .split(',')
      .map(part => part.trim().split('='))
      .filter(([key, value]) => key && value)
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !requestId) return false;

  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    return false;
  }

  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const expected = createHmac('sha256', config.mercadoPagoWebhookSecret).update(manifest).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(v1, 'hex');
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}
