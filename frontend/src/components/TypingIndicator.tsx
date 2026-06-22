export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2">
      <div className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '200ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: '400ms' }} />
      </div>
      <span className="text-xs text-zinc-500 ml-1">Agent thinking...</span>
    </div>
  );
}
