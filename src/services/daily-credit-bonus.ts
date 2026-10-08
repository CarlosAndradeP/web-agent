import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import { config } from '../config.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { CreditsRepository } from '../db/repositories/credits.js';
import { UsersRepository } from '../db/repositories/users.js';
import { createLogger } from './logger.js';

const log = createLogger('DailyCreditBonus');
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const LAST_GRANT_KEY = 'daily_credit_bonus_last_grant_at';

export class DailyCreditBonus {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private db: Database.Database,
    private configRepo: ConfigRepository,
    private creditsRepo: CreditsRepository,
    private usersRepo: UsersRepository,
    private io: Server,
  ) {}

  start(): void {
    if (this.timer) return;
    this.ensureInitialMarker();
    void this.checkAndGrant().catch(err => log.error('Daily bonus check failed; will retry', { error: err.message }));
    this.timer = setInterval(() => {
      void this.checkAndGrant().catch(err => log.error('Daily bonus check failed; will retry', { error: err.message }));
    }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
    log.info('Daily credit bonus started', { creditsPerDay: this.getBonusAmount() });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private ensureInitialMarker(): void {
    if (!this.configRepo.get(LAST_GRANT_KEY)) {
      this.configRepo.set(LAST_GRANT_KEY, new Date().toISOString());
      log.info('Daily credit bonus initial marker created');
    }
  }

  private async checkAndGrant(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const bonusAmount = this.getBonusAmount();
      if (bonusAmount <= 0) return;

      const lastGrantRaw = this.configRepo.get(LAST_GRANT_KEY);
      const lastGrantTime = lastGrantRaw ? Date.parse(lastGrantRaw) : Date.now();
      if (!Number.isFinite(lastGrantTime)) {
        this.configRepo.set(LAST_GRANT_KEY, new Date().toISOString());
        log.warn('Invalid daily bonus marker reset', { lastGrantRaw });
        return;
      }

      const now = Date.now();
      const periods = Math.floor((now - lastGrantTime) / DAY_MS);
      if (periods < 1) return;

      const nextMarker = new Date(lastGrantTime + periods * DAY_MS).toISOString();
      const grants = this.db.transaction(() => {
        if (this.configRepo.get(LAST_GRANT_KEY) !== lastGrantRaw) return [];
        const users = this.usersRepo.list().filter(user => user.role === 'user');
        const results = users.flatMap(user => {
          const amount = bonusAmount * periods;
          const tx = this.creditsRepo.add(user.id, amount, 'bonus', `Daily bonus (${periods} day${periods > 1 ? 's' : ''})`);
          return [{ userId: user.id, newBalance: tx.balanceAfter, added: amount }];
        });
        this.configRepo.set(LAST_GRANT_KEY, nextMarker);
        return results;
      })();
      for (const grant of grants) this.io.to(`user:${grant.userId}`).emit('credits:added', grant);
      log.info('Daily credit bonus granted', { users: grants.length, periods, nextMarker });
    } finally {
      this.running = false;
    }
  }

  private getBonusAmount(): number {
    return Number.isSafeInteger(config.dailyBonusCredits) ? Math.max(0, config.dailyBonusCredits) : 0;
  }
}
