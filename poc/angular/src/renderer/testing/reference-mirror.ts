import { CATALOG } from '../catalog';
import { Batch, NodeId, Op, PropValue, PROTOCOL_VERSION } from '../protocol';

interface MirrorNode {
  id: NodeId;
  type: string; // catalog type, '#host' or '#text'
  tag?: string;
  text: string;
  props: Map<string, PropValue>;
  listeners: Set<string>;
  parent: MirrorNode | null;
  children: MirrorNode[];
}

/**
 * Reference implementation of the native side of protocol v0, in TypeScript.
 * Tests use it to check that batches build the right tree; the Kotlin and Swift
 * mirror trees must behave the same way.
 */
export class ReferenceMirror {
  private readonly nodes = new Map<NodeId, MirrorNode>();
  private root: MirrorNode | null = null;
  private lastBatch = 0;

  apply(json: string): void {
    const batch = JSON.parse(json) as Batch;
    if (batch.v !== PROTOCOL_VERSION) throw new Error(`mirror: unsupported version ${batch.v}`);
    if (batch.batch !== this.lastBatch + 1) {
      throw new Error(`mirror: batch ${batch.batch} after ${this.lastBatch}`);
    }
    this.lastBatch = batch.batch;
    batch.ops.forEach((op, i) => {
      try {
        this.applyOp(op);
      } catch (e) {
        throw new Error(`mirror: batch ${batch.batch} op ${i} ${JSON.stringify(op)}: ${(e as Error).message}`);
      }
    });
  }

  get size(): number {
    return this.nodes.size;
  }

  /** The tree as native would draw it: hosts flattened, text folded into its element. */
  render(): string {
    if (!this.root) return '';
    const lines: string[] = [];
    const visit = (node: MirrorNode, depth: number) => {
      if (node.type === '#host') {
        node.children.forEach((c) => visit(c, depth));
        return;
      }
      const parts = [node.type];
      for (const [k, v] of [...node.props].sort(([a], [b]) => a.localeCompare(b))) {
        parts.push(`${k}=${JSON.stringify(v)}`);
      }
      if (CATALOG[node.type]?.children === 'text') {
        parts.push(JSON.stringify(node.children.map((c) => c.text).join('')));
      }
      if (node.listeners.size) parts.push(`(${[...node.listeners].sort().join(', ')})`);
      lines.push('  '.repeat(depth) + parts.join(' '));
      if (CATALOG[node.type]?.children === 'nodes') node.children.forEach((c) => visit(c, depth + 1));
    };
    visit(this.root, 0);
    return lines.join('\n');
  }

  private applyOp(op: Op): void {
    switch (op[0]) {
      case 'create': {
        const [, id, type, tag] = op as ['create', NodeId, string, string?];
        if (type !== '#host' && !CATALOG[type]) throw new Error(`unknown type ${type}`);
        this.add({ id, type, tag, text: '' });
        return;
      }
      case 'text':
        this.add({ id: op[1], type: '#text', text: op[2] });
        return;
      case 'setText': {
        const node = this.get(op[1]);
        if (node.type !== '#text') throw new Error(`#${op[1]} is not text`);
        node.text = op[2];
        return;
      }
      case 'insert': {
        const [, parentId, childId, index] = op;
        const parent = this.get(parentId);
        const child = this.get(childId);
        if (child.parent) this.detach(child);
        if (index < 0 || index > parent.children.length) throw new Error(`index ${index} out of range`);
        parent.children.splice(index, 0, child);
        child.parent = parent;
        return;
      }
      case 'remove': {
        const node = this.get(op[1]);
        if (!node.parent) throw new Error(`#${op[1]} is not attached`);
        this.detach(node);
        return;
      }
      case 'destroy': {
        const node = this.get(op[1]);
        if (node.parent) this.detach(node);
        const free = (n: MirrorNode) => {
          this.nodes.delete(n.id);
          n.children.forEach(free);
        };
        free(node);
        if (this.root === node) this.root = null;
        return;
      }
      case 'prop': {
        const [, id, name, value] = op;
        const node = this.get(id);
        const spec = CATALOG[node.type];
        if (!spec?.props[name]) throw new Error(`${node.type} has no prop ${name}`);
        if (value === null) node.props.delete(name);
        else node.props.set(name, value);
        return;
      }
      case 'listen':
        this.get(op[1]).listeners.add(op[2]);
        return;
      case 'unlisten':
        this.get(op[1]).listeners.delete(op[2]);
        return;
      case 'root':
        this.root = this.get(op[1]);
        return;
      default:
        throw new Error(`unknown op ${(op as unknown[])[0]}`);
    }
  }

  private add(init: Pick<MirrorNode, 'id' | 'type' | 'text'> & { tag?: string }): void {
    if (this.nodes.has(init.id)) throw new Error(`id ${init.id} already exists`);
    this.nodes.set(init.id, { ...init, props: new Map(), listeners: new Set(), parent: null, children: [] });
  }

  private get(id: NodeId): MirrorNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`unknown id ${id}`);
    return node;
  }

  private detach(node: MirrorNode): void {
    const siblings = node.parent!.children;
    siblings.splice(siblings.indexOf(node), 1);
    node.parent = null;
  }
}

/** A host that records batches and applies them to a reference mirror. */
export class RecordingHost {
  readonly batches: Batch[] = [];
  readonly mirror = new ReferenceMirror();

  post(json: string): void {
    this.batches.push(JSON.parse(json) as Batch);
    this.mirror.apply(json);
  }
}
