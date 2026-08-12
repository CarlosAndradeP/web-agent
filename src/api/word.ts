import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { Document, Packer, Paragraph } from 'docx';
import { config } from '../config.js';
import { UsersRepository } from '../db/repositories/users.js';
import { SessionsRepository } from '../db/repositories/sessions.js';
import { WordWorkspacesRepository } from '../db/repositories/word-workspaces.js';
import { ConfigRepository } from '../db/repositories/config.js';
import { resolveModels } from '../services/model-resolver.js';
import { getUserWorkspaceDir } from '../lib/workspace-paths.js';
import { safeWorkspacePath } from '../agent/tools/sanitize.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('WordAPI');
const WORD_ROOT = 'Word';
const DOCUMENTS_DIR = 'Documentos';
const TEMPLATES_DIR = 'Modelos';
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 10, fileSize: MAX_FILE_BYTES } });
const editableExtensions = new Set(['.docx', '.docm', '.dotx', '.dotm']);

interface WordAccessToken {
  purpose: 'content' | 'callback';
  userId: string;
  path: string;
}

function sanitizeFilename(input: string, fallback = 'Documento.docx'): string {
  const cleaned = basename(input || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
  return (cleaned || fallback).slice(0, 180);
}

function ensureExtension(name: string, extension = '.docx'): string {
  return extname(name) ? name : `${name}${extension}`;
}

function isEditableWordFile(name: string): boolean {
  return editableExtensions.has(extname(name).toLowerCase());
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
}

async function ensureWordDirectories(username: string) {
  const userRoot = getUserWorkspaceDir(username);
  const wordRoot = safeWorkspacePath(userRoot, WORD_ROOT);
  // Create the scoped root before resolving children so the symlink defense can
  // compare canonical paths even on the workspace's first access.
  await mkdir(wordRoot, { recursive: true });
  const documentsDir = safeWorkspacePath(wordRoot, DOCUMENTS_DIR);
  const templatesDir = safeWorkspacePath(wordRoot, TEMPLATES_DIR);
  await Promise.all([mkdir(documentsDir, { recursive: true }), mkdir(templatesDir, { recursive: true })]);
  return { userRoot, wordRoot, documentsDir, templatesDir };
}

async function listWordFiles(dir: string, kind: 'document' | 'template') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter(entry => entry.isFile() && isEditableWordFile(entry.name))
    .map(async entry => {
      const filePath = join(dir, entry.name);
      const info = await stat(filePath);
      return {
        name: entry.name,
        path: `${WORD_ROOT}/${kind === 'document' ? DOCUMENTS_DIR : TEMPLATES_DIR}/${entry.name}`,
        kind,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      };
    }));
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function availableName(dir: string, requestedName: string): Promise<string> {
  const extension = extname(requestedName);
  const stem = requestedName.slice(0, requestedName.length - extension.length);
  let candidate = requestedName;
  for (let index = 2; index < 10_000; index++) {
    try {
      await stat(join(dir, candidate));
      candidate = `${stem} (${index})${extension}`;
    } catch {
      return candidate;
    }
  }
  throw new Error('Could not allocate a unique filename');
}

function signedAccessToken(payload: WordAccessToken): string {
  return jwt.sign(payload, config.onlyofficeJwtSecret, { expiresIn: payload.purpose === 'callback' ? '24h' : '2h' });
}

function verifyAccessToken(token: string, purpose: WordAccessToken['purpose']): WordAccessToken {
  const payload = jwt.verify(token, config.onlyofficeJwtSecret) as WordAccessToken;
  if (payload.purpose !== purpose || !payload.userId || !payload.path) throw new Error('Invalid Word access token');
  return payload;
}

function resolveTokenFile(db: Database.Database, payload: WordAccessToken): string {
  const user = new UsersRepository(db).findById(payload.userId);
  if (!user) throw new Error('User not found');
  const root = getUserWorkspaceDir(user.username);
  const fullPath = safeWorkspacePath(root, payload.path);
  const wordRoot = safeWorkspacePath(root, WORD_ROOT);
  if (!isInside(wordRoot, fullPath)) throw new Error('File is outside the Word workspace');
  return fullPath;
}

function callbackJwtIsValid(req: Request): boolean {
  const header = req.header('authorization') || req.header('authorizationjwt');
  if (!header) return false;
  const token = header.replace(/^Bearer\s+/i, '');
  try {
    jwt.verify(token, config.onlyofficeJwtSecret);
    return true;
  } catch {
    return false;
  }
}

function resolveOnlyOfficeDownloadUrl(rawUrl: string): URL {
  const downloadUrl = new URL(rawUrl);
  const internalUrl = new URL(config.onlyofficeInternalUrl);
  const publicUrl = new URL(config.onlyofficePublicUrl);

  if (!['http:', 'https:'].includes(downloadUrl.protocol) || downloadUrl.username || downloadUrl.password) {
    throw new Error('Invalid ONLYOFFICE download URL');
  }

  if (downloadUrl.origin === internalUrl.origin) return downloadUrl;
  // The frontend upgrades HTTP to HTTPS when Web Agent itself is served over
  // HTTPS, so compare the configured public authority independently of that
  // browser-only protocol adjustment.
  if (downloadUrl.host !== publicUrl.host) {
    throw new Error(`Unexpected ONLYOFFICE download origin: ${downloadUrl.origin}`);
  }

  // Document Server builds callback download URLs from the browser-facing Host
  // header. Inside Docker that public address may be unreachable (and differs
  // from ONLYOFFICE_INTERNAL_URL), so keep the signed cache path but fetch it
  // through the trusted internal service address.
  return new URL(`${downloadUrl.pathname}${downloadUrl.search}`, internalUrl.origin);
}

export function createWordPublicRouter(db: Database.Database) {
  const router = Router();

  router.get('/content/:token', async (req, res) => {
    try {
      const payload = verifyAccessToken(req.params.token, 'content');
      const filePath = resolveTokenFile(db, payload);
      const info = await stat(filePath);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Invalid Word file');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Length', String(info.size));
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(basename(filePath))}`);
      createReadStream(filePath).pipe(res);
    } catch (error: any) {
      log.warn('Word content access denied', { error: error.message });
      res.status(403).json({ error: 'Invalid or expired document link' });
    }
  });

  router.post('/callback/:token', async (req, res) => {
    try {
      const payload = verifyAccessToken(req.params.token, 'callback');
      if (!callbackJwtIsValid(req)) {
        res.status(403).json({ error: 1 });
        return;
      }

      const statusCode = Number(req.body?.status);
      if ((statusCode === 2 || statusCode === 6) && typeof req.body?.url === 'string') {
        const downloadUrl = resolveOnlyOfficeDownloadUrl(req.body.url);

        const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
        if (!response.ok) throw new Error(`ONLYOFFICE download failed with ${response.status}`);
        const declaredSize = Number(response.headers.get('content-length') || 0);
        if (declaredSize > MAX_FILE_BYTES) throw new Error('Saved document exceeds size limit');
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length > MAX_FILE_BYTES) throw new Error('Saved document exceeds size limit');
        if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) throw new Error('ONLYOFFICE returned an invalid OOXML document');

        const filePath = resolveTokenFile(db, payload);
        const tempPath = `${filePath}.saving-${Date.now()}`;
        await writeFile(tempPath, data, { flag: 'wx' });
        await rename(tempPath, filePath);
        log.info('Word document saved', { path: payload.path, status: statusCode, bytes: data.length });
      }
      res.json({ error: 0 });
    } catch (error: any) {
      log.error('Word callback failed', { error: error.message });
      res.status(500).json({ error: 1 });
    }
  });

  return router;
}

export function createWordRouter(db: Database.Database) {
  const router = Router();
  const usersRepo = new UsersRepository(db);
  const sessionsRepo = new SessionsRepository(db);
  const wordRepo = new WordWorkspacesRepository(db);
  const configRepo = new ConfigRepository(db);

  const withUser = (handler: (req: Request, res: Response, user: NonNullable<ReturnType<UsersRepository['findById']>>) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        const userId = req.user?.userId;
        const user = userId ? usersRepo.findById(userId) : undefined;
        if (!user) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }
        await handler(req, res, user);
      } catch (error: any) {
        log.error('Word request failed', { path: req.path, error: error.message });
        res.status(error?.status || 500).json({ error: error.message || 'Word workspace request failed' });
      }
    };

  router.get('/', withUser(async (_req, res, user) => {
    const dirs = await ensureWordDirectories(user.username);
    const workspace = wordRepo.findByUserId(user.id) ?? null;
    const [documents, templates] = await Promise.all([
      listWordFiles(dirs.documentsDir, 'document'),
      listWordFiles(dirs.templatesDir, 'template'),
    ]);
    res.json({
      configured: !!workspace,
      workspace,
      rootPath: WORD_ROOT,
      documents,
      templates,
      editor: { publicUrl: config.onlyofficePublicUrl },
    });
  }));

  router.post('/setup', withUser(async (req, res, user) => {
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    if (!model) {
      res.status(400).json({ error: 'model is required' });
      return;
    }
    const appConfig = configRepo.getAll();
    const models = await resolveModels(appConfig.apiBaseUrl);
    if (models.length > 0 && !models.some(item => item.id === model)) {
      res.status(400).json({ error: 'Selected model is not available' });
      return;
    }
    await ensureWordDirectories(user.username);

    let workspace = wordRepo.findByUserId(user.id);
    if (!workspace) {
      workspace = db.transaction(() => {
        const session = sessionsRepo.create('Word Workspace', model);
        db.prepare('UPDATE sessions SET user_id = ? WHERE id = ?').run(user.id, session.id);
        return wordRepo.create(user.id, session.id, model);
      })();
    } else {
      db.prepare('UPDATE sessions SET model = ?, updated_at = ? WHERE id = ?').run(model, new Date().toISOString(), workspace.sessionId);
      workspace = wordRepo.updateModel(user.id, model);
    }
    res.json({ configured: true, workspace });
  }));

  router.post('/documents', withUser(async (req, res, user) => {
    const dirs = await ensureWordDirectories(user.username);
    let requestedName = ensureExtension(sanitizeFilename(req.body?.name || 'Novo documento.docx'));
    if (!isEditableWordFile(requestedName)) requestedName = `${requestedName.replace(/\.[^.]+$/, '')}.docx`;
    const fileName = await availableName(dirs.documentsDir, requestedName);
    const destination = safeWorkspacePath(dirs.documentsDir, fileName);

    if (typeof req.body?.templatePath === 'string' && req.body.templatePath) {
      const source = safeWorkspacePath(dirs.userRoot, req.body.templatePath);
      if (!isInside(dirs.templatesDir, source)) {
        res.status(400).json({ error: 'Template must be inside Word/Modelos' });
        return;
      }
      const sourceExtension = extname(source).toLowerCase();
      if (extname(fileName).toLowerCase() !== sourceExtension) {
        const matchingName = await availableName(dirs.documentsDir, `${fileName.slice(0, -extname(fileName).length)}${sourceExtension}`);
        const matchingDestination = safeWorkspacePath(dirs.documentsDir, matchingName);
        await copyFile(source, matchingDestination);
        res.status(201).json({ success: true, path: `${WORD_ROOT}/${DOCUMENTS_DIR}/${matchingName}`, name: matchingName });
        return;
      }
      await copyFile(source, destination);
    } else {
      const document = new Document({ sections: [{ children: [new Paragraph('')] }] });
      await writeFile(destination, await Packer.toBuffer(document), { flag: 'wx' });
    }
    res.status(201).json({ success: true, path: `${WORD_ROOT}/${DOCUMENTS_DIR}/${fileName}`, name: fileName });
  }));

  const uploadHandler = (kind: 'document' | 'template') => withUser(async (req, res, user) => {
    const dirs = await ensureWordDirectories(user.username);
    const targetDir = kind === 'document' ? dirs.documentsDir : dirs.templatesDir;
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (!files.length) {
      res.status(400).json({ error: 'At least one Word file is required' });
      return;
    }
    const uploaded: string[] = [];
    for (const file of files) {
      const safeName = sanitizeFilename(file.originalname);
      if (!isEditableWordFile(safeName)) {
        res.status(400).json({ error: `Unsupported Word format: ${safeName}` });
        return;
      }
      if (file.buffer.length < 4 || file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
        res.status(400).json({ error: `Invalid or corrupted OOXML file: ${safeName}` });
        return;
      }
      const fileName = await availableName(targetDir, safeName);
      await writeFile(safeWorkspacePath(targetDir, fileName), file.buffer, { flag: 'wx' });
      uploaded.push(`${WORD_ROOT}/${kind === 'document' ? DOCUMENTS_DIR : TEMPLATES_DIR}/${fileName}`);
    }
    res.status(201).json({ success: true, uploaded });
  });

  router.post('/documents/upload', upload.array('files', 10), uploadHandler('document'));
  router.post('/templates/upload', upload.array('files', 10), uploadHandler('template'));

  router.patch('/files', withUser(async (req, res, user) => {
    const dirs = await ensureWordDirectories(user.username);
    const oldPath = safeWorkspacePath(dirs.userRoot, String(req.body?.path || ''));
    if (!isInside(dirs.documentsDir, oldPath) && !isInside(dirs.templatesDir, oldPath)) {
      res.status(400).json({ error: 'File is outside the Word workspace' });
      return;
    }
    let newName = sanitizeFilename(String(req.body?.name || ''));
    const oldExtension = extname(oldPath).toLowerCase();
    if (!extname(newName)) newName += oldExtension;
    if (extname(newName).toLowerCase() !== oldExtension) {
      res.status(400).json({ error: 'The file extension cannot be changed' });
      return;
    }
    const newPath = safeWorkspacePath(resolve(oldPath, '..'), newName);
    await rename(oldPath, newPath);
    res.json({ success: true });
  }));

  router.delete('/files', withUser(async (req, res, user) => {
    const dirs = await ensureWordDirectories(user.username);
    const filePath = safeWorkspacePath(dirs.userRoot, String(req.query.path || ''));
    if ((!isInside(dirs.documentsDir, filePath) && !isInside(dirs.templatesDir, filePath)) || !isEditableWordFile(filePath)) {
      res.status(400).json({ error: 'File is outside the Word workspace' });
      return;
    }
    await rm(filePath, { force: false });
    res.json({ success: true });
  }));

  router.get('/download', withUser(async (req, res, user) => {
    const dirs = await ensureWordDirectories(user.username);
    const filePath = safeWorkspacePath(dirs.userRoot, String(req.query.path || ''));
    if ((!isInside(dirs.documentsDir, filePath) && !isInside(dirs.templatesDir, filePath)) || !isEditableWordFile(filePath)) {
      res.status(400).json({ error: 'File is outside the Word workspace' });
      return;
    }
    const data = await readFile(filePath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(basename(filePath))}`);
    res.send(data);
  }));

  router.get('/editor-config', withUser(async (req, res, user) => {
    const workspace = wordRepo.findByUserId(user.id);
    if (!workspace) {
      res.status(409).json({ error: 'Choose an AI model before opening the Word workspace' });
      return;
    }
    const dirs = await ensureWordDirectories(user.username);
    const requestedPath = String(req.query.path || '');
    const filePath = safeWorkspacePath(dirs.userRoot, requestedPath);
    if (!isInside(dirs.documentsDir, filePath) || !isEditableWordFile(filePath)) {
      res.status(400).json({ error: 'Only documents in Word/Documentos can be edited' });
      return;
    }
    const info = await stat(filePath);
    if (!info.isFile()) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const normalizedPath = requestedPath.replace(/\\/g, '/');
    const contentToken = signedAccessToken({ purpose: 'content', userId: user.id, path: normalizedPath });
    const callbackToken = signedAccessToken({ purpose: 'callback', userId: user.id, path: normalizedPath });
    const fileType = extname(filePath).slice(1).toLowerCase();
    const key = createHash('sha256').update(`${user.id}:${normalizedPath}:${info.mtimeMs}`).digest('hex').slice(0, 40);
    const editorConfig: Record<string, any> = {
      documentType: 'word',
      type: 'desktop',
      width: '100%',
      height: '100%',
      document: {
        fileType,
        key,
        title: basename(filePath),
        url: `${config.onlyofficeStorageUrl}/api/word/content/${contentToken}`,
        permissions: { edit: true, download: true, print: true, review: true, comment: true, fillForms: true },
      },
      editorConfig: {
        mode: 'edit',
        lang: 'pt',
        region: 'pt-BR',
        callbackUrl: `${config.onlyofficeStorageUrl}/api/word/callback/${callbackToken}`,
        user: { id: user.id, name: user.username },
        customization: {
          autosave: true,
          forcesave: true,
          compactHeader: false,
          help: true,
          hideRightMenu: false,
        },
      },
    };
    editorConfig.token = jwt.sign(editorConfig, config.onlyofficeJwtSecret);
    res.json({ editorConfig, publicUrl: config.onlyofficePublicUrl });
  }));

  return router;
}
