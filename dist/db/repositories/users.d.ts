import type Database from 'better-sqlite3';
import type { UserPublic } from '../../types/index.js';
export interface User {
    id: string;
    username: string;
    email: string | null;
    password_hash: string;
    role: 'admin' | 'user';
    credits: number;
    createdAt: string;
    updatedAt: string;
}
export declare function toPublic(user: User): UserPublic;
export declare class UsersRepository {
    private db;
    constructor(db: Database.Database);
    create(username: string, password: string, role?: 'admin' | 'user', credits?: number, email?: string): User;
    findById(id: string): User | undefined;
    findByUsername(username: string): User | undefined;
    list(): User[];
    updateCredits(id: string, credits: number): void;
    addCredits(id: string, amount: number): number;
    updateRole(id: string, role: 'admin' | 'user'): void;
    delete(id: string): void;
    verifyPassword(user: User, password: string): boolean;
    updatePassword(id: string, newPassword: string): void;
    updateEmail(id: string, email: string | null): void;
    private mapRow;
}
//# sourceMappingURL=users.d.ts.map