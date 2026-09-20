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
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/app.[ext]',
      },
    },
  },
});
