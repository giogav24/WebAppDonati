// Build with esbuild (no other tooling needed).
//   node scripts/build.mjs           → dist/index.html + assets
//   node scripts/build.mjs --single  → also dist/standalone.html (everything inlined)
//   node scripts/build.mjs --serve   → dev server on http://localhost:5173 with rebuild on change
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const root = new URL('..', import.meta.url).pathname;
const dev = args.has('--serve');

async function bundleWorker() {
  const r = await esbuild.build({
    entryPoints: [root + 'src/worker.ts'], bundle: true, write: false, format: 'iife',
    minify: !dev, target: 'es2020',
  });
  return r.outputFiles[0].text;
}

// The simulation worker is bundled separately and inlined as a string, so the
// app works from a single file and from any static host.
const workerPlugin = {
  name: 'inline-worker',
  setup(build) {
    build.onResolve({ filter: /^virtual:worker$/ }, () => ({ path: 'worker', namespace: 'virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, async () => ({
      contents: `export default ${JSON.stringify(await bundleWorker())};`, loader: 'js',
      watchFiles: [root + 'src/worker.ts'],
    }));
  },
};

const options = {
  entryPoints: [root + 'src/main.tsx'], bundle: true, outdir: root + 'dist/assets',
  minify: !dev, sourcemap: dev, target: 'es2020', jsx: 'automatic',
  plugins: [workerPlugin], logLevel: 'info', metafile: true,
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
};

function writeHtml() {
  const tpl = readFileSync(root + 'index.html', 'utf8');
  mkdirSync(root + 'dist', { recursive: true });
  writeFileSync(root + 'dist/index.html', tpl
    .replace('<!--STYLES-->', '<link rel="stylesheet" href="assets/main.css" />')
    .replace('<!--SCRIPTS-->', '<script src="assets/main.js"></script>'));
  if (args.has('--single')) {
    const css = readFileSync(root + 'dist/assets/main.css', 'utf8');
    const js = readFileSync(root + 'dist/assets/main.js', 'utf8').replace(/<\/script/gi, '<\\/script');
    writeFileSync(root + 'dist/standalone.html', tpl
      .replace('<!--STYLES-->', () => `<style>${css}</style>`)
      .replace('<!--SCRIPTS-->', () => `<script>${js}</script>`));
  }
}

if (dev) {
  const ctx = await esbuild.context({ ...options, plugins: [...options.plugins, { name: 'html', setup(b) { b.onEnd(writeHtml); } }] });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: root + 'dist', port: 5173 });
  console.log(`dev server: http://localhost:${port}`);
} else {
  await esbuild.build(options);
  writeHtml();
}
