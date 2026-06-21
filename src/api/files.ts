import { Router } from 'express';
import { resolve } from 'node:path';
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync } from 'node:fs';
import type { ConfigRepository } from '../db/repositories/config.js';
import type { FileEntry } from '../types/index.js';

export function createFilesRouter(configRepo: ConfigRepository) {
  const router = Router();

  const getWorkspaceDir = () => configRepo.getAll().workspaceDir;

  router.get('/', (req, res) => {
    const workspaceDir = getWorkspaceDir();
    const path = (req.query.path as string) ?? '.';
    const recursive = req.query.recursive === 'true';
    const fullPath = resolve(workspaceDir, path);
    try {
      const tree = listDir(fullPath, recursive);
      res.json({ tree });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/content', (req, res) => {
    const workspaceDir = getWorkspaceDir();
    const path = req.query.path as string;
    if (!path) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }
    try {
      const fullPath = resolve(workspaceDir, path);
      const content = readFileSync(fullPath, 'utf-8');
      res.json({ path, content });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.put('/', (req, res) => {
    const workspaceDir = getWorkspaceDir();
    const { path, content } = req.body;
    if (!path || content === undefined) {
      res.status(400).json({ error: 'path and content are required' });
      return;
    }
    try {
      const fullPath = resolve(workspaceDir, path);
      mkdirSync(resolve(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content, 'utf-8');
      res.json({ success: true, path });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/', (req, res) => {
    const workspaceDir = getWorkspaceDir();
    const path = req.query.path as string;
    if (!path) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }
    try {
      const fullPath = resolve(workspaceDir, path);
      rmSync(fullPath, { recursive: true, force: true });
      res.json({ success: true, path });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function listDir(dirPath: string, recursive: boolean): FileEntry[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
    .map(e => {
      const full = resolve(dirPath, e.name);
      if (e.isDirectory()) {
        return {
          name: e.name,
          type: 'directory' as const,
          children: recursive ? listDir(full, true) : undefined,
        };
      }
      try {
        return { name: e.name, type: 'file' as const, size: statSync(full).size };
      } catch {
        return { name: e.name, type: 'file' as const };
      }
    });
}
