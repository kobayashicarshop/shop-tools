# バーコード読取ライブラリと検証記録

2026-11-04に公式npm registryの`latest`を確認し、次の固定版を同梱しました。
利用時にCDNへ接続せず、選択画像・読取文字列を外部へ送りません。

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
写真・保存画像の読み取りに一本化しました。`<input type="file" accept="image/*">` を使い、`capture` は指定しません。
OS標準の選択画面から撮影・写真ライブラリ・ファイルなどを選べる環境に対応します。選択肢はOS・ブラウザーによって異なり、すべての端末で同じ表示になるとは限りません。
アプリは `getUserMedia`、動画表示、連続解析を使用しません。画像を開き、ローカルCanvasで一度解析します。
通常方向で読めない場合は90度・270度・180度も試します。GitHub側で追加された回転対応を維持しています。
写真選択や撮影中にSafariが非表示になる場合があるため、`visibilitychange`だけでは画像処理を中止しません。
閉じる・ページ移動・`pagehide`では読込を中止し、遅れて届いた読取結果や商品検索結果で画面が戻らないようにします。

iPhone Safari・Android実機でのOS選択画面、撮影・ピント・HEIC画像の取り扱いは未確認です。自動検証にはChromiumと合成画像を使います。

## UPC-Eの互換処理

今回、正しいチェック桁を持つ自作UPC-E画像`01234565`が固定版ZXingだけでは読み取れないことを再現しました。
公式には[UPC-Eを読めないというissue #576](https://github.com/zxing-js/library/issues/576)がありますが、これは旧`0.20.0`の報告です。
現在の固定版の同一原因・上流修正状況を確認したという意味ではありません。

今回確認したソース上の不整合は、[`UPCEReader.decodeMiddle`の戻り値が数値`rowOffset`](https://github.com/zxing-js/library/blob/v0.23.0/src/core/oned/UPCEReader.ts#L88-L110)である一方、[基底`UPCEANReader.decodeRow`は`rowOffset`と`resultString`を持つオブジェクトを期待](https://github.com/zxing-js/library/blob/v0.23.0/src/core/oned/UPCEANReader.ts#L58-L60)している点です。
この観察と合成画像での失敗を根拠に、ライブラリ本体を変更せず`scanner.js`にUPC-E専用の互換読取を追加しました。

共通`decodeCanvas()`でZXingが読取失敗した場合だけ、UPC-Eの開始・終了ガード、余白、数字のバー幅、パリティを照合します。
number systemは0と1だけに限定し、検算用にUPC-Aへ展開してチェック桁を検証します。
**外部へ返す値は元のUPC-Eの8文字です。UPC-Aへの変換や先頭0の除去は行いません。**
写真解析でこの処理を使用します。90度の回転と逆方向も試しますが、反射・曲面・斜め撮影など実物条件での精度は未確認です。
上流で読取が改善された場合は合成画像と実機で比較し、この互換処理を残す必要があるか再判断してください。

## API契約と画像上限

```js
const scanner = new BarcodeScanner({
  onResult: ({ text, format }) => { /* 文字列として扱う */ },
  onError: error => { /* error.messageを表示 */ },
});
scanner.stop();                  // 進行中の画像読込を中止。再利用可能
await scanner.readImage(file);   // 成功は同じ結果object、失敗・中止はnull
scanner.destroy();               // UIを破棄するときはイベント監視も解除
```

`readImage`成功時は`onResult`も1回呼びます。失敗時は`onError`を1回、中止時は呼びません。
QRにURLが入っていても文字列を返すだけで、リンク・ページ移動・URL取得は行いません。
別の商品コードに書き換える処理や商品検索APIへの接続もありません。

- 入力ファイルは30MiB以下。PNG、JPEG、WebP、GIF、BMP、AVIF、HEIC、HEIFのMIMEを受け付けます。
- 実際に開ける画像形式はブラウザー依存です。開けない場合はPNG/JPEGへの変換を案内します。
- SVGを拒否します。外部画像を参照するSVGも画像として読み込みません。
- 展開後は25メガピクセル以下、縦横それぞれ12,000px以下。読込待ちは10秒で打ち切ります。
- 読取用Canvasは最大辺2400pxへ縮小します。読取後の画像・Object URLは保持せず、保存領域へ書き込みません。

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
自動試験で以下を確認します（合成画像であり実機試験ではありません）。

- ネイティブAPIを無効にして6形式の画像を実際に読取。QR URLはページ移動なし。
- UPC-Eのnumber system 0/1、末尾数字0〜9の20画像と90度回転画像を読取。8文字と先頭0を保持。
- JAN-13の90/180/270度、JAN-8・Code 128の回転画像を読取。
- 不正チェック桁、壊れた終了ガード、白紙、破損画像、SVG、容量超過を拒否。
- 画像読込中のclose・pagehide、古い読込結果の無効化、OS選択画面による一時非表示を検証。
- 写真選択UI、解析中表示、再選択、未登録→登録画面、登録済み→商品詳細、手入力検索、読取だけでは在庫・履歴が変わらないことを検証。
- JavaScript実行エラー・外部リクエスト・画像送信がないことを検証。
