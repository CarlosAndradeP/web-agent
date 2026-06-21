import type { ApprovalRequest } from '../types';

interface Props {
  request: ApprovalRequest;
  onRespond: (approved: boolean) => void;
}

export default function ApprovalDialog({ request, onRespond }: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-3">Approval Required</h3>
        <div className="space-y-2 mb-4 text-sm">
          <div><span className="text-gray-400">Tool:</span> <span className="font-mono text-blue-400">{request.toolName}</span></div>
          <div>
            <span className="text-gray-400">Input:</span>
            <pre className="mt-1 bg-gray-900 rounded p-2 text-xs overflow-x-auto">
              {JSON.stringify(request.toolInput, null, 2)}
            </pre>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onRespond(false)}
            className="bg-gray-600 hover:bg-gray-500 rounded px-4 py-2 text-sm"
          >
            Reject
          </button>
          <button
            onClick={() => onRespond(true)}
            className="bg-green-600 hover:bg-green-700 rounded px-4 py-2 text-sm"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
