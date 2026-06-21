interface Props {
  toolName: string;
  input: unknown;
  output?: unknown;
}

export default function ToolCallDisplay({ toolName, input, output }: Props) {
  return (
    <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-sm">
      <div className="font-mono text-blue-400 mb-1">🔧 {toolName}</div>
      <details className="cursor-pointer">
        <summary className="text-gray-400 text-xs">Input</summary>
        <pre className="mt-1 text-xs text-gray-300 overflow-x-auto">
          {JSON.stringify(input, null, 2)}
        </pre>
      </details>
      {output !== undefined && (
        <details className="cursor-pointer mt-1">
          <summary className="text-gray-400 text-xs">Output</summary>
          <pre className="mt-1 text-xs text-gray-300 overflow-x-auto">
            {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
