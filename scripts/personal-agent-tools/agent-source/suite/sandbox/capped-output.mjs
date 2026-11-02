class CappedOutput {
  headCap;
  tailCap;
  head = [];
  headBytes = 0;
  tail = [];
  tailBytes = 0;
  droppedBytes = 0;
  totalBytes = 0;
  /**
   * `maxBytes` bounds head + tail together; `headShare` (default a
   * quarter) is the part of it kept from the start of the stream.
   */
  constructor(maxBytes, headShare = 0.25) {
    const cap = Math.max(0, Math.floor(maxBytes));
    this.headCap = Math.floor(cap * Math.min(1, Math.max(0, headShare)));
    this.tailCap = cap - this.headCap;
  }
  append(chunk) {
    this.totalBytes += chunk.length;
    let rest = chunk;
    if (this.headBytes < this.headCap) {
      const take = Math.min(rest.length, this.headCap - this.headBytes);
      this.head.push(rest.subarray(0, take));
      this.headBytes += take;
      rest = rest.subarray(take);
    }
    if (rest.length === 0) return;
    this.tail.push(rest);
    this.tailBytes += rest.length;
    while (this.tailBytes > this.tailCap && this.tail.length > 0) {
      const first = this.tail[0];
      const over = this.tailBytes - this.tailCap;
      if (first.length <= over) {
        this.tail.shift();
        this.tailBytes -= first.length;
        this.droppedBytes += first.length;
      } else {
        this.tail[0] = first.subarray(over);
        this.tailBytes -= over;
        this.droppedBytes += over;
      }
    }
  }
  snapshot() {
    const headText = Buffer.concat(this.head).toString("utf8");
    const tailText = Buffer.concat(this.tail).toString("utf8");
    const text = this.droppedBytes > 0 ? `${headText}
\u2026 [${this.droppedBytes.toLocaleString("en-US")} bytes dropped]
${tailText}` : headText + tailText;
    return {
      text,
      bytes: this.totalBytes,
      droppedBytes: this.droppedBytes,
      truncated: this.droppedBytes > 0
    };
  }
}
export {
  CappedOutput
};
