// Synthetic test labels only; no photographed products or third-party artwork.
// ZXing's QR writer and Code 128 constants retain their Apache-2.0 license in inventory/vendor/.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const zxing = require('../../inventory/vendor/zxing-library-0.23.0.min.js');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}
function png(width, height, pixel) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8;
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows[y * (width + 1) + x + 1] = pixel(x, y) ? 0 : 255;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const left = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const inverse = bits => bits.replace(/[01]/g, bit => bit === '1' ? '0' : '1');
const encodeDigit = (digit, parity = 'L') => parity === 'R' ? inverse(left[digit]) : parity === 'G' ? inverse([...left[digit]].reverse().join('')) : left[digit];
const checksum = payload => String((10 - [...payload].reverse().reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 1 : 3), 0) % 10) % 10);
function ean13(text) {
  const parity = zxing.EAN13Reader.FIRST_DIGIT_ENCODINGS[Number(text[0])];
  return '101' + [...text.slice(1, 7)].map((digit, index) => encodeDigit(digit, parity & 1 << (5 - index) ? 'G' : 'L')).join('') + '01010' + [...text.slice(7)].map(digit => encodeDigit(digit, 'R')).join('') + '101';
}
function ean8(text) {
  return '101' + [...text.slice(0, 4)].map(digit => encodeDigit(digit)).join('') + '01010' + [...text.slice(4)].map(digit => encodeDigit(digit, 'R')).join('') + '101';
}
function code128(text) {
  const symbols = [...text].map(char => char.charCodeAt(0) - 32);
  const check = (104 + symbols.reduce((sum, value, index) => sum + value * (index + 1), 0)) % 103;
  return [104, ...symbols, check, 106].map(symbol => [...zxing.Code128Reader.CODE_PATTERNS[symbol]].map((width, index) => (index % 2 ? '0' : '1').repeat(width)).join('')).join('');
}
const ean13Text = '490000000001' + checksum('490000000001');
const ean8Text = '1234567' + checksum('1234567');
const upcaText = '01234567890' + checksum('01234567890');
const upceText = '01234565'; // Expanded payload 01234500006 has check digit 5.
const upceParity = 0x26; // Number system 0 / check digit 5: G L L G G L.
const upceParityTable = [[0x38,0x34,0x32,0x31,0x2c,0x26,0x23,0x2a,0x29,0x25],[0x07,0x0b,0x0d,0x0e,0x13,0x19,0x1c,0x15,0x16,0x01]];
function upceBits(text) {
  const parity = upceParityTable[Number(text[0])][Number(text[7])];
  return '101' + [...text.slice(1, 7)].map((digit, index) => encodeDigit(digit, parity & 1 << (5 - index) ? 'G' : 'L')).join('') + '010101';
}
function linearPng(bits, rotated = false) {
  const width = (bits.length + 32) * 4, height = 240;
  const pixel = (x, y) => y >= 24 && y < 216 && bits[Math.floor(x / 4) - 16] === '1';
  return rotated ? png(height, width, (x, y) => pixel(y, height - 1 - x)) : png(width, height, pixel);
}
const entries = [
  { file: 'ean13.png', text: ean13Text, format: 'EAN_13', bits: ean13(ean13Text) },
  { file: 'ean8.png', text: ean8Text, format: 'EAN_8', bits: ean8(ean8Text) },
  { file: 'upca.png', text: upcaText, format: 'UPC_A', bits: ean13('0' + upcaText) },
  { file: 'upce.png', text: upceText, format: 'UPC_E', bits: '101' + [...upceText.slice(1, 7)].map((digit, index) => encodeDigit(digit, upceParity & 1 << (5 - index) ? 'G' : 'L')).join('') + '010101' },
  { file: 'code128.png', text: 'SHOP-TEST-128', format: 'CODE_128', bits: code128('SHOP-TEST-128') },
];
for (const entry of entries) {
  const quiet = 16, scale = 4, width = (entry.bits.length + quiet * 2) * scale;
  fs.writeFileSync(path.join(__dirname, entry.file), png(width, 240, (x, y) => y >= 24 && y < 216 && entry.bits[Math.floor(x / scale) - quiet] === '1'));
}
const qr = { file: 'qr.png', text: 'https://example.invalid/shop-tools/test?sku=LOCAL-QR-001', format: 'QR_CODE' };
const matrix = new zxing.QRCodeWriter().encode(qr.text, zxing.BarcodeFormat.QR_CODE, 360, 360, new Map());
fs.writeFileSync(path.join(__dirname, qr.file), png(matrix.getWidth(), matrix.getHeight(), (x, y) => matrix.get(x, y)));
fs.writeFileSync(path.join(__dirname, 'blank.png'), png(200, 200, () => false));
// Same six data digits with a deliberately wrong check-digit parity (4 instead of 5).
const invalidBits = '101' + [...upceText.slice(1, 7)].map((digit, index) => encodeDigit(digit, 0x2c & 1 << (5 - index) ? 'G' : 'L')).join('') + '010101';
fs.writeFileSync(path.join(__dirname, 'upce-invalid-checksum.png'), png((invalidBits.length + 32) * 4, 240, (x, y) => y >= 24 && y < 216 && invalidBits[Math.floor(x / 4) - 16] === '1'));
fs.writeFileSync(path.join(__dirname, 'upce-invalid-guard.png'), linearPng(upceBits(upceText).slice(0, -6) + '010100'));
fs.writeFileSync(path.join(__dirname, 'upce-rotated.png'), linearPng(upceBits(upceText), true));
const upceVariants = [];
for (let system = 0; system <= 1; system++) for (let last = 0; last <= 9; last++) {
  const digits = '12345' + last;
  const expanded = String(system) + (last <= 2 ? digits.slice(0, 2) + last + '0000' + digits.slice(2, 5)
    : last === 3 ? digits.slice(0, 3) + '00000' + digits.slice(3, 5)
      : last === 4 ? digits.slice(0, 4) + '00000' + digits[4] : digits.slice(0, 5) + '0000' + last);
  const text = String(system) + digits + checksum(expanded), file = 'upce-' + system + '-' + last + '.png';
  fs.writeFileSync(path.join(__dirname, file), linearPng(upceBits(text)));
  upceVariants.push({ file, text, format: 'UPC_E' });
}
fs.writeFileSync(path.join(__dirname, 'upce-variants.json'), JSON.stringify(upceVariants, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify([...entries.map(({ bits, ...entry }) => entry), qr], null, 2) + '\n');
console.log('Generated 6 formats, 20 UPC-E variants, rotated UPC-E, invalid checksum/guard, and blank fixtures.');
