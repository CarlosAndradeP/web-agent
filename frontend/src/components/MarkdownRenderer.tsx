import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/github-dark.css';
import { Check, Copy } from 'lucide-react';
import { cn } from '../lib/utils';

let hljs: any = null;
let hljsLoadPromise: Promise<any> | null = null;

function loadHighlight() {
  if (hljs) return Promise.resolve(hljs);
  if (hljsLoadPromise) return hljsLoadPromise;
  hljsLoadPromise = import('highlight.js').then(mod => {
    hljs = mod.default;
    return hljs;
  });
  return hljsLoadPromise;
}

interface Props {
  content: string;
}

function CodeBlock({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [codeString]);

  useEffect(() => {
    if (match && codeRef.current && hljs) {
      try {
        hljs.highlightElement(codeRef.current);
        setHighlighted(true);
      } catch {}
    }
  }, [match, codeString]);

  useEffect(() => {
    if (match && !hljs) {
      loadHighlight().then(() => {
        if (codeRef.current) {
          try {
            hljs.highlightElement(codeRef.current);
            setHighlighted(true);
          } catch {}
        }
      });
    }
  }, []);

  if (match) {
    return (
      <div className="relative group my-3">
        <div className="flex items-center justify-between bg-zinc-800 rounded-t-md px-3 py-1.5 border border-b-0 border-zinc-700">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">{match[1]}</span>
          <button
            onClick={handleCopy}
            className="text-zinc-400 hover:text-zinc-200 transition-colors opacity-0 group-hover:opacity-100"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <pre className="!mt-0 !rounded-t-none border border-zinc-700">
          <code ref={codeRef} className={cn(className, 'text-xs')} {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  }

  return (
    <code className={cn('bg-zinc-800 rounded px-1.5 py-0.5 text-xs font-mono', className)} {...props}>
      {children}
    </code>
  );
}

export default function MarkdownRenderer({ content }: Props) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-0 prose-pre:bg-zinc-800 prose-pre:border prose-pre:border-zinc-700 prose-pre:rounded-md prose-pre:p-3 prose-code:text-blue-300 prose-a:text-blue-400 prose-a:underline hover:prose-a:text-blue-300 prose-strong:text-zinc-100 prose-h1:text-lg prose-h2:text-base prose-h3:text-sm break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock as any,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
