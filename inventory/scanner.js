import './vendor/zxing-browser-0.2.1.min.js';
import './vendor/zxing-library-0.23.0.min.js';

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;
const MAX_IMAGE_EDGE = 12_000;
const FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'QR_CODE'];
const imageTypes = /^image\/(?:png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i;

function translatedError(error, image = false) {
  let message = image ? '画像から読み取れませんでした。コード全体を明るく鮮明に撮影してください。' : 'カメラを開始できませんでした。画像からの読み取りも利用できます。';
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') message = 'カメラの使用が許可されていません。ブラウザーのカメラ設定を確認するか、画像から読み取ってください。';
  else if (error?.name === 'NotFoundError') message = '利用できるカメラが見つかりません。画像から読み取ってください。';
  else if (error?.name === 'NotReadableError') message = 'カメラを利用できません。他のアプリで使用している場合は閉じてからお試しください。';
  else if (error?.scannerMessage) message = error.message;
  const result = new Error(message);
  result.name = error?.name || 'BarcodeScanError';
  return result;
}

function inputError(message) {
  const error = new Error(message);
  error.scannerMessage = true;
  return error;
}

function stopTracks(stream) {
  for (const track of stream?.getTracks() || []) track.stop();
}

// UPC-E compatibility fallback: the pinned upstream reader fails our synthetic
// UPC-E image. Decode standard digit/parity patterns and verify the expanded
// UPC-A checksum, while returning the original eight UPC-E digits unchanged.
// Pattern/parity constants are also documented by ZXing (Apache-2.0; vendor license).
const digitWidths = [[3,2,1,1],[2,2,2,1],[2,1,2,2],[1,4,1,1],[1,1,3,2],[1,2,3,1],[1,1,1,4],[1,3,1,2],[1,2,1,3],[3,1,1,2]];
const upceParities = [[0x38,0x34,0x32,0x31,0x2c,0x26,0x23,0x2a,0x29,0x25],[0x07,0x0b,0x0d,0x0e,0x13,0x19,0x1c,0x15,0x16,0x01]];
function patternError(widths, pattern) {
  const module = widths.reduce((sum, width) => sum + width, 0) / pattern.reduce((sum, width) => sum + width, 0);
  if (widths.some((width, index) => Math.abs(width / module - pattern[index]) > 0.8)) return Infinity;
  return widths.reduce((sum, width, index) => sum + Math.abs(width / module - pattern[index]), 0) / pattern.reduce((sum, width) => sum + width, 0);
}
function validUPCE(system, digits, check) {
  const last = digits[5];
  const expanded = system + (last <= '2' ? digits.slice(0, 2) + last + '0000' + digits.slice(2, 5)
    : last === '3' ? digits.slice(0, 3) + '00000' + digits.slice(3, 5)
      : last === '4' ? digits.slice(0, 4) + '00000' + digits[4]
        : digits.slice(0, 5) + '0000' + last);
  const sum = [...expanded].reverse().reduce((total, value, index) => total + Number(value) * (index % 2 ? 1 : 3), 0);
  return (10 - sum % 10) % 10 === check;
}
function readUPCRow(pixels) {
  const values = [];
  let minimum = 255, maximum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const value = (pixels[i] * 306 + pixels[i + 1] * 601 + pixels[i + 2] * 117) / 1024;
    values.push(value); minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
  }
  if (maximum - minimum < 60) return null;
  const threshold = (minimum + maximum) / 2;
  const attempts = [values, [...values].reverse()];
  for (const row of attempts) {
    const runs = [];
    for (const value of row) {
      const black = value < threshold, previous = runs.at(-1);
      if (previous && previous.black === black) previous.width++;
      else runs.push({ black, width: 1 });
    }
    for (let start = 1; start + 33 < runs.length; start++) {
      if (!runs[start].black) continue;
      const guard = runs.slice(start, start + 3).map(run => run.width), module = guard.reduce((a, b) => a + b) / 3;
      if (patternError(guard, [1,1,1]) > 0.2 || runs[start - 1].width < module * 7) continue;
      let digits = '', parity = 0;
      for (let i = 0; i < 6; i++) {
        const widths = runs.slice(start + 3 + i * 4, start + 7 + i * 4).map(run => run.width);
        const digitModule = widths.reduce((a, b) => a + b) / 7;
        if (digitModule < module * 0.6 || digitModule > module * 1.6) break;
        let best = { error: 0.2, digit: null, even: false };
        for (let digit = 0; digit < 10; digit++) for (const even of [false, true]) {
          const error = patternError(widths, even ? [...digitWidths[digit]].reverse() : digitWidths[digit]);
          if (error < best.error) best = { error, digit, even };
        }
        if (best.digit === null) break;
        digits += best.digit;
        parity = parity << 1 | Number(best.even);
      }
      if (digits.length !== 6 || patternError(runs.slice(start + 27, start + 33).map(run => run.width), [1,1,1,1,1,1]) > 0.2 || runs[start + 33].black || runs[start + 33].width < module * 7) continue;
      for (let system = 0; system <= 1; system++) {
        const check = upceParities[system].indexOf(parity);
        if (check >= 0 && validUPCE(String(system), digits, check)) return String(system) + digits + check;
      }
    }
  }
  return null;
}
function decodeUPC(canvas) {
  for (let rotation = 0; rotation < 2; rotation++) {
    let source = canvas;
    if (rotation) {
      source = document.createElement('canvas'); source.width = canvas.height; source.height = canvas.width;
      const context = source.getContext('2d', { willReadFrequently: true });
      context.translate(source.width, 0); context.rotate(Math.PI / 2); context.drawImage(canvas, 0, 0);
    }
    const context = source.getContext('2d', { willReadFrequently: true });
    for (const position of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const y = Math.min(source.height - 1, Math.floor(source.height * position));
      const text = readUPCRow(context.getImageData(0, y, source.width, 1).data);
      if (text) return { getText: () => text, getBarcodeFormat: () => globalThis.ZXingBrowser.BarcodeFormat.UPC_E };
    }
  }
  return null;
}

/** All decoding runs locally in JavaScript, including when BarcodeDetector is absent. */
export class BarcodeScanner {
  constructor(video, { onResult = () => {}, onError = () => {} } = {}) {
    if (!video || video.tagName !== 'VIDEO') throw new TypeError('BarcodeScanner requires a video element');
    this.video = video;
    this.onResult = onResult;
    this.onError = onError;
    this.generation = 0;
    this.stream = null;
    this.timer = null;
    this.cancelImage = null;
    this.cancelPlay = null;
    this.canvas = document.createElement('canvas');
    this.reader = new globalThis.ZXing.MultiFormatReader();
    this.reader.setHints(new Map([
      [globalThis.ZXing.DecodeHintType.POSSIBLE_FORMATS, FORMATS.map(name => globalThis.ZXing.BarcodeFormat[name])],
      [globalThis.ZXing.DecodeHintType.TRY_HARDER, true],
    ]));
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    this.onVisibility = () => { if (document.hidden) this.stop(); };
    this.onPageHide = () => this.stop();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
  }

  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = null;
    this.cancelImage?.();
    this.cancelImage = null;
    this.cancelPlay?.();
    this.cancelPlay = null;
    this.releaseStream(this.stream);
    this.canvas.width = this.canvas.height = 0;
  }

  // Optional when an owning UI permanently removes the scanner instance.
  destroy() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
  }

  releaseStream(stream) {
    stopTracks(stream);
    if (stream && this.video.srcObject === stream) {
      this.video.pause();
      this.video.srcObject = null;
    }
    if (this.stream === stream) this.stream = null;
  }

  fail(token, error, image = false) {
    if (token !== this.generation) return;
    this.stop();
    this.onError(translatedError(error, image));
  }

  deliver(token, result) {
    if (token !== this.generation) return null;
    const value = {
      text: String(result.getText()),
      format: globalThis.ZXingBrowser.BarcodeFormat[result.getBarcodeFormat()],
    };
    if (!FORMATS.includes(value.format)) throw inputError('このコード形式には対応していません。');
    // Stop before callback: subsequent frames and late async completions are invalidated.
    this.stop();
    this.onResult(value);
    return value;
  }

  async start() {
    this.stop();
    const token = this.generation;
    let stream;
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw inputError('この環境ではカメラを利用できません。HTTPSのページで開くか、画像から読み取ってください。');
      }
      if (document.hidden) return false;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (token !== this.generation || document.hidden) { stopTracks(stream); return false; }
      this.stream = stream;
      this.video.srcObject = stream;
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true; clearTimeout(timeout);
          if (this.cancelPlay === cancel) this.cancelPlay = null;
          if (error) reject(error); else resolve();
        };
        const cancel = () => finish(new DOMException('Camera start cancelled', 'AbortError'));
        const timeout = setTimeout(() => finish(inputError('カメラ映像を表示できませんでした。もう一度開始するか、画像から読み取ってください。')), 8000);
        this.cancelPlay = cancel;
        Promise.resolve(this.video.play()).then(() => finish(), finish);
      });
      if (token !== this.generation || document.hidden) { this.releaseStream(stream); return false; }
      this.timer = setTimeout(() => this.scanFrame(token), 0);
      return true;
    } catch (error) {
      this.releaseStream(stream);
      this.fail(token, error);
      return false;
    }
  }

  draw(source, width, height, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw inputError('このブラウザーでは画像を読み取れません。');
    context.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
  }

  decodeCanvas() {
    const source = new globalThis.ZXingBrowser.HTMLCanvasElementLuminanceSource(this.canvas);
    const bitmap = new globalThis.ZXing.BinaryBitmap(new globalThis.ZXing.HybridBinarizer(source));
    try { return this.reader.decodeWithState(bitmap); }
    catch (error) {
      const kind = typeof error?.getKind === 'function' ? error.getKind() : error?.name;
      if (!['NotFoundException', 'ChecksumException', 'FormatException'].includes(kind)) throw error;
      const compatible = decodeUPC(this.canvas);
      if (compatible) return compatible;
      throw error;
    }
  }

  scanFrame(token) {
    if (token !== this.generation) return;
    if (document.hidden) { this.stop(); return; }
    try {
      if (this.video.readyState >= 2 && this.video.videoWidth && this.video.videoHeight) {
        this.draw(this.video, this.video.videoWidth, this.video.videoHeight, 1280);
        const result = this.decodeCanvas();
        if (result) { this.deliver(token, result); return; }
      }
    } catch (error) {
      // A frame without a readable code is expected while aiming the camera.
      const kind = typeof error?.getKind === 'function' ? error.getKind() : error?.name;
      if (!['NotFoundException', 'ChecksumException', 'FormatException'].includes(kind)) {
        this.fail(token, error);
        return;
      }
    }
    if (token === this.generation) this.timer = setTimeout(() => this.scanFrame(token), 240);
  }

  async readImage(file) {
    this.stop();
    const token = this.generation;
    let url, cancel;
    try {
      if (!(file instanceof Blob) || !imageTypes.test(file.type)) throw inputError('PNG・JPEG・WebPなどの写真を選択してください。SVGには対応していません。');
      if (!file.size || file.size > MAX_IMAGE_BYTES) throw inputError('画像は30MiB以下のファイルを選択してください。');
      if (document.hidden) return null;
      url = URL.createObjectURL(file);
      const image = new Image();
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          image.onload = image.onerror = null;
          if (error) reject(error); else resolve();
        };
        const timeout = setTimeout(() => finish(inputError('画像を開くのに時間がかかっています。小さい画像でお試しください。')), 10000);
        cancel = () => {
          finish(new DOMException('Image scan cancelled', 'AbortError'));
          image.removeAttribute('src');
          URL.revokeObjectURL(url);
        };
        this.cancelImage = cancel;
        image.onload = () => finish();
        image.onerror = () => finish(inputError('画像を開けませんでした。PNGやJPEGに変換してお試しください。'));
        image.src = url;
      });
      if (token !== this.generation || document.hidden) return null;
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
        throw inputError('画像は25メガピクセル以下、縦横それぞれ12,000ピクセル以下に縮小してください。');
      }
      this.draw(image, width, height, 2400);
      return this.deliver(token, this.decodeCanvas());
    } catch (error) {
      this.fail(token, error, true);
      return null;
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (this.cancelImage === cancel) this.cancelImage = null;
    }
  }
}
