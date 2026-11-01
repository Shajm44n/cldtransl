// Bundles src/ into dist/ and copies the static files from public/.
// `node build.mjs --serve` also starts a local dev server on port 8080.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const serve = process.argv.includes('--serve');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
// ONNX Runtime for the offline models, served locally so it works without internet.
mkdirSync('dist/ort', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  cpSync(`node_modules/@huggingface/transformers/dist/${f}`, `dist/ort/${f}`);
}

const options = {
  entryPoints: { app: 'src/main.js', 'offline-worker': 'src/offline-worker.js' },
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari14'],
  minify: !serve,
  sourcemap: serve,
  outdir: 'dist',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 8080, host: '0.0.0.0' });
  console.log(`Dev server: http://localhost:${port}`);
} else {
  await esbuild.build(options);
  console.log('Built to dist/');
}
