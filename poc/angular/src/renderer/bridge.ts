import { Batch, MantikoraHost, NativeEvent, NodeId, Op, PROTOCOL_VERSION } from './protocol';

type Listener = (payload: unknown) => unknown;

/**
 * Buffers ops into batches and routes native events to listeners.
 * One batch per change-detection cycle: flushed in a microtask after the outermost `end()`.
 */
export class Bridge {
  private ops: Op[] = [];
  private batchSeq = 0;
  private lastEventSeq = 0;
  private flushScheduled = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly host: MantikoraHost) {}

  push(op: Op): void {
    this.ops.push(op);
  }

  scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  /** Sends buffered ops as one batch. Empty batches are not sent. */
  flush(): void {
    if (this.ops.length === 0) return;
    const batch: Batch = { v: PROTOCOL_VERSION, batch: ++this.batchSeq, evt: this.lastEventSeq, ops: this.ops };
    this.ops = [];
    this.host.post(JSON.stringify(batch));
  }

  /** Returns true when this is the first listener for the pair, so a `listen` op is needed. */
  addListener(node: NodeId, event: string, listener: Listener): boolean {
    const key = `${node}:${event}`;
    let set = this.listeners.get(key);
    const first = !set;
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(listener);
    return first;
  }

  /** Returns true when the last listener for the pair is gone, so an `unlisten` op is needed. */
  removeListener(node: NodeId, event: string, listener: Listener): boolean {
    const key = `${node}:${event}`;
    const set = this.listeners.get(key);
    if (!set?.delete(listener)) return false;
    if (set.size > 0) return false;
    this.listeners.delete(key);
    return true;
  }

  /** Entry point for native → JS messages. */
  receive(json: string): void {
    const event = JSON.parse(json) as NativeEvent;
    if (event.v !== PROTOCOL_VERSION) throw new Error(`Mantikora: unsupported protocol version ${event.v}`);
    this.lastEventSeq = event.seq;
    const set = this.listeners.get(`${event.node}:${event.event}`);
    if (!set) return; // native raced an unlisten; dropping is correct
    for (const listener of [...set]) listener(event.payload);
  }
}
