// Bundles src/ into dist/ and copies the static files from public/.
// `node build.mjs --serve` also starts a local dev server on port 8080.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const serve = process.argv.includes('--serve');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari14'],
  minify: !serve,
  sourcemap: serve,
  outfile: 'dist/app.js',
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
