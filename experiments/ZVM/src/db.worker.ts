import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import * as SQLite from "wa-sqlite";
import { AccessHandlePoolVFS } from "wa-sqlite/src/examples/AccessHandlePoolVFS.js";
import wasmUrl from "wa-sqlite/dist/wa-sqlite.wasm?url";

type ExecMessage = {
  type: "exec";
  sql: string;
  bindings: unknown[];
  id: number;
};

type RunMessage = {
  type: "run";
  sql: string;
  bindings: unknown[];
  id: number;
};

type WorkerMessage = ExecMessage | RunMessage;

let sqlite3: ReturnType<typeof SQLite.Factory>;
let db: number;
let ready: Promise<void> | undefined;

async function init() {
  const module = await SQLiteESMFactory({
    locateFile: (file: string) => {
      if (file === "wa-sqlite.wasm") return wasmUrl;
      return file;
    },
  });
  sqlite3 = SQLite.Factory(module);

  const vfs = new AccessHandlePoolVFS("/zvm-db", module);
  await vfs.isReady;
  sqlite3.vfs_register(vfs, true);

  db = await sqlite3.open_v2("zvm");
}

async function execSQL(
  sql: string,
  bindings: unknown[],
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  for await (const stmt of sqlite3.statements(db, sql)) {
    if (bindings.length > 0) {
      sqlite3.bind_collection(stmt, bindings);
    }

    const columns = sqlite3.column_names(stmt);
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      const row: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        row[columns[i]] = sqlite3.column(stmt, i);
      }
      rows.push(row);
    }
  }

  return rows;
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  if (!ready) {
    ready = init();
  }
  await ready;

  const msg = e.data;
  try {
    if (msg.type === "exec") {
      const rows = await execSQL(msg.sql, msg.bindings);
      self.postMessage({ type: "result", rows, id: msg.id });
    } else if (msg.type === "run") {
      await execSQL(msg.sql, msg.bindings);
      self.postMessage({ type: "result", rows: [], id: msg.id });
    }
  } catch (err: any) {
    self.postMessage({ type: "error", message: err.message, id: msg.id });
  }
};
