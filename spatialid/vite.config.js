import { defineConfig } from 'vite';

// GitHub Pages は main の /docs を配信するので、ビルド先は docs/spatialid/。
// docs/ 直下に出すと emptyOutDir が Open MCT 側を消すため、必ずサブディレクトリへ出す。
// base はプロジェクトサイト（https://dwg7.github.io/doverture/）配下のパス。
export default defineConfig({
  base: './',   // 相対にしておくとローカル配信でも GitHub Pages でも同じく動く
  build: {
    outDir: '../docs/spatialid',
    emptyOutDir: true,   // docs/spatialid だけを消す。docs/ 直下には触れない
  },
});
