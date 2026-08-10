import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { PixPayment } from '../../types/index.js';

export class PixPaymentsRepository {
  constructor(private db: Database.Database) {}

  create(userId: string, credits: number, amountBrl: number): PixPayment {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO pix_payments (id, user_id, status, credits, amount_brl, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, 'pending', credits, amountBrl, now, now);
    return this.findById(id)!;
  }

  attachProviderData(id: string, providerPaymentId: string, qrCode: string | null, qrCodeBase64: string | null, ticketUrl: string | null, status: string): void {
    this.db.prepare(
      'UPDATE pix_payments SET provider_payment_id = ?, qr_code = ?, qr_code_base64 = ?, ticket_url = ?, status = ?, updated_at = ? WHERE id = ?'
    ).run(providerPaymentId, qrCode, qrCodeBase64, ticketUrl, status, new Date().toISOString(), id);
  }

  findById(id: string): PixPayment | null {
    const row = this.db.prepare('SELECT * FROM pix_payments WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  findByProviderPaymentId(providerPaymentId: string): PixPayment | null {
    const row = this.db.prepare('SELECT * FROM pix_payments WHERE provider_payment_id = ?').get(providerPaymentId) as any;
    return row ? this.mapRow(row) : null;
  }

  listByUser(userId: string, limit = 10): PixPayment[] {
    const rows = this.db.prepare(
      'SELECT * FROM pix_payments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit) as any[];
    return rows.map(row => this.mapRow(row));
  }

  updateStatus(id: string, status: string): void {
    this.db.prepare('UPDATE pix_payments SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  }

  markCredited(id: string, status: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE pix_payments SET status = ?, credited_at = COALESCE(credited_at, ?), updated_at = ? WHERE id = ?').run(status, now, now, id);
  }

  private mapRow(row: any): PixPayment {
    return {
      id: row.id,
      userId: row.user_id,
      providerPaymentId: row.provider_payment_id,
      status: row.status,
      credits: row.credits,
      amountBrl: row.amount_brl,
      qrCode: row.qr_code,
      qrCodeBase64: row.qr_code_base64,
      ticketUrl: row.ticket_url,
      creditedAt: row.credited_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
