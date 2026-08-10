import { Router } from 'express';
import { basename, dirname, isAbsolute, posix, relative, resolve, sep, win32 } from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import multer from 'multer';
import { ZipArchive as ArchiverZip } from 'archiver';
import AdmZip from 'adm-zip';
import { UsersRepository } from '../db/repositories/users.js';
import { safeWorkspacePath } from '../agent/tools/sanitize.js';
import { getUserWorkspaceDir } from '../lib/workspace-paths.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('FilesAPI');
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_TREE_ENTRIES = 10_000;
const MAX_TREE_DEPTH = 20;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 10, fields: 5 },
});
const editableExtensions = new Set([
    'c', 'cc', 'conf', 'cpp', 'cs', 'css', 'csv', 'env', 'go', 'graphql', 'h', 'hpp', 'htm', 'html',
    'ini', 'java', 'js', 'json', 'jsx', 'log', 'md', 'mjs', 'php', 'properties', 'py', 'rb', 'rs', 'scss',
    'sh', 'sql', 'svg', 'toml', 'ts', 'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml',
]);
export function createFilesRouter(configRepo) {
    const router = Router();
    const usersRepo = new UsersRepository(configRepo.db);
    const getWorkspaceDir = async (req) => {
        const userId = req.user?.userId;
        if (!userId)
            return null;
        const user = usersRepo.findById(userId);
        if (!user)
            return null;
        const dir = getUserWorkspaceDir(user.username);
        await mkdir(dir, { recursive: true });
        return dir;
    };
    const withWorkspace = (handler) => async (req, res) => {
        try {
            const workspaceDir = await getWorkspaceDir(req);
            if (!workspaceDir) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }
            await handler(req, res, workspaceDir);
        }
        catch (error) {
            sendFileError(res, error);
        }
    };
    router.get('/', withWorkspace(async (req, res, workspaceDir) => {
        const requestedPath = stringQuery(req.query.path) || '.';
        const recursive = req.query.recursive === 'true';
        const includeHidden = req.query.includeHidden !== 'false';
        const fullPath = safeWorkspacePath(workspaceDir, requestedPath);
        const targetStat = await stat(fullPath);
        if (!targetStat.isDirectory())
            throw apiError(400, 'Path must be a directory');
        const counter = { count: 0 };
        const tree = await listDir(workspaceDir, fullPath, requestedPath, recursive, includeHidden, counter, 0);
        res.json({ tree });
    }));
    router.get('/content', withWorkspace(async (req, res, workspaceDir) => {
        const requestedPath = requiredQuery(req, 'path');
        const fullPath = safeWorkspacePath(workspaceDir, requestedPath);
        const fileStat = await stat(fullPath);
        if (!fileStat.isFile())
            throw apiError(400, 'Path must be a file');
        if (fileStat.size > MAX_TEXT_PREVIEW_BYTES) {
            throw apiError(413, `File is too large to edit (maximum ${MAX_TEXT_PREVIEW_BYTES / 1024 / 1024} MB)`);
        }
        const buffer = await readFile(fullPath);
        if (buffer.includes(0))
            throw apiError(415, 'Binary files cannot be opened in the text editor');
        const content = buffer.toString('utf8');
        if (req.query.download === 'true') {
            res.attachment(sanitizeFilename(basename(requestedPath))).type('application/octet-stream').send(buffer);
            return;
        }
        res.json({ path: normalizeRelativePath(requestedPath), content, size: fileStat.size, modifiedAt: fileStat.mtime.toISOString() });
    }));
    router.get('/download', withWorkspace(async (req, res, workspaceDir) => {
        const requestedPath = requiredQuery(req, 'path');
        const fullPath = safeWorkspacePath(workspaceDir, requestedPath);
        const fileStat = await stat(fullPath);
        if (!fileStat.isFile())
            throw apiError(400, 'Path must be a file');
        res.attachment(sanitizeFilename(basename(requestedPath)));
        res.setHeader('Content-Length', fileStat.size.toString());
        await pipeline(createReadStream(fullPath), res);
    }));
    router.put('/', withWorkspace(async (req, res, workspaceDir) => {
        const { path: requestedPath, content } = req.body ?? {};
        if (typeof requestedPath !== 'string' || typeof content !== 'string') {
            throw apiError(400, 'path and string content are required');
        }
        if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_PREVIEW_BYTES) {
            throw apiError(413, `Content exceeds the ${MAX_TEXT_PREVIEW_BYTES / 1024 / 1024} MB editor limit`);
        }
        const fullPath = safeWorkspacePath(workspaceDir, requestedPath);
        await mkdir(dirname(fullPath), { recursive: true });
        await atomicWrite(fullPath, content);
        res.json({ success: true, path: normalizeRelativePath(requestedPath) });
    }));
    router.post('/upload', handleMultipart(upload.array('files', 10)), withWorkspace(async (req, res, workspaceDir) => {
        const files = (req.files ?? []);
        const destination = typeof req.body.destination === 'string' ? req.body.destination : '.';
        if (!files.length)
            throw apiError(400, 'No files uploaded');
        const totalBytes = files.reduce((total, file) => total + file.size, 0);
        if (totalBytes > MAX_UPLOAD_TOTAL_BYTES)
            throw apiError(413, 'Combined upload exceeds 100 MB');
        const uploaded = [];
        for (const file of files) {
            const safeName = sanitizeUploadName(file.originalname);
            const relativeTarget = joinRelative(destination, safeName);
            const targetPath = safeWorkspacePath(workspaceDir, relativeTarget);
            await mkdir(dirname(targetPath), { recursive: true });
            await atomicWrite(targetPath, file.buffer);
            uploaded.push(relativeTarget);
        }
        res.json({ success: true, uploaded });
    }));
    router.post('/mkdir', withWorkspace(async (req, res, workspaceDir) => {
        const requestedPath = requiredBodyPath(req);
        const fullPath = safeWorkspacePath(workspaceDir, requestedPath);
        if (fullPath === resolve(workspaceDir))
            throw apiError(409, 'The workspace root already exists');
        await mkdir(fullPath, { recursive: false });
        res.status(201).json({ success: true, path: normalizeRelativePath(requestedPath) });
    }));
    router.delete('/', withWorkspace(async (req, res, workspaceDir) => {
        const requestedPath = requiredQuery(req, 'path');
        const fullPath = safeWorkspacePath(workspaceDir, requestedPath);
        if (fullPath === resolve(workspaceDir))
            throw apiError(400, 'The workspace root cannot be deleted');
        await stat(fullPath);
        await rm(fullPath, { recursive: true, force: false });
        res.json({ success: true, path: normalizeRelativePath(requestedPath) });
    }));
    router.post('/rename', withWorkspace(async (req, res, workspaceDir) => {
        const { oldPath, newPath } = req.body ?? {};
        if (typeof oldPath !== 'string' || typeof newPath !== 'string')
            throw apiError(400, 'oldPath and newPath are required');
        const fullOld = safeWorkspacePath(workspaceDir, oldPath);
        const fullNew = safeWorkspacePath(workspaceDir, newPath);
        if (fullOld === resolve(workspaceDir) || fullNew === resolve(workspaceDir))
            throw apiError(400, 'The workspace root cannot be renamed');
        await stat(fullOld);
        if (await pathExists(fullNew))
            throw apiError(409, 'A file or folder already exists at the destination');
        await mkdir(dirname(fullNew), { recursive: true });
        await rename(fullOld, fullNew);
        res.json({ success: true, oldPath: normalizeRelativePath(oldPath), newPath: normalizeRelativePath(newPath) });
    }));
    router.post('/create-file', withWorkspace(async (req, res, workspaceDir) => {
        const requestedPath = requiredBodyPath(req);
        const fullPath = safeWorkspacePath(workspaceDir, requestedPath);
        if (fullPath === resolve(workspaceDir))
            throw apiError(400, 'A file path is required');
        await mkdir(dirname(fullPath), { recursive: true });
        const handle = await open(fullPath, 'wx');
        await handle.close();
        res.status(201).json({ success: true, path: normalizeRelativePath(requestedPath) });
    }));
    router.get('/download-zip', withWorkspace(async (req, res, workspaceDir) => {
        const requestedPath = requiredQuery(req, 'path');
        const fullPath = safeWorkspacePath(workspaceDir, requestedPath);
        const targetStat = await stat(fullPath);
        if (!targetStat.isDirectory())
            throw apiError(400, 'Path must be a directory');
        const folderName = basename(fullPath);
        res.attachment(`${sanitizeFilename(folderName)}.zip`).type('application/zip');
        const archive = new ArchiverZip({ zlib: { level: 6 } });
        archive.on('warning', error => log.warn('ZIP archive warning', { path: requestedPath, error: error.message }));
        archive.on('error', error => {
            log.error('ZIP archive error', { path: requestedPath, error: error.message });
            res.destroy(error);
        });
        archive.pipe(res);
        archive.directory(fullPath, folderName);
        await archive.finalize();
    }));
    router.post('/extract-zip', handleMultipart(upload.single('zipfile')), withWorkspace(async (req, res, workspaceDir) => {
        const file = req.file;
        const destination = typeof req.body.destination === 'string' ? req.body.destination : '.';
        if (!file)
            throw apiError(400, 'No ZIP file uploaded');
        const safeDest = safeWorkspacePath(workspaceDir, destination);
        const zip = new AdmZip(file.buffer);
        const entries = zip.getEntries();
        if (entries.length > MAX_ZIP_ENTRIES)
            throw apiError(413, `ZIP contains more than ${MAX_ZIP_ENTRIES} entries`);
        let totalBytes = 0;
        const validated = entries.map(entry => {
            const entryName = validateZipEntry(entry.entryName);
            const entrySize = entry.header.size;
            if (entrySize > MAX_ZIP_ENTRY_BYTES)
                throw apiError(413, `ZIP entry is too large: ${entryName}`);
            totalBytes += entrySize;
            if (totalBytes > MAX_ZIP_TOTAL_BYTES)
                throw apiError(413, 'Expanded ZIP exceeds 200 MB');
            const relativeTarget = joinRelative(destination, entryName);
            const fullPath = safeWorkspacePath(workspaceDir, relativeTarget);
            const relToDestination = relative(safeDest, fullPath);
            if (relToDestination === '..' || relToDestination.startsWith(`..${sep}`) || isAbsolute(relToDestination)) {
                throw apiError(400, `Unsafe ZIP entry: ${entry.entryName}`);
            }
            return { entry, entryName, fullPath };
        });
        await mkdir(safeDest, { recursive: true });
        const extracted = [];
        for (const item of validated) {
            if (item.entry.isDirectory) {
                await mkdir(item.fullPath, { recursive: true });
            }
            else {
                await mkdir(dirname(item.fullPath), { recursive: true });
                const data = item.entry.getData();
                if (data.length > MAX_ZIP_ENTRY_BYTES)
                    throw apiError(413, `ZIP entry is too large: ${item.entryName}`);
                await atomicWrite(item.fullPath, data);
            }
            extracted.push(item.entryName);
        }
        res.json({ success: true, destination: normalizeRelativePath(destination), extracted });
    }));
    router.get('/list-folders', withWorkspace(async (req, res, workspaceDir) => {
        const requestedPath = stringQuery(req.query.path) || '.';
        const fullPath = safeWorkspacePath(workspaceDir, requestedPath);
        const entries = await readdir(fullPath, { withFileTypes: true });
        const folders = entries
            .filter(entry => entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git')
            .map(entry => ({ name: entry.name, path: joinRelative(requestedPath, entry.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
        res.json({ folders });
    }));
    return router;
}
async function listDir(workspaceDir, dirPath, relativeDir, recursive, includeHidden, counter, depth) {
    if (depth > MAX_TREE_DEPTH)
        throw apiError(413, `Directory tree exceeds ${MAX_TREE_DEPTH} levels`);
    const entries = await readdir(dirPath, { withFileTypes: true });
    const visible = entries.filter(entry => {
        if (entry.name === 'node_modules' || entry.name === '.git')
            return false;
        return includeHidden || !entry.name.startsWith('.');
    });
    const results = await Promise.all(visible.map(async (entry) => {
        counter.count += 1;
        if (counter.count > MAX_TREE_ENTRIES)
            throw apiError(413, `Directory tree exceeds ${MAX_TREE_ENTRIES} entries`);
        const path = joinRelative(relativeDir, entry.name);
        const full = safeWorkspacePath(workspaceDir, path);
        if (entry.isDirectory()) {
            return {
                name: entry.name,
                path,
                type: 'directory',
                children: recursive ? await listDir(workspaceDir, full, path, true, includeHidden, counter, depth + 1) : undefined,
            };
        }
        const fileStat = await stat(full);
        return {
            name: entry.name,
            path,
            type: 'file',
            size: fileStat.size,
            modifiedAt: fileStat.mtime.toISOString(),
            editable: fileStat.size <= MAX_TEXT_PREVIEW_BYTES && isLikelyEditable(entry.name),
        };
    }));
    return results.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
}
function normalizeRelativePath(value) {
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    return normalized === '' ? '.' : normalized;
}
function joinRelative(parent, child) {
    const normalizedParent = normalizeRelativePath(parent);
    return normalizeRelativePath(normalizedParent === '.' ? child : posix.join(normalizedParent, child));
}
function requiredQuery(req, name) {
    const value = stringQuery(req.query[name]);
    if (!value)
        throw apiError(400, `${name} query parameter is required`);
    return value;
}
function stringQuery(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function requiredBodyPath(req) {
    const value = req.body?.path;
    if (typeof value !== 'string' || !value.trim())
        throw apiError(400, 'path is required');
    return value.trim();
}
function sanitizeFilename(name) {
    return name.replace(/[\r\n"]/g, '').replace(/[^\w .\-()[\]]/g, '_') || 'file';
}
function sanitizeUploadName(name) {
    const safe = sanitizeFilename(basename(name.replace(/\\/g, '/')));
    if (!safe || safe === '.' || safe === '..')
        throw apiError(400, 'Invalid upload filename');
    return safe;
}
function validateZipEntry(name) {
    if (!name || name.includes('\0') || isAbsolute(name) || win32.isAbsolute(name) || /^[A-Za-z]:/.test(name)) {
        throw apiError(400, `Unsafe ZIP entry: ${name}`);
    }
    const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!normalized || normalized.split('/').some(part => part === '..' || part === '')) {
        throw apiError(400, `Unsafe ZIP entry: ${name}`);
    }
    return normalized;
}
function isLikelyEditable(name) {
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    return editableExtensions.has(extension) || name.startsWith('.') || !name.includes('.');
}
async function atomicWrite(path, data) {
    const temporaryPath = `${path}.webagent-${process.pid}-${Date.now()}.tmp`;
    try {
        await writeFile(temporaryPath, data);
        await rename(temporaryPath, path);
    }
    catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function pathExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT')
            return false;
        throw error;
    }
}
function apiError(status, message) {
    return Object.assign(new Error(message), { status });
}
function handleMultipart(middleware) {
    return (req, res, next) => {
        middleware(req, res, error => {
            if (error)
                sendFileError(res, error);
            else
                next();
        });
    };
}
function sendFileError(res, error) {
    if (res.headersSent) {
        res.end();
        return;
    }
    if (error instanceof multer.MulterError) {
        res.status(error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' ? 413 : 400).json({ error: error.message });
        return;
    }
    const status = error instanceof Error && 'status' in error ? Number(error.status) : statusForNodeError(error);
    const message = status >= 500 ? 'File operation failed' : error instanceof Error ? error.message : 'File operation failed';
    if (status >= 500)
        log.error('File operation failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(status).json({ error: message });
}
function statusForNodeError(error) {
    if (!isNodeError(error))
        return 500;
    if (error.code === 'ENOENT')
        return 404;
    if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
        return 409;
    if (error.code === 'EACCES' || error.code === 'EPERM')
        return 403;
    if (error.code === 'ENOSPC')
        return 507;
    return 500;
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
//# sourceMappingURL=files.js.map