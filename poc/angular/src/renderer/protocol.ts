/** Mantikora protocol v0 — see poc/PROTOCOL.md. */

export const PROTOCOL_VERSION = 0;

export type NodeId = number;
export type PropValue = number | string | boolean | null;

export type Op =
  | ['create', NodeId, string]
  | ['create', NodeId, '#host', string]
  | ['text', NodeId, string]
  | ['setText', NodeId, string]
  | ['insert', NodeId, NodeId, number]
  | ['remove', NodeId]
  | ['destroy', NodeId]
  | ['prop', NodeId, string, PropValue]
  | ['listen', NodeId, string]
  | ['unlisten', NodeId, string]
  | ['root', NodeId];

export interface Batch {
  v: typeof PROTOCOL_VERSION;
  batch: number;
  evt: number;
  ops: Op[];
}

export interface NativeEvent {
  v: typeof PROTOCOL_VERSION;
  seq: number;
  event: string;
  node: NodeId;
  payload?: unknown;
}

/** The only thing the renderer knows about the host it runs in. */
export interface MantikoraHost {
  post(json: string): void;
}
