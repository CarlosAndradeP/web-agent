import { Router } from 'express';
import { resolve, basename, normalize, sep } from 'node:path';
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync, createReadStream, existsSync, renameSync } from 'node:fs';
import multer from 'multer';
import { ZipArchive as ArchiverZip } from 'archiver';
import AdmZip from 'adm-zip';
import { UsersRepository } from '../db/repositories/users.js';
import { config } from '../config.js';
import { safeWorkspacePath } from '../agent/tools/sanitize.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('FilesAPI');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
export function createFilesRouter(configRepo) {
    const router = Router();
    const getWorkspaceDir = (req) => {
        const userId = req.user?.userId;
        if (!userId) {
            return null;
        }
        const db = configRepo.db;
        const usersRepo = new UsersRepository(db);
        const user = usersRepo.findById(userId);
        if (!user) {
            return null;
        }
        const dir = resolve(config.workspaceBaseDir, user.username);
        mkdirSync(dir, { recursive: true });
        return dir;
    };
    /** Sanitize filename for Content-Disposition header — strip quotes and CRLF */
    const sanitizeFilename = (name) => {
        return name.replace(/[\r\n"]/g, '').replace(/[^\w .\-]/g, '_') || 'file';
    };
    router.get('/', (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const path = req.query.path ?? '.';
        const recursive = req.query.recursive === 'true';
        try {
            const fullPath = safeWorkspacePath(workspaceDir, path);
            const tree = listDir(fullPath, recursive);
            res.json({ tree });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.get('/content', (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const path = req.query.path;
        if (!path) {
            res.status(400).json({ error: 'path query parameter is required' });
            return;
        }
        try {
            const fullPath = safeWorkspacePath(workspaceDir, path);
            const content = readFileSync(fullPath, 'utf-8');
            if (req.query.download === 'true') {
                const filename = path.split('/').pop() || 'file';
                res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`);
                res.setHeader('Content-Type', 'application/octet-stream');
                res.send(content);
                return;
            }
            res.json({ path, content });
        }
        catch (err) {
            res.status(404).json({ error: err.message });
        }
    });
    router.get('/download', (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const path = req.query.path;
        if (!path) {
            res.status(400).json({ error: 'path query parameter is required' });
            return;
        }
        try {
            const fullPath = safeWorkspacePath(workspaceDir, path);
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
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.put('/', (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const { path, content } = req.body;
        if (!path || content === undefined) {
            res.status(400).json({ error: 'path and content are required' });
            return;
        }
        try {
            const fullPath = safeWorkspacePath(workspaceDir, path);
            mkdirSync(resolve(fullPath, '..'), { recursive: true });
            writeFileSync(fullPath, content, 'utf-8');
            res.json({ success: true, path });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.post('/upload', upload.array('files', 20), (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const files = req.files;
        const dest = req.body.destination || '';
        if (!files || files.length === 0) {
            res.status(400).json({ error: 'No files uploaded' });
            return;
        }
        try {
            const uploaded = [];
            for (const file of files) {
                const safeDest = dest ? safeWorkspacePath(workspaceDir, dest) : workspaceDir;
                const targetPath = resolve(safeDest, file.originalname);
                if (!targetPath.startsWith(resolve(workspaceDir))) {
                    throw new Error('Path traversal detected in upload destination');
                }
                mkdirSync(resolve(targetPath, '..'), { recursive: true });
                writeFileSync(targetPath, file.buffer);
                uploaded.push(file.originalname);
            }
            res.json({ success: true, uploaded });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.post('/mkdir', (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const { path } = req.body;
        if (!path) {
            res.status(400).json({ error: 'path is required' });
            return;
        }
        try {
            const fullPath = safeWorkspacePath(workspaceDir, path);
            mkdirSync(fullPath, { recursive: true });
            res.json({ success: true, path });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.delete('/', (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const path = req.query.path;
        if (!path) {
            res.status(400).json({ error: 'path query parameter is required' });
            return;
        }
        try {
            const fullPath = safeWorkspacePath(workspaceDir, path);
            rmSync(fullPath, { recursive: true, force: true });
            res.json({ success: true, path });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.post('/rename', (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const { oldPath, newPath } = req.body;
        if (!oldPath || !newPath) {
            res.status(400).json({ error: 'oldPath and newPath are required' });
            return;
        }
        try {
            const fullOld = safeWorkspacePath(workspaceDir, oldPath);
            const fullNew = safeWorkspacePath(workspaceDir, newPath);
            renameSync(fullOld, fullNew);
            res.json({ success: true, oldPath, newPath });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.post('/create-file', (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const { path } = req.body;
        if (!path) {
            res.status(400).json({ error: 'path is required' });
            return;
        }
        try {
            const fullPath = safeWorkspacePath(workspaceDir, path);
            mkdirSync(resolve(fullPath, '..'), { recursive: true });
            writeFileSync(fullPath, '', 'utf-8');
            res.json({ success: true, path });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.get('/download-zip', (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const path = req.query.path;
        if (!path) {
            res.status(400).json({ error: 'path query parameter is required' });
            return;
        }
        try {
            const fullPath = safeWorkspacePath(workspaceDir, path);
            if (!existsSync(fullPath)) {
                res.status(404).json({ error: 'Path not found' });
                return;
            }
            const stat = statSync(fullPath);
            if (!stat.isDirectory()) {
                res.status(400).json({ error: 'path must be a directory' });
                return;
            }
            const folderName = basename(fullPath);
            res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(folderName)}.zip"`);
            res.setHeader('Content-Type', 'application/zip');
            const archive = new ArchiverZip({ zlib: { level: 6 } });
            // Without an 'error' listener, an archiver failure (read error mid-stream)
            // raises an unhandled 'error' event on the stream and crashes the Node
            // process. Forward the error to the client if we still can.
            archive.on('error', (err) => {
                log.error('ZIP archive error', { path: req.query.path, error: err.message });
                if (!res.headersSent) {
                    res.status(500).json({ error: `ZIP archive error: ${err.message}` });
                }
                else {
                    try {
                        res.end();
                    }
                    catch { }
                }
            });
            archive.pipe(res);
            archive.directory(fullPath, folderName);
            archive.finalize();
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.post('/extract-zip', upload.single('zipfile'), (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const file = req.file;
        const dest = req.body.destination || '';
        if (!file) {
            res.status(400).json({ error: 'No zip file uploaded' });
            return;
        }
        try {
            const safeDest = dest ? safeWorkspacePath(workspaceDir, dest) : workspaceDir;
            mkdirSync(safeDest, { recursive: true });
            const zip = new AdmZip(file.buffer);
            // Safe extraction: validate each entry path stays within workspace
            const extractedEntries = [];
            const entries = zip.getEntries();
            for (const entry of entries) {
                const entryName = entry.entryName;
                // Validate no path traversal in zip entries
                const normalizedEntry = normalize(entryName);
                if (normalizedEntry.startsWith('..') || normalize(entryName).split(sep).some(part => part === '..')) {
                    return res.status(400).json({ error: `Zip Slip blocked: entry "${entryName}" resolves outside destination` });
                }
                const fullEntryPath = resolve(safeDest, normalizedEntry);
                if (!fullEntryPath.startsWith(resolve(safeDest))) {
                    return res.status(400).json({ error: `Zip Slip blocked: entry "${entryName}" resolves outside workspace` });
                }
                if (entry.isDirectory) {
                    mkdirSync(fullEntryPath, { recursive: true });
                }
                else {
                    mkdirSync(resolve(fullEntryPath, '..'), { recursive: true });
                    writeFileSync(fullEntryPath, entry.getData());
                }
                extractedEntries.push(entryName);
            }
            res.json({ success: true, destination: dest, extracted: extractedEntries });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.get('/list-folders', (req, res) => {
        const workspaceDir = getWorkspaceDir(req);
        if (!workspaceDir) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        const path = req.query.path ?? '.';
        try {
            const fullPath = safeWorkspacePath(workspaceDir, path);
            const entries = readdirSync(fullPath, { withFileTypes: true });
            const folders = entries
                .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
                .map(e => ({ name: e.name, path: path === '.' ? e.name : `${path}/${e.name}` }));
            res.json({ folders });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    return router;
}
function listDir(dirPath, recursive) {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => {
        const full = resolve(dirPath, e.name);
        if (e.isDirectory()) {
            return {
                name: e.name,
                type: 'directory',
                children: recursive ? listDir(full, true) : undefined,
            };
        }
        try {
            return { name: e.name, type: 'file', size: statSync(full).size };
        }
        catch {
            return { name: e.name, type: 'file' };
        }
    });
}
//# sourceMappingURL=files.js.map