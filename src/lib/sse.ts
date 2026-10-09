import type { ServerResponse } from 'node:http';

/** Stop pulling the upstream stream while the HTTP client's buffer is full. */
export async function writeSse(res: ServerResponse, event: unknown): Promise<boolean> {
  if (res.destroyed || res.writableEnded) return false;
  if (res.write(`data: ${JSON.stringify(event)}\n\n`)) return true;
  return new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      res.off('error', onError);
    };
    const onDrain = () => { cleanup(); resolve(true); };
    const onClose = () => { cleanup(); resolve(false); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    res.once('drain', onDrain);
    res.once('close', onClose);
    res.once('error', onError);
  });
}
