const textDecoder = new TextDecoder();

export class ProtobufReader {
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.pos = 0;
    this.len = this.bytes.length;
  }

  eof(end = this.len) {
    return this.pos >= end;
  }

  uint32() {
    let value = 0;
    let shift = 0;
    while (shift < 32) {
      const byte = this.bytes[this.pos++];
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value >>> 0;
      shift += 7;
    }
    throw new Error("Malformed uint32 varint");
  }

  skipVarint() {
    for (let i = 0; i < 10; i += 1) {
      if ((this.bytes[this.pos++] & 0x80) === 0) return;
    }
    throw new Error("Malformed varint");
  }

  int32() {
    const value = this.uint32();
    return value | 0;
  }

  bool() {
    return this.uint32() !== 0;
  }

  float() {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4);
    const value = view.getFloat32(0, true);
    this.pos += 4;
    return value;
  }

  double() {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 8);
    const value = view.getFloat64(0, true);
    this.pos += 8;
    return value;
  }

  string() {
    const length = this.uint32();
    const start = this.pos;
    this.pos += length;
    return textDecoder.decode(this.bytes.subarray(start, start + length));
  }

  bytesValue() {
    const length = this.uint32();
    const start = this.pos;
    this.pos += length;
    return this.bytes.subarray(start, start + length);
  }

  skip(wireType) {
    switch (wireType) {
      case 0:
        this.skipVarint();
        return;
      case 1:
        this.pos += 8;
        return;
      case 2: {
        const length = this.uint32();
        this.pos += length;
        return;
      }
      case 5:
        this.pos += 4;
        return;
      default:
        throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
  }
}
