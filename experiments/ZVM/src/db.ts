const worker = new Worker(new URL("./db.worker.ts", import.meta.url), {
  type: "module",
});

let nextId = 0;
const pending = new Map<
  number,
  { resolve: (rows: Record<string, unknown>[]) => void; reject: (err: Error) => void }
>();

worker.onmessage = (e: MessageEvent) => {
  const { id, type, rows, message } = e.data;
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  if (type === "error") {
    entry.reject(new Error(message));
  } else {
    entry.resolve(rows);
  }
};

export function execSQL(
  sql: string,
  bindings: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: "exec", sql, bindings, id });
  });
}

export function runSQL(
  sql: string,
  bindings: unknown[] = [],
): Promise<void> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: () => resolve(),
      reject,
    });
    worker.postMessage({ type: "run", sql, bindings, id });
  });
}

export async function resetDatabase(): Promise<void> {
  // Terminate worker to release OPFS file handles
  worker.terminate();

  // Clear all OPFS entries
  const root = await navigator.storage.getDirectory();
  for await (const name of root.keys()) {
    await root.removeEntry(name, { recursive: true });
  }

  location.reload();
}
