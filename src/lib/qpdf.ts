/**
 * qpdf compiled to wasm (@jspawn/qpdf-wasm; import the CJS `qpdf.js` — its `qpdf.mjs` wrapper relies on
 * classic-script globals that Rollup's CommonJS handling breaks) — used ONLY to strip encryption so pdf-lib
 * can re-assemble pages losslessly. Lazy: the ~1.3 MB wasm downloads on first use.
 * pdf.js can read encrypted files by itself; this is the write-side helper.
 */

interface QpdfModule {
  FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array; unlink(p: string): void };
  callMain(args: string[]): number;
}
type Factory = (opts: Record<string, unknown>) => Promise<QpdfModule>;

let factory: Promise<{ create: Factory; wasmUrl: string }> | null = null;

function load() {
  if (!factory) {
    factory = Promise.all([
      import('@jspawn/qpdf-wasm/qpdf.js'),
      import('@jspawn/qpdf-wasm/qpdf.wasm?url'),
    ])
      .then(([m, w]) => ({ create: m.default as unknown as Factory, wasmUrl: w.default }))
      .catch((e) => { factory = null; throw e; });
  }
  return factory;
}

export class QpdfError extends Error {
  constructor(public log: string, public code: number) {
    super(`qpdf exit ${code}`);
  }
}

/** Run one qpdf command on a fresh module instance (the CLI is single-shot). */
async function run(args: string[], input: Uint8Array): Promise<Uint8Array> {
  const { create, wasmUrl } = await load();
  let log = '';
  const m = await create({
    noInitialRun: true,
    locateFile: () => wasmUrl,
    print: (s: string) => { log += s + '\n'; },
    printErr: (s: string) => { log += s + '\n'; },
  });
  m.FS.writeFile('/in.pdf', input);
  let code: number;
  try {
    code = m.callMain([...args, '/in.pdf', '/out.pdf']);
  } catch (e) {
    code = typeof (e as { status?: number }).status === 'number' ? (e as { status: number }).status : 1;
  }
  // exit 3 = warnings only, output still written
  if (code !== 0 && code !== 3) throw new QpdfError(log, code);
  return m.FS.readFile('/out.pdf');
}

/** Encrypted → plain PDF bytes. Throws QpdfError (wrong password → code 2). */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return run([`--password=${password}`, '--decrypt'], bytes);
}

/**
 * Plain → AES-256 encrypted PDF. `user` opens the file (empty = anyone can open but
 * permissions apply), `owner` unlocks everything (falls back to `user` when empty).
 */
export async function encryptPdf(bytes: Uint8Array, user: string, owner: string): Promise<Uint8Array> {
  return run(['--encrypt', user, owner || user, '256', '--'], bytes);
}
