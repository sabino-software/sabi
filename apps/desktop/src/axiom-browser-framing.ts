/** Bounded little-endian JSON framing used by native messaging and the private app socket. */

/** Maximum encoded message size accepted on either side of the browser bridge. */
export const AXIOM_BROWSER_FRAME_LIMIT = 1024 * 1024

/**
 * Encode one JSON value using Chrome native messaging's unsigned length prefix.
 * @param value Strictly validated protocol value.
 * @returns One complete bounded frame.
 */
export function encodeBrowserFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  if (body.length === 0 || body.length > AXIOM_BROWSER_FRAME_LIMIT) throw new Error('Browser bridge frame exceeds its limit')
  const frame = Buffer.allocUnsafe(body.length + 4)
  frame.writeUInt32LE(body.length)
  body.copy(frame, 4)
  return frame
}

/** Incrementally decode split or coalesced frames without accepting invalid UTF-8 or oversized messages. */
export class BrowserFrameDecoder {
  private buffer = Buffer.alloc(0)

  /**
   * Consume one stream fragment; callbacks validate protocol fields before acting.
   * @param chunk Owned stream bytes.
   * @param receive Receives each complete parsed JSON value.
   */
  push(chunk: Uint8Array, receive: (value: unknown) => void): void {
    if (chunk.byteLength > AXIOM_BROWSER_FRAME_LIMIT + 4
      || this.buffer.byteLength + chunk.byteLength > 2 * (AXIOM_BROWSER_FRAME_LIMIT + 4)) throw new Error('Browser bridge input exceeds its limit')
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.buffer.length < 4) return
      const size = this.buffer.readUInt32LE(0)
      if (size === 0 || size > AXIOM_BROWSER_FRAME_LIMIT) throw new Error('Invalid browser bridge frame length')
      if (this.buffer.length < size + 4) return
      const bytes = this.buffer.subarray(4, size + 4)
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      this.buffer = this.buffer.subarray(size + 4)
      receive(value)
    }
  }
}
