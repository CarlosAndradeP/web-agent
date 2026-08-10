import { useState } from 'react';
import { CheckCircle2, Download, FileCode2, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

interface Props {
  files: string[];
  totalCount?: number;
  basePath?: string;
}

function joinWorkspacePath(basePath: string | undefined, filePath: string): string {
  const base = basePath && basePath !== '.' ? basePath.replace(/[\\/]+$/, '') : '';
  const file = filePath.replace(/^[\\/]+/, '');
  return base ? `${base}/${file}` : file;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export default function GeneratedFilesCard({ files, totalCount = files.length, basePath }: Props) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (path: string) => {
    setDownloading(path);
    setError(null);
    try {
      const workspacePath = joinWorkspacePath(basePath, path);
      const blob = await api.files.downloadBlob(api.files.downloadUrl(workspacePath));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName(path);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível baixar o arquivo.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]" aria-label="Arquivos entregues pelo agente">
      <div className="flex items-center gap-2 border-b border-emerald-500/10 px-3 py-2.5">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-zinc-200">Arquivos prontos</p>
          <p className="text-[11px] text-zinc-500">Baixe diretamente os arquivos desta entrega.</p>
        </div>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-emerald-300">
          {totalCount} {totalCount === 1 ? 'arquivo' : 'arquivos'}
        </span>
      </div>
      <div className="divide-y divide-zinc-800/70">
        {files.map(path => (
          <button
            key={path}
            type="button"
            onClick={() => download(path)}
            disabled={downloading !== null}
            className="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/40 disabled:cursor-wait disabled:opacity-60"
            aria-label={`Baixar ${fileName(path)}`}
          >
            <FileCode2 className="h-4 w-4 shrink-0 text-zinc-500 group-hover:text-blue-400" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-zinc-300">{fileName(path)}</span>
              <span className="block truncate font-mono text-[10px] text-zinc-600">{path}</span>
            </span>
            {downloading === path
              ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-400" />
              : <Download className="h-4 w-4 shrink-0 text-zinc-600 group-hover:text-zinc-300" />}
          </button>
        ))}
      </div>
      {totalCount > files.length && (
        <p className="border-t border-zinc-800/70 px-3 py-2 text-[10px] text-zinc-500">
          Mais {totalCount - files.length} arquivo(s) disponível(is) no gerenciador de arquivos.
        </p>
      )}
      {error && <p className="border-t border-red-500/10 px-3 py-2 text-[11px] text-red-400" role="alert">{error}</p>}
    </section>
  );
}
