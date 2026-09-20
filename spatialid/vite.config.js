import { defineConfig } from 'vite';

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
  base: './',
  build: {
    outDir: '../docs/spatialid',
    emptyOutDir: true,
    rollupOptions: {
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
