import { createSchema } from "../packages/zero-schema/src/builder/schema-builder.ts";
import { number, string, table } from "../packages/zero-schema/src/builder/table-builder.ts";
import { heapStats } from "bun:jsc";
import { MyZero } from "./my-zero/my-zero.ts";

const ROW_COUNT = Number(process.env.ROW_COUNT ?? 1_000);
const PAYLOAD_BYTES = Number(process.env.PAYLOAD_BYTES ?? 1024);

const records = table("records")
  .columns({
    id: number(),
    payload: string(),
  })
  .primaryKey("id");

const schema = createSchema({
  tables: [records],
  relationships: [],
});

type Mode = "baseline" | "rows" | "seed" | "seed+subs";

const MODE = (process.env.MODE ?? "seed+subs") as Mode;
const JSON_MODE = process.env.JSON_MODE === "1";

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function forceGC() {
  // Bun exposes gc() with --expose-gc and also Bun.gc().
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
    Bun.gc(true);
  }

  if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }
}

type MemSample = {
  label: string;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  heapSize: number;
  heapCapacity: number;
  extraMemorySize: number;
  objectCount: number;
};

const samples: MemSample[] = [];

async function logMemory(label: string): Promise<MemSample> {
  // Give GC and allocator a brief chance to settle before sampling.
  forceGC();
  await Bun.sleep(50);
  forceGC();
  await Bun.sleep(50);
  forceGC();
  const { rss, heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
  const jsc = heapStats();
  const sample: MemSample = {
    label,
    rss,
    heapUsed,
    heapTotal,
    external,
    arrayBuffers,
    heapSize: jsc.heapSize,
    heapCapacity: jsc.heapCapacity,
    extraMemorySize: jsc.extraMemorySize,
    objectCount: jsc.objectCount,
  };
  samples.push(sample);
  if (!JSON_MODE) {
    console.log(
      `[${label}] rss=${formatMB(rss)} heapUsed=${formatMB(heapUsed)} heapTotal=${formatMB(heapTotal)} external=${formatMB(external)} arrayBuffers=${formatMB(arrayBuffers)}`,
    );
    console.log(
      `[${label}:jsc] heapSize=${formatMB(jsc.heapSize)} heapCapacity=${formatMB(jsc.heapCapacity)} extraMemorySize=${formatMB(jsc.extraMemorySize)} objectCount=${jsc.objectCount}`,
    );
  }
  return sample;
}

function makePayload(id: number): string {
  const prefix = `${id.toString(36).padStart(8, "0")}:`;
  if (prefix.length >= PAYLOAD_BYTES) {
    return prefix.slice(0, PAYLOAD_BYTES);
  }
  return prefix + "x".repeat(PAYLOAD_BYTES - prefix.length);
}

function now() {
  return performance.now();
}

async function main() {
  if (!JSON_MODE) {
    console.log(
      `Starting memory demo mode=${MODE} with ${ROW_COUNT.toLocaleString()} rows x ${PAYLOAD_BYTES} bytes payload`,
    );
  }

  await logMemory("start");

  if (MODE === "baseline") {
    await logMemory("final");
    if (JSON_MODE) {
      console.log(JSON.stringify({ mode: MODE, samples }));
    } else {
      console.log("memory demo complete");
    }
    return;
  }

  const zero = new MyZero(schema);

  let rows = Array.from({ length: ROW_COUNT }, (_, id) => ({
    id,
    payload: makePayload(id),
  }));

  await logMemory("rows-allocated");

  if (MODE === "rows") {
    rows = [];
    await logMemory("final");
    if (JSON_MODE) {
      console.log(JSON.stringify({ mode: MODE, samples }));
    } else {
      console.log("memory demo complete");
    }
    return;
  }

  const tSeed = now();
  zero.seed("records", rows);
  console.log(`seed() took ${(now() - tSeed).toFixed(1)} ms`);
  await logMemory("after-seed");

  const firstOldRow = rows[0];
  rows = [];
  await logMemory("after-dropping-local-array");

  if (MODE === "seed") {
    await logMemory("final");
    if (JSON_MODE) {
      console.log(JSON.stringify({ mode: MODE, samples }));
    } else {
      console.log("memory demo complete");
    }
    return;
  }

  let sub1ChangeCount = 0;
  const tSub1 = now();
  const unsub1 = zero.subscribeChanges(zero.query().records, () => {
    sub1ChangeCount++;
  });
  console.log(
    `subscribe #1 hydration changes: ${sub1ChangeCount.toLocaleString()} in ${(now() - tSub1).toFixed(1)} ms`,
  );
  await logMemory("after-subscribe-1");

  let sub2ChangeCount = 0;
  const tSub2 = now();
  const unsub2 = zero.subscribeChanges(zero.query().records.where("id", "<", ROW_COUNT / 2), () => {
    sub2ChangeCount++;
  });
  console.log(
    `subscribe #2 hydration changes: ${sub2ChangeCount.toLocaleString()} in ${(now() - tSub2).toFixed(1)} ms`,
  );
  await logMemory("after-subscribe-2");

  const tEdit = now();
  zero.ingest("records", {
    type: "edit",
    oldRow: firstOldRow,
    row: {
      ...firstOldRow,
      payload: makePayload(9_999_999),
    },
  });
  console.log(`single edit took ${(now() - tEdit).toFixed(1)} ms`);
  await logMemory("after-single-edit");

  unsub1();
  unsub2();
  await logMemory("after-unsubscribe");

  // Setup-only final checkpoint with forced GC.
  await logMemory("final");

  if (process.env.WRITE_HEAP_SNAPSHOT === "1") {
    const snapshot = Bun.generateHeapSnapshot();
    const path = `heap-${Date.now()}.json`;
    await Bun.write(path, JSON.stringify(snapshot));
    console.log(`wrote heap snapshot: ${path}`);
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({ mode: MODE, samples }));
  } else {
    console.log("memory demo complete");
  }
}

await main();
