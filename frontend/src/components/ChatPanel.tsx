import { useState, useRef, useEffect } from 'react';
import { useChat } from '../hooks/useChat';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';
import type { ModelInfo } from '../types';
import MessageBubble from './MessageBubble';
import ToolCallDisplay from './ToolCallDisplay';
import ApprovalDialog from './ApprovalDialog';
import type { ApprovalRequest } from '../types';

interface Props {
  sessionId: string;
}

export default function ChatPanel({ sessionId }: Props) {
  const { messages, send, cancel, isStreaming } = useChat(sessionId);
  const { socket } = useSocket();
  const [input, setInput] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('meta/llama-3.1-405b-instruct');
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.models.list().then(data => {
      setModels(data.models);
      if (data.models.length > 0 && !data.models.find(m => m.id === selectedModel)) {
        setSelectedModel(data.models[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (socket) {
      socket.on('approval:request', (data: ApprovalRequest) => {
        setApproval(data);
      });
      return () => {
        socket.off('approval:request');
      };
    }
  }, [socket]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    send(text, selectedModel);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleApproval = (approved: boolean) => {
    if (socket && approval) {
      socket.emit('approval:respond', { id: approval.id, approved });
    }
    setApproval(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-700 flex items-center gap-3">
        <h2 className="text-lg font-semibold">Chat</h2>
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm flex-1"
        >
          {models.map(m => (
            <option key={m.id} value={m.id}>{m.id}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.isUser ? (
              <MessageBubble role="user" content={msg.content} />
            ) : (
              <MessageBubble role="assistant" content={msg.content} />
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a task for the agent..."
            rows={2}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {isStreaming ? (
            <button
              onClick={cancel}
              className="bg-red-600 hover:bg-red-700 rounded px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleSend}
              className="bg-blue-600 hover:bg-blue-700 rounded px-4 py-2 text-sm font-medium"
            >
              Send
            </button>
          )}
        </div>
      </div>

      {approval && (
        <ApprovalDialog
          request={approval}
          onRespond={handleApproval}
        />
      )}
    </div>
  );
}
