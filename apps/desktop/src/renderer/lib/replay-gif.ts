/** GIF89a, fixed 3:3:2 palette. Short literal LZW blocks keep code width at nine bits. */
export function replayGif(width: number, height: number, frames: readonly Uint8ClampedArray[]): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 640 || height > 640 || frames.length === 0) throw new Error('Invalid replay dimensions');
  const out: number[] = [];
  const word = (value: number) => { out.push(value & 255, value >> 8); };
  out.push(...Array.from('GIF89a', (c) => c.charCodeAt(0)));
  word(width); word(height); out.push(0xf7, 0, 0);
  for (let i = 0; i < 256; i++) out.push(Math.round((i >> 5) * 255 / 7), Math.round(((i >> 2) & 7) * 255 / 7), Math.round((i & 3) * 255 / 3));
  out.push(0x21, 0xff, 11, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  for (const rgba of frames) {
    if (rgba.length !== width * height * 4) throw new Error('Replay frame size mismatch');
    out.push(0x21, 0xf9, 4, 0, 75, 0, 0, 0, 0x2c); // 750 ms per actual captured state.
    word(0); word(0); word(width); word(height); out.push(0, 8);
    const packed: number[] = [];
    let bits = 0, count = 0;
    const code = (value: number) => {
      bits |= value << count; count += 9;
      while (count >= 8) { packed.push(bits & 255); bits >>>= 8; count -= 8; }
    };
    code(256);
    for (let i = 0; i < width * height; i++) {
      if (i > 0 && i % 200 === 0) code(256);
      code((rgba[i * 4]! >> 5 << 5) | (rgba[i * 4 + 1]! >> 5 << 2) | (rgba[i * 4 + 2]! >> 6));
    }
    code(257); if (count) packed.push(bits & 255);
    for (let i = 0; i < packed.length; i += 255) { const block = packed.slice(i, i + 255); out.push(block.length, ...block); }
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}
