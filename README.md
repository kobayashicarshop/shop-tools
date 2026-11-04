# shop-tools

領収書・見積書・計算機・写真報告書を端末内で使う静的Webアプリです。

- 現在の公開先：<https://kobayashicarshop.github.io/shop-tools/>
- [Cloudflare Pagesへの並行公開手順・調査結果](docs/cloudflare-pages.md)

Cloudflare向けの公開ファイルは `node scripts/build-cloudflare.mjs` で `dist/` に生成します。
ビルドに外部パッケージ・APIキー・環境変数は不要です。
