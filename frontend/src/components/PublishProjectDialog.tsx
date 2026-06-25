import { useState } from 'react';
import { api } from '../lib/api';
import type { Project, FileEntry } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: FileEntry[];
  onPublished?: (project: Project) => void;
}

export default function PublishProjectDialog({ open, onOpenChange, tree, onPublished }: Props) {
  const [name, setName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [publishedProject, setPublishedProject] = useState<Project | null>(null);

  const handlePublish = async () => {
    if (!name || !folderPath) {
      setError('Name and folder are required');
      return;
    }
    setPublishing(true);
    setError('');
    try {
      const data = await api.projects.create({ name, folderPath });
      setPublishedProject(data.project);
      onPublished?.(data.project);
    } catch (err: any) {
      setError(err.message || 'Failed to publish project');
    } finally {
      setPublishing(false);
    }
  };

  const handleClose = () => {
    setName('');
    setFolderPath('');
    setError('');
    setPublishedProject(null);
    onOpenChange(false);
  };

  const folders = extractFolders(tree);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{publishedProject ? 'Project Published!' : 'Publish Project'}</DialogTitle>
          <DialogDescription>
            {publishedProject
              ? 'Your project is now live'
              : 'Publish a folder as a web project'}
          </DialogDescription>
        </DialogHeader>

        {publishedProject ? (
          <div className="space-y-3">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
              <div className="text-xs text-zinc-500 mb-1">Project URL</div>
              <a
                href={`/p/${publishedProject.uuid}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:underline break-all"
              >
                {window.location.origin}/p/{publishedProject.uuid}/
              </a>
            </div>
            <div className="flex justify-between text-xs text-zinc-500">
              <span>Type: {publishedProject.type}</span>
              <span>Status: {publishedProject.status}</span>
            </div>
            <Button onClick={handleClose} className="w-full">Done</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              placeholder="Project name"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />

            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Folder</label>
              <select
                value={folderPath}
                onChange={e => setFolderPath(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs text-zinc-200"
              >
                <option value="">Select a folder...</option>
                {folders.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handlePublish} disabled={publishing || !name || !folderPath}>
                {publishing ? 'Publishing...' : 'Publish'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function extractFolders(tree: FileEntry[], prefix = ''): string[] {
  const folders: string[] = [];
  for (const entry of tree) {
    if (entry.type === 'directory') {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      folders.push(path);
      if (entry.children) {
        folders.push(...extractFolders(entry.children, path));
      }
    }
  }
  return folders;
}
