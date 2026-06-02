/**
 * Drop-in replacement for @mysten/bcs reader.mjs — copies bytes before DataView
 * so browser builds never hit "First argument to DataView constructor must be an ArrayBuffer".
 */

function ulebDecode(arr) {
  let total = 0n;
  let shift = 0n;
  let len = 0;
  while (true) {
    if (len >= arr.length) {
      throw new Error("ULEB decode error: buffer overflow");
    }
    const byte = arr[len];
    len += 1;
    total += BigInt(byte & 127) << shift;
    if ((byte & 128) === 0) {
      break;
    }
    shift += 7n;
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("ULEB decode error: value exceeds MAX_SAFE_INTEGER");
  }
  return {
    value: Number(total),
    length: len,
  };
}

function normalize(data) {
  return Uint8Array.from(data);
}

class BcsReader {
  constructor(data) {
    const normalized = normalize(data);
    this.bytePosition = 0;
    this.dataView = new DataView(
      normalized.buffer,
      normalized.byteOffset,
      normalized.byteLength,
    );
  }

  shift(bytes) {
    this.bytePosition += bytes;
    return this;
  }

  read8() {
    const value = this.dataView.getUint8(this.bytePosition);
    this.shift(1);
    return value;
  }

  read16() {
    const value = this.dataView.getUint16(this.bytePosition, true);
    this.shift(2);
    return value;
  }

  read32() {
    const value = this.dataView.getUint32(this.bytePosition, true);
    this.shift(4);
    return value;
  }

  read64() {
    const value1 = this.read32();
    const value2 = this.read32();
    const result = value2.toString(16) + value1.toString(16).padStart(8, "0");
    return BigInt("0x" + result).toString(10);
  }

  read128() {
    const value1 = BigInt(this.read64());
    const value2 = BigInt(this.read64());
    const result = value2.toString(16) + value1.toString(16).padStart(16, "0");
    return BigInt("0x" + result).toString(10);
  }

  read256() {
    const value1 = BigInt(this.read128());
    const value2 = BigInt(this.read128());
    const result = value2.toString(16) + value1.toString(16).padStart(32, "0");
    return BigInt("0x" + result).toString(10);
  }

  readBytes(num) {
    const remaining = this.dataView.byteLength - this.bytePosition;
    if (num > remaining) {
      throw new Error(
        `BCS buffer underrun: need ${num} bytes, ${remaining} remaining`,
      );
    }
    const out = new Uint8Array(num);
    for (let i = 0; i < num; i++) {
      out[i] = this.dataView.getUint8(this.bytePosition + i);
    }
    this.shift(num);
    return out;
  }

  readULEB() {
    const start = this.bytePosition + this.dataView.byteOffset;
    const buffer = Uint8Array.from(new Uint8Array(this.dataView.buffer, start));
    const { value, length } = ulebDecode(buffer);
    this.shift(length);
    return value;
  }

  readVec(cb) {
    const length = this.readULEB();
    const result = [];
    for (let i = 0; i < length; i++) {
      result.push(cb(this, i, length));
    }
    return result;
  }
}

export { BcsReader };
