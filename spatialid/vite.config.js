import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/*
 * MapLibre v6 は main / shared / worker の3分割配布で、worker はさらに
 * ./maplibre-gl-shared.mjs を import する。`?url` は1ファイルしか出力しないので、
 * 出力した .mjs の import を辿って、必要なものを全部 assets/ へ運ぶ。
 * 足りないと 404 になり、ワーカーが起動せず、ベクタが無言で描かれない。
 */
function maplibreWorkerDeps() {
  const DIST = path.dirname(new URL(import.meta.resolve('maplibre-gl')).pathname);
  return {
    name: 'maplibre-worker-deps',
    apply: 'build',
    closeBundle() {
      const outAssets = path.resolve(__dirname, '../docs/spatialid/assets');
      const seen = new Set();
      const queue = fs.readdirSync(outAssets).filter((f) => f.endsWith('.mjs'));
      while (queue.length) {
        const f = queue.shift();
        if (seen.has(f)) continue;
        seen.add(f);
        const body = fs.readFileSync(path.join(outAssets, f), 'utf8');
        for (const m of body.matchAll(/from\s*["']\.\/([A-Za-z0-9._-]+\.mjs)["']/g)) {
          const dep = m[1];
          if (seen.has(dep)) continue;
          const src = path.join(DIST, dep);
          if (!fs.existsSync(src)) {
            this.warn(`MapLibre の依存 ${dep} が ${DIST} に見つからない`);
            continue;
          }
          fs.copyFileSync(src, path.join(outAssets, dep));
          console.log(`  maplibre 依存をコピー: assets/${dep}`);
          queue.push(dep);
        }
      }
    },
  };
}

// GitHub Pages は main の /docs を配信する。ビルド先は docs/spatialid/ ——
// docs/ 直下に出すと emptyOutDir が Open MCT 側を消すため、必ずサブディレクトリへ。
//
// base は相対。'/doverture/spatialid/' を焼き込むとローカル配信で解決できない。
//
// ファイル名にハッシュを使わない：GitHub Pages は CSS/JS を約10分キャッシュするので、
// 古い index.html が「もう存在しないハッシュ名」を指して 404 → 真っ白、という
// 硬い壊れ方をする。固定名なら古くても同じファイルを指し続け、キャッシュが切れれば
// 自然に直る（柔らかい壊れ方）。
export default defineConfig({
  plugins: [maplibreWorkerDeps()],
  base: './',
  build: {
    outDir: '../docs/spatialid',
    emptyOutDir: true,
    rollupOptions: {
      // Vite のアプリビルドは既定で preserveEntrySignatures: false ——
      // エントリを「副作用だけ」とみなして **export を落とす**。
      // 埋め込み用エントリは mount を公開しないと意味がないので strict にする。
      preserveEntrySignatures: 'strict',
      // index.html（スタンドアロン）と embed.js（Open MCT から動的 import する
      // 埋め込み用エントリ）の2つを出す。中身は同じ panel.js。
      input: {
        index: path.resolve(__dirname, 'index.html'),
        'doverture-panel': path.resolve(__dirname, 'src/embed.js'),
      },
      output: {
        // ハッシュは使わない（古い index.html が存在しないファイルを指して真っ白に
        // なるのを避ける）。ただし **リテラルの固定名にはしない** ——
        // MapLibre は自分のワーカーを assets/maplibre-gl-worker.mjs という
        // 名前で参照するので、名前を潰すと 404 になり、ワーカーが起動せず、
        // ベクタが一切描かれないまま沈黙する（実際にそうなった）。
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
