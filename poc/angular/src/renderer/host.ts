import { MantikoraHost } from './protocol';

interface HostGlobals {
  MantikoraAndroid?: { post(json: string): void };
  webkit?: { messageHandlers?: { mantikora?: { postMessage(json: string): void } } };
  __mantikoraPost?: (json: string) => void;
}

/** Logs batches instead of sending them. For `ng serve` in a desktop browser. */
export class ConsoleHost implements MantikoraHost {
  post(json: string): void {
    console.log('[mantikora]', json);
  }
}

/** Picks the transport of the host the bundle runs in (see PROTOCOL.md §2). */
export function detectHost(g: HostGlobals = globalThis as HostGlobals): MantikoraHost {
  const android = g.MantikoraAndroid;
  if (android) return { post: (json) => android.post(json) };
  const ios = g.webkit?.messageHandlers?.mantikora;
  if (ios) return { post: (json) => ios.postMessage(json) };
  const jsc = g.__mantikoraPost;
  if (jsc) return { post: (json) => jsc(json) };
  return new ConsoleHost();
}
