# バーコード読取ライブラリと検証記録

2026-11-04に公式npm registryの`latest`を確認し、次の固定版を同梱しました。
利用時にCDNへ接続せず、撮影フレーム・選択画像・読取文字列を外部へ送りません。

| パッケージ | 固定版 | 公式公開日 | ライセンス |
| --- | --- | --- | --- |
| `@zxing/browser` | `0.2.1` | 2026-07-06 | MIT |
| `@zxing/library` | `0.23.0` | 2026-04-29 | Apache-2.0 |

取得元は[browserの公式registry](https://registry.npmjs.org/@zxing/browser/0.2.1)と[libraryの公式registry](https://registry.npmjs.org/@zxing/library/0.23.0)です。
各registryの`dist.tarball`を取得し、アーカイブ全体のSHA-512が`dist.integrity`と一致することを確認してから、UMDとLICENSEだけを取り出しました。
UMDのコードは変更していません。実行時のnpmインストール・APIキー・有料SDKは不要です。

| 同梱ファイル | バイト数 | SHA-256 |
| --- | --- | --- |
| `inventory/vendor/zxing-browser-0.2.1.min.js` | 441121 | `066bc34edfcdd4a33f0964aeec967752a0dea1ccaf36e58e319ac9fcb5070f6a` |
| `inventory/vendor/zxing-library-0.23.0.min.js` | 362150 | `3ede94153fb0c5b67a12d7adff6decd827c2b22714fdc6faecf27a8f20937ea6` |

## 商用利用と配布時の表示

MIT、Apache-2.0とも商用利用・再配布を認めるライセンスです。著作権表示とライセンス本文を保持して配布します。
[browserのMIT本文](https://github.com/zxing-js/browser/blob/v0.2.1/LICENSE)、[libraryのApache-2.0本文と同梱告知](https://github.com/zxing-js/library/blob/v0.23.0/LICENSE)を、変更せず次のファイルに保存しています。

- `inventory/vendor/ZXING-BROWSER-LICENSE.txt`
- `inventory/vendor/ZXING-LIBRARY-LICENSE.txt`（上流のjai-imageio告知も含む）
- `inventory/vendor/TS-CUSTOM-ERROR-LICENSE.txt`（バンドルされた補助コードの[MITライセンス](https://github.com/adriengibrat/ts-custom-error/blob/v3.3.1/LICENSE)）

UMDを更新・置換するときは、同梱する依存コードとライセンス・告知も再確認してください。

## 読取方式とSafari

`inventory/scanner.js`から両UMDを同一サイト内の相対パスでimportします。
`ZXingBrowser.HTMLCanvasElementLuminanceSource`でCanvasを画素データにし、固定した`ZXing.MultiFormatReader`へ渡します。
`POSSIBLE_FORMATS`をEAN-13、EAN-8、UPC-A、UPC-E、Code 128、QRに限定し、`TRY_HARDER`を有効にします。
APIの根拠は[browserの読取API](https://github.com/zxing-js/browser/blob/v0.2.1/src/readers/BrowserCodeReader.ts)、[libraryの利用例](https://github.com/zxing-js/library/tree/v0.23.0#usage)です。

ネイティブ`BarcodeDetector`は使用しません。SafariなどそのAPIがない環境も同じJavaScriptの処理を通ります。
カメラ開始は利用者の操作を起点にし、`getUserMedia`で音声を無効、背面カメラを`ideal`で希望します。
`video`は`muted`、`autoplay`、`playsinline`に設定します。背面カメラが必ず選ばれるという保証はありません。
HTTPSなどのsecure contextとカメラ権限が必要です。拒否・カメラなし・他アプリとの競合は日本語メッセージを返し、画像読取や手入力を利用できるようにします。
根拠は[WebKitのカメラAPI説明](https://webkit.org/blog/7763/a-closer-look-into-webrtc/)と[iOSのinline video仕様](https://webkit.org/blog/6784/new-video-policies-for-ios/)です。

カメラの解析は約240ms間隔、最大辺1280pxです。読取後は1回だけ結果を返して停止します。
閉じる操作、`visibilitychange`で非表示になった場合、`pagehide`で全トラックと解析タイマーを停止します。
開始待ちの権限応答・再生応答・画像読込はgeneration tokenで無効化し、閉じた後に遅れて返ったストリームも停止します。
権限ダイアログ自体はWeb APIから強制的には閉じられません。

現時点の自動検証はChromiumです。実機のiPhone Safari・Androidカメラでの照明、ピント、権限操作、画面移動後のカメラ表示は別途確認が必要です。

## UPC-Eの互換処理

今回、正しいチェック桁を持つ自作UPC-E画像`01234565`が固定版ZXingだけでは読み取れないことを再現しました。
公式には[UPC-Eを読めないというissue #576](https://github.com/zxing-js/library/issues/576)がありますが、これは旧`0.20.0`の報告です。
現在の固定版の同一原因・上流修正状況を確認したという意味ではありません。

今回確認したソース上の不整合は、[`UPCEReader.decodeMiddle`の戻り値が数値`rowOffset`](https://github.com/zxing-js/library/blob/v0.23.0/src/core/oned/UPCEReader.ts#L88-L110)である一方、[基底`UPCEANReader.decodeRow`は`rowOffset`と`resultString`を持つオブジェクトを期待](https://github.com/zxing-js/library/blob/v0.23.0/src/core/oned/UPCEANReader.ts#L58-L60)している点です。
この観察と合成画像での失敗を根拠に、ライブラリ本体を変更せず`scanner.js`にUPC-E専用の互換読取を追加しました。

共通`decodeCanvas()`でZXingが読取失敗した場合だけ、UPC-Eの開始・終了ガード、余白、数字のバー幅、パリティを照合します。
number systemは0と1だけに限定し、検算用にUPC-Aへ展開してチェック桁を検証します。
**外部へ返す値は元のUPC-Eの8文字です。UPC-Aへの変換や先頭0の除去は行いません。**
画像・カメラの両方が同じ処理を使用します。90度の回転と逆方向も試しますが、反射・曲面・斜め撮影など実物条件での精度は未確認です。
上流で読取が改善された場合は合成画像と実機で比較し、この互換処理を残す必要があるか再判断してください。

## API契約と画像上限

```js
const scanner = new BarcodeScanner(video, {
  onResult: ({ text, format }) => { /* 文字列として扱う */ },
  onError: error => { /* error.messageを表示 */ },
});
await scanner.start();           // 開始できればtrue、失敗・中止はfalse
scanner.stop();                  // 同期的に停止。再開可能
await scanner.readImage(file);   // 成功は同じ結果object、失敗・中止はnull
scanner.destroy();               // UIを破棄するときはイベント監視も解除
```

`readImage`成功時は`onResult`も1回呼びます。失敗時は`onError`を1回、中止時は呼びません。
QRにURLが入っていても文字列を返すだけで、リンク・ページ移動・URL取得は行いません。
別の商品コードに書き換える処理や商品検索APIへの接続もありません。

- 入力ファイルは30MiB以下。PNG、JPEG、WebP、GIF、BMP、AVIF、HEIC、HEIFのMIMEを受け付けます。
- 実際に開ける画像形式はブラウザー依存です。開けない場合はPNG/JPEGへの変換を案内します。
- SVGを拒否します。外部画像を参照するSVGも画像として読み込みません。
- 展開後は25メガピクセル以下、縦横それぞれ12,000px以下。読込待ちは10秒、再生待ちは8秒で打ち切ります。
- 読取用Canvasは最大辺2400pxへ縮小します。読取後の画像・Object URL・カメラ映像は保持せず、保存領域へ書き込みません。

## 自作fixtureと検証

`tests/barcode-fixtures/generate.cjs`が合成テスト番号からPNGを生成します。市販品の写真・他者のラベル画像を転載していません。
EAN/UPCの数字パターンとチェック桁、Code 128のシンボル、QRの内容を指定した自作画像です。
Code 128定数とQR encoderは同梱ZXingを使用し、Apache-2.0の表示を保持しています。
新規のテストデータ・画像・生成コードは本リポジトリ向けに作成し、利用・変更・再生成できます。

```sh
node tests/barcode-fixtures/generate.cjs
TEST_BASE_URL=http://127.0.0.1:8765 node tests/barcode-decode.cjs
```

テスト実行には既存のPlaywright開発環境と静的HTTPサーバーを使います。fixtureやテストコードは公開成果物に含めません。
2026-11-04、ローカルChromiumで次を確認しました。

- ネイティブAPIを無効にして6形式の画像を実際に読取。QR URLはページ移動なし。
- UPC-Eのnumber system 0/1、末尾数字0〜9の20画像と90度回転画像を読取。8文字と先頭0を保持。
- 不正チェック桁、壊れた終了ガード、白紙、破損画像、SVG、容量超過を拒否。
- カメラ権限拒否、開始待ち中のclose、古い開始応答と新しいセッションの競合、画像読込中のcloseを検証。
- 非表示・pagehideで停止。カメラを模擬したCanvasストリームでも実画像から読取し、1回だけ結果を返して全トラックを停止。
- JavaScript実行エラー0件、外部リクエスト・POST等の画像送信0件。
