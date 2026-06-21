import { useState, useEffect } from 'react';
import { useTasks } from '../hooks/useTasks';
import { api } from '../lib/api';
import type { Task, AgentStep } from '../types';
import ProgressLog from './ProgressLog';

const statusColors: Record<string, string> = {
  pending: 'bg-gray-500',
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  cancelled: 'bg-yellow-500',
};

export default function TaskManager() {
  const { tasks, loading, refresh } = useTasks();
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [newDesc, setNewDesc] = useState('');
  const [newModel, setNewModel] = useState('meta/llama-3.1-405b-instruct');

  const handleCreate = async () => {
    if (!newDesc.trim()) return;
    await api.tasks.create({ description: newDesc.trim(), model: newModel });
    setNewDesc('');
    refresh();
  };

  const toggleExpand = async (taskId: string) => {
    if (expandedTask === taskId) {
      setExpandedTask(null);
      return;
    }
    setExpandedTask(taskId);
    const data = await api.tasks.steps(taskId);
    setSteps(data.steps);
  };

  if (loading) return <div className="p-4 text-gray-400">Loading tasks...</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-700">
        <h2 className="text-lg font-semibold">Tasks</h2>
      </div>
      <div className="p-3 border-b border-gray-700 flex gap-2">
        <input
          value={newDesc}
          onChange={e => setNewDesc(e.target.value)}
          placeholder="Task description..."
          className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm"
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
        <button
          onClick={handleCreate}
          className="bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 text-sm"
        >
          Create
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tasks.map(task => (
          <div key={task.id} className="bg-gray-800 rounded-lg p-3">
            <div
              className="flex items-center justify-between cursor-pointer"
              onClick={() => toggleExpand(task.id)}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${statusColors[task.status]}`} />
                <span className="text-sm">{task.description}</span>
              </div>
              <span className="text-xs text-gray-500">{task.status}</span>
            </div>
            {task.status === 'running' && (
              <button
                onClick={() => api.tasks.cancel(task.id).then(refresh)}
                className="mt-2 text-xs text-red-400 hover:text-red-300"
              >
                Cancel
              </button>
            )}
            {expandedTask === task.id && <ProgressLog steps={steps} />}
          </div>
        ))}
      </div>
    </div>
  );
}
