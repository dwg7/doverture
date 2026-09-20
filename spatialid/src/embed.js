/*
 * 埋め込み用のエントリ。Open MCT のような、ビルドを持たないホストから
 * 動的 import で読む。ホスト側にバンドラは要らない。
 *
 *   const { mount } = await import('./spatialid/assets/embed.js');
 *   const panel = mount(element);
 *   // ビュー破棄時に panel.destroy()
 */
import { createPanel } from './panel.js';

export function mount(container, opts = {}) {
  // ホストの中では URL ハッシュを奪わない（Open MCT は自分でハッシュを使う）
  return createPanel(container, { hash: false, ...opts });
}
export default { mount };
