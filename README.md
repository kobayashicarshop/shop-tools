# shop-tools

領収書・見積書・計算機・写真報告書を端末内で使う静的Webアプリです。

- GitHub Pages（継続公開）：<https://kobayashicarshop.github.io/shop-tools/>
- Cloudflare Pages（比較公開）：<https://shop-tools-854.pages.dev/>
- [Cloudflare Pagesへの並行公開手順・調査結果](docs/cloudflare-pages.md)

Cloudflare版は別URLで比較公開しています。保存データはURLごとに分かれるため、移行には設定画面のJSONバックアップを使います。

Cloudflare向けの公開ファイルは `node scripts/build-cloudflare.mjs` で `dist/` に生成します。
ビルドに外部パッケージ・APIキー・環境変数は不要です。
