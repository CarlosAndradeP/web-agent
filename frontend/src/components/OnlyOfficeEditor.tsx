import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (elementId: string, config: Record<string, unknown>) => { destroyEditor?: () => void };
    };
  }
}

const scriptLoads = new Map<string, Promise<void>>();

function browserOnlyOfficeUrl(publicUrl: string): string {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new Error('ONLYOFFICE_PUBLIC_URL não é uma URL válida');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ONLYOFFICE_PUBLIC_URL deve usar HTTP ou HTTPS');
  }

  // Browsers refuse to load the Document Server API over HTTP when Web Agent
  // itself is on HTTPS. Prefer the secure endpoint when it is available under
  // the same host; plain-HTTP local development remains unchanged.
  if (window.location.protocol === 'https:' && url.protocol === 'http:') {
    url.protocol = 'https:';
  }

  return url.toString().replace(/\/+$/, '');
}

function loadOnlyOffice(publicUrl: string): Promise<void> {
  if (window.DocsAPI) return Promise.resolve();
  const scriptUrl = `${browserOnlyOfficeUrl(publicUrl)}/web-apps/apps/api/documents/api.js`;
  const existing = scriptLoads.get(scriptUrl);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.onload = () => window.DocsAPI ? resolve() : reject(new Error('ONLYOFFICE API did not initialize'));
    script.onerror = () => reject(new Error('Não foi possível conectar ao ONLYOFFICE Docs'));
    document.head.appendChild(script);
  });
  scriptLoads.set(scriptUrl, promise);
  void promise.catch(() => scriptLoads.delete(scriptUrl));
  return promise;
}

interface Props {
  path: string;
  onSaved?: () => void;
}

export default function OnlyOfficeEditor({ path, onSaved }: Props) {
  const reactId = useId();
  const elementId = `onlyoffice-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const editorRef = useRef<{ destroyEditor?: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);

    api.word.editorConfig(path)
      .then(async ({ editorConfig, publicUrl }) => {
        await loadOnlyOffice(publicUrl);
        if (cancelled || !window.DocsAPI) return;
        const config = {
          ...editorConfig,
          events: {
            onDocumentReady: () => !cancelled && setLoading(false),
            onError: (event: { data?: { errorDescription?: string; errorCode?: number } }) => {
              if (!cancelled) setError(event.data?.errorDescription || `Erro do editor (${event.data?.errorCode ?? 'desconhecido'})`);
            },
            onDocumentStateChange: (event: { data?: boolean }) => {
              if (event.data === false) onSaved?.();
            },
          },
        };
        editorRef.current = new window.DocsAPI.DocEditor(elementId, config);
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setLoading(false);
          setError(reason.message || 'Falha ao abrir o documento');
        }
      });

    return () => {
      cancelled = true;
      editorRef.current?.destroyEditor?.();
      editorRef.current = null;
    };
  }, [elementId, path, onSaved]);

  return (
    <div className="relative h-full min-h-0 bg-zinc-950">
      <div id={elementId} className="h-full w-full" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
          <div className="flex items-center gap-3 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin text-blue-400" />Abrindo editor Word...</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 p-6">
          <div className="max-w-md rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
            <h3 className="mt-3 text-sm font-semibold text-zinc-100">Editor Word indisponível</h3>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{error}</p>
            <p className="mt-3 text-[11px] text-zinc-500">Confirme que o serviço ONLYOFFICE está ativo e que ONLYOFFICE_PUBLIC_URL é acessível pelo navegador.</p>
          </div>
        </div>
      )}
    </div>
  );
}
