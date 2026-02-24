type Mode = 'baseline' | 'rows' | 'seed' | 'seed+subs';

const MODES: Mode[] = ['baseline', 'rows', 'seed', 'seed+subs'];

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

type RunResult = {
  mode: Mode;
  samples: MemSample[];
};

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function runMode(mode: Mode): RunResult {
  const proc = Bun.spawnSync({
    cmd: ['bun', '--expose-gc', 'src/my-zero-memory-demo.ts'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      MODE: mode,
      JSON_MODE: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (proc.exitCode !== 0) {
    throw new Error(
      `Mode ${mode} failed:\n${new TextDecoder().decode(proc.stderr)}`,
    );
  }

  const out = new TextDecoder().decode(proc.stdout).trim();
  const lines = out.split('\n').filter(Boolean);
  const jsonLine = lines.at(-1);
  if (!jsonLine) {
    throw new Error(`Mode ${mode} produced no output`);
  }
  return JSON.parse(jsonLine) as RunResult;
}

function finalSample(run: RunResult): MemSample {
  const sample = run.samples.find(s => s.label === 'final');
  if (!sample) {
    throw new Error(`Mode ${run.mode} missing final sample`);
  }
  return sample;
}

console.log('Running fresh-process memory modes...');
const results = MODES.map(runMode);

const baseline = finalSample(results[0]);

for (const result of results) {
  const sample = finalSample(result);
  const rssDelta = sample.rss - baseline.rss;
  const heapDelta = sample.heapSize - baseline.heapSize;
  const extraDelta = sample.extraMemorySize - baseline.extraMemorySize;
  console.log(
    `${result.mode.padEnd(9)} final rss=${formatMB(sample.rss)} (Δ ${formatMB(rssDelta)}), heapSize=${formatMB(sample.heapSize)} (Δ ${formatMB(heapDelta)}), extra=${formatMB(sample.extraMemorySize)} (Δ ${formatMB(extraDelta)}), objects=${sample.objectCount.toLocaleString()}`,
  );
}
