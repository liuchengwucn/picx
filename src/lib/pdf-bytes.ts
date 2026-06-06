/** "%PDF-" — the leading bytes every PDF file starts with. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** True if the buffer begins with the PDF magic bytes. */
export function isPdfBuffer(buffer: Uint8Array): boolean {
  if (buffer.length < PDF_SIGNATURE.length) {
    return false;
  }
  return PDF_SIGNATURE.every((byte, index) => buffer[index] === byte);
}
