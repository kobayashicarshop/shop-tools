# Cloudflare Pagesへの並行公開

## 調査結果と既存公開への影響

2026-11-04、既存の `main`（`3a66c06`）を基点に調査しました。
GitHub Pagesの現行URLがHTTP 200で応答することを確認しています。
GitHubの公開デプロイ記録でも、`github-pages` 環境が `main` の同コミットで成功し、現在の公開URLを指していることを確認しています。

- ビルド不要のHTML/CSS/JavaScript。バックエンド・外部CDN・外部ライブラリの読み込みはありません。
- `index.html` がホーム、`receipt/` が領収書、`estimate/` が見積書、`merchant-calculator/` が計算機、`before-after-tsukurukun/` が写真報告書、`settings/` が共通設定とバックアップです。
- リンク・画像・CSS・JavaScript・manifestは相対パスです。`shared/shell.js` は自分のURLを基準に共通メニューとService Workerのパスを解決します。`/shop-tools/` の固定指定はありません。
- 現存の `.github/workflows/unified-tools.yml` はブラウザーテスト用で、公開設定を書き換える処理はありません。今回このファイルは変更しません。
- GitHubの管理画面側にあるPagesの公開元設定は、この調査では取得できていません。その設定、DNS、既存URL、公開ブランチ、リダイレクトには一切変更を加えません。
- アプリ本体のHTML/CSS/JavaScript、保存キー・DB名・保存形式は変更しません。課金・会員・決済機能も追加しません。

Cloudflareプロジェクトを別URLで追加する構成です。GitHub Pagesを停止・削除する作業はありません。
この変更を `main` にマージしても、既存アプリのファイル内容は変わりません。
Cloudflareに追加するヘッダーと404ページは `dist/` の中だけに生成されます。

## 最初の公開（GitHub Pagesを維持して比較する）

1. Cloudflareにログインします。パスワードやAPIキーをGitHubやチャットへ貼り付ける必要はありません。
2. **Workers & Pages → Create application → Pages → Connect to Git**（または **Import an existing Git repository**）を選びます。画面名が変わっている場合も **PagesのGit連携** を選び、WorkersやDirect Uploadは選びません。
3. GitHubを接続し、アクセス許可は可能なら **Only select repositories → kobayashicarshop/shop-tools** のみにします。GitHub Appのインストール・権限承認画面は利用者が確認して承認します。
4. リポジトリを選び、以下の設定で作成・デプロイします。

| 設定 | 比較公開時の値 |
| --- | --- |
| Project name | `shop-tools` など空いている名前 |
| Production branch | `cloudflare/pages-preparation`（この変更を提案したブランチ） |
| Framework preset | `None` |
| Build command | `node scripts/build-cloudflare.mjs` |
| Build output directory | `dist` |
| Root directory | 空欄（リポジトリのルート） |
| Environment variables / Secrets | なし |

Node.js 22以上で検証します。CloudflareでNodeの選択が必要な場合は22を指定してください。
公開URLはCloudflareが表示する `https://<project-name>.pages.dev/` です。名前が使用済みなら別の名前になり、実際のURLはデプロイ完了画面で確認します。
`/shop-tools/` を付けず、各ツールは `/receipt/`、`/estimate/` などになります。

この段階でCloudflareの「Production branch」は比較用URLの更新元という意味です。GitHubの既定ブランチやGitHub Pagesの公開元は変更しません。
初回はCloudflareのPreview branch設定を `None` にするか、この作業ブランチだけに制限すると、まだビルドスクリプトのない他のブランチの失敗を避けられます。

5. 下の動作確認を行い、結果を見て移行を判断します。
6. 継続利用を決めたらプルリクエストを確認して `main` にマージし、Cloudflareの **Settings → Builds & deployments → Configure Production deployments** でProduction branchを `main` に変更します。**Enable automatic production branch deployments** が有効であることも確認します。GitHub Pagesの設定は維持します。

以後は `main` へのpushでCloudflare版が自動更新されます。プレビュービルドを有効にすれば、同じリポジトリの他ブランチ・PRには別のPreview URLができます。
Preview URL、安定した `pages.dev` URL、将来の独自ドメインは、それぞれ端末内の保存場所が異なります。
実データの復元先には毎回変わるPreview URLではなく、継続利用するURLを使ってください。

## 公開物の作り方

```sh
node scripts/build-cloudflare.mjs
```

外部パッケージのインストールは不要です。公開対象18ファイルを明示し、`dist/` にコピーします。
README・Git履歴・テスト・設定資料・認証情報等はコピーしません。新たな公開ファイルを追加した場合はスクリプトの `PUBLIC_FILES` も更新してください。
`dist/` は生成物であり、Gitへコミットしません。

元のService Workerは固定キャッシュ名とcache-first方式です。そのままだとデプロイ後も旧JavaScript/CSSが使われる場合があるため、Cloudflareの生成物だけでキャッシュ名を公開内容のハッシュに変更します。
`skipWaiting` などのライフサイクル変更は加えません。新しいWorkerが待機中のときは、同じサイトのタブとインストール済みアプリをすべて閉じて開き直すと切り替わります。保存データを消去する操作は不要です。

生成する `_headers` は以下です。

- 全パス：`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`
- 全パス：`X-Robots-Tag: noindex`（比較公開中の検索掲載を抑制）
- `/sw.js`：`Cache-Control: no-cache`

`noindex` は閲覧制限ではありません。正式な検索掲載を希望する場合は、後日ビルドスクリプトからこのヘッダーを外します。
Cloudflareはrootに404がないと不明なURLをホームへfallbackするため、出力に `404.html` を追加します。
`/* /index.html 200` のようなSPAリダイレクトは設定しません。
Cloudflareの `/receipt/index.html` → `/receipt/` 等の正規化はそのまま利用します。

## 保存データと移行手順

住所・顧客名・写真・PDFはブラウザーのlocalStorage / IndexedDB内で処理・保存します。
外部へのアップロード、解析SDK、データ用APIはありません。Service Workerの通信は同一サイトの静的ファイル取得です。
写真報告書の既存の共有ボタンは、利用者がOSの共有先を選んだ場合にその共有先へ渡す機能として維持します。
通常のWebアクセスとしてCloudflareには静的ファイルへのリクエストが届きますが、入力した個人情報や選択した写真を自動送信する処理は追加しません。

**URLのホストが変わると保存場所も変わり、既存データは自動移行・同期されません。旧URL側のデータはそのまま残ります。**

1. 使っていた同じ端末・同じブラウザーでGitHub Pages版を開きます。
2. 各入力の保存が完了したことを確認してホームから「設定・バックアップ」を開き、**すべて書き出す** を押してJSONを手元に保存します。
3. 継続利用するCloudflareのURLを開き、同じ設定画面で **バックアップを読み込む** のファイル選択からJSONを読み込みます。
4. 復元は移行先の保存内容を上書きするため、移行先に既存データがある場合は、そちらも先に書き出します。
5. 各ツールを開いて、入力・履歴・PDF・写真が表示できることを確認します。旧版とバックアップファイルは確認完了後も保管してください。

既存のversion 3バックアップには共通事業者情報、計算機の保存内容、領収書と見積書の下書き・テンプレート・履歴・PDF実体、写真報告の下書きが含まれます。読み込み上限は100MBです。
計算機の請求額・希望額など、元から保存しない入力は移行対象にも入りません。

既存仕様として見積書の税込/税抜・税内訳表示の別保存設定、写真の会社名・担当者名の独立した設定キーは統合JSONに含まれません。
写真下書きの会社名・担当者名は含まれますが、移行先で既に別の設定がある場合はそちらが優先されることがあります。復元後にこの項目を確認・再設定してください。
復元途中に容量不足等が起きるとIndexedDBの一部だけが反映される場合もあるため、成功表示と内容を確認してください。今回これらの保存仕様は変更しません。

## 検証と公開後の確認

ローカルで生成物の内容・秘密ファイルの除外・パス・ハッシュ更新を検証できます。

```sh
node --test tests/cloudflare-build.test.mjs
```

追加のGitHub Actions `Cloudflare Pages compatibility` は公開権限を持たないテスト専用です。
生成した `dist/` をルートと `/shop-tools/` で配信し、既存の `tests/integration.cjs` で領収書・見積書・PDF・履歴・写真下書き・バックアップを確認します。
`tests/cloudflare-migration.cjs` は合成データで異なるorigin間のバックアップ復元と外部送信がないことを検証します。
CI用のPlaywrightは開発・テスト環境だけにインストールし、公開ファイルには入りません。
ローカルHTTPテストではCloudflare固有のヘッダー・正規化・HTTPS Service Workerの動作は再現しません。公開後にも次を確認してください。

- ホームから領収書・見積書・計算機・写真報告・設定へ移動できる。
- ブラウザーのNetworkで画像・CSS・JS・manifest・sw.jsに404や不正なContent-Typeがない。
- 領収書と見積書でPDFの生成・保存・履歴からの再ダウンロードができる。
- 計算機で既存と同じ値を入力して同じ結果になり、保存対象の設定が再表示される。
- 合成写真で報告書を生成・保存でき、画面移動後も写真下書きが残る。
- JSON書き出し・復元を確認し、開発者ツールに外部宛POSTや写真アップロードがない。
- `/receipt/index.html` などの直接アクセスが正常に正規化され、不明なURLは404になる。
- 更新デプロイ後に全タブを閉じて開き直し、新版のJS/CSSに切り替わる。保存済みデータは残る。
- 最後に現在のGitHub Pages URLも引き続き利用できることを確認する。

Cloudflare実アカウントでの作成、GitHub Appの承認、`pages.dev` の実URLでの確認が完了するまでは、公開完了とは扱いません。

## 無料枠

今回の静的配信はPages無料枠で運用できます。Workers/Functions、D1/R2、APIトークン、有料プランは不要です。
2026-11-04の公式資料ではFreeは月500ビルド、同時ビルド1、20,000ファイル、1ファイル25MiBまで。今回の出力は20ファイルで、個人の写真は配信ファイルに含みません。
静的アセットのリクエストは無料・無制限です。上限や料金は変更される可能性があるため、運用時は公式資料を確認してください。
将来の月額課金機能・決済は今回の範囲に含みません。

## 公式資料

- [静的HTMLの公開](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)
- [Git連携](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [GitHubとの連携](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
- [公開ブランチと自動デプロイ設定](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)
- [Preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Pagesの配信と404・リダイレクト](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [ヘッダー設定](https://developers.cloudflare.com/pages/configuration/headers/)
- [Freeプラン等の制限](https://developers.cloudflare.com/pages/platform/limits/)
- [静的アセットの料金](https://developers.cloudflare.com/pages/functions/pricing/)
