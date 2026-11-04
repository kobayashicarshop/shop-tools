# shop-tools

領収書・見積書・計算機・写真報告書・在庫管理を端末内で使う静的Webアプリです。

- GitHub Pages（継続公開）：<https://kobayashicarshop.github.io/shop-tools/>
- Cloudflare Pages（比較公開）：<https://shop-tools-854.pages.dev/>
- [Cloudflare Pagesへの並行公開手順・調査結果](docs/cloudflare-pages.md)
- [在庫管理の使い方・保存とバーコードの制限](docs/inventory.md)

Cloudflare版は別URLで比較公開しています。保存データはURLごとに分かれるため、移行には設定画面のJSONバックアップを使います。

Cloudflare向けの公開ファイルは `node scripts/build-cloudflare.mjs` で `dist/` に生成します。
ビルドに外部パッケージ・APIキー・環境変数は不要です。

在庫管理は無料・広告なしです。商品や入出庫履歴は端末内に保存し、バーコードから外部サービスの商品情報を取得しません。
下部の共通メニュー5項目は維持し、在庫管理はホームのカードから開きます。
計算機の星評価画面は非表示ですが、既存の星評価データとバックアップは保持します。
