/** A transport finish is not evidence that the agent finished its work. */
export function assertAgentCompleted(finishReason: string, text: string): void {
  if (finishReason !== 'stop') {
    const reason = finishReason === 'tool-calls'
      ? 'The step limit was reached while the agent still needed to continue.'
      : `The provider stopped generation with reason: ${finishReason}.`;
    throw new Error(`${reason} Work is incomplete; continue from the saved progress.`);
  }
  if (!text.trim()) throw new Error('The provider returned no final response. Work has not been confirmed complete.');
}
