import { Router } from 'express';
import { resolve } from 'node:path';
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync, createReadStream, existsSync } from 'node:fs';
import multer from 'multer';
import type { ConfigRepository } from '../db/repositories/config.js';
import type { FileEntry } from '../types/index.js';
import { UsersRepository } from '../db/repositories/users.js';
import { config } from '../config.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function createFilesRouter(configRepo: ConfigRepository) {
  const router = Router();

  const getWorkspaceDir = (req: any) => {
    const userId = req.user?.userId;
    if (userId) {
      try {
        const db = (configRepo as any).db;
        const usersRepo = new UsersRepository(db);
        const user = usersRepo.findById(userId);
        if (user) {
          return resolve(config.workspaceBaseDir, user.username);
        }
      } catch {}
    }
    return configRepo.getAll().workspaceDir;
  };

  const safePath = (workspaceDir: string, path: string): string => {
    const fullPath = resolve(workspaceDir, path);
    if (!fullPath.startsWith(resolve(workspaceDir))) {
      throw new Error('Path traversal detected');
    }
    return fullPath;
  };

  router.get('/', (req, res) => {
    const workspaceDir = getWorkspaceDir(req);
    const path = (req.query.path as string) ?? '.';
    const recursive = req.query.recursive === 'true';
    try {
      const fullPath = safePath(workspaceDir, path);
      const tree = listDir(fullPath, recursive);
      res.json({ tree });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/content', (req, res) => {
    const workspaceDir = getWorkspaceDir(req);
    const path = req.query.path as string;
    if (!path) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }
    try {
      const fullPath = safePath(workspaceDir, path);
      const content = readFileSync(fullPath, 'utf-8');
      if (req.query.download === 'true') {
        const filename = path.split('/').pop() || 'file';
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(content);
        return;
      }
      res.json({ path, content });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get('/download', (req, res) => {
    const workspaceDir = getWorkspaceDir(req);
    const path = req.query.path as string;
    if (!path) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }
    try {
      const fullPath = safePath(workspaceDir, path);
      if (!existsSync(fullPath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const stat = statSync(fullPath);
      const filename = path.split('/').pop() || 'file';
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', stat.size.toString());
      const stream = createReadStream(fullPath);
      stream.pipe(res);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/', (req, res) => {
    const workspaceDir = getWorkspaceDir(req);
    const { path, content } = req.body;
    if (!path || content === undefined) {
      res.status(400).json({ error: 'path and content are required' });
      return;
    }
    try {
      const fullPath = safePath(workspaceDir, path);
      mkdirSync(resolve(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content, 'utf-8');
      res.json({ success: true, path });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/upload', upload.array('files', 20), (req, res) => {
    const workspaceDir = getWorkspaceDir(req);
    const files = req.files as Express.Multer.File[];
    const dest = (req.body.destination as string) || '';
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        const safeDest = dest ? safePath(workspaceDir, dest) : workspaceDir;
        const targetPath = resolve(safeDest, file.originalname);
        if (!targetPath.startsWith(resolve(workspaceDir))) {
          throw new Error('Path traversal detected in upload destination');
        }
        mkdirSync(resolve(targetPath, '..'), { recursive: true });
        writeFileSync(targetPath, file.buffer);
        uploaded.push(file.originalname);
      }
      res.json({ success: true, uploaded });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/mkdir', (req, res) => {
    const workspaceDir = getWorkspaceDir(req);
    const { path } = req.body;
    if (!path) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    try {
      const fullPath = safePath(workspaceDir, path);
      mkdirSync(fullPath, { recursive: true });
      res.json({ success: true, path });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/', (req, res) => {
    const workspaceDir = getWorkspaceDir(req);
    const path = req.query.path as string;
    if (!path) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }
    try {
      const fullPath = safePath(workspaceDir, path);
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
