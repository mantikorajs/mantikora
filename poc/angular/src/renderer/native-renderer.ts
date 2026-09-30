import { Renderer2, RendererFactory2, RendererType2 } from '@angular/core';
import { Bridge } from './bridge';
import { CATALOG, ElementSpec, checkValue, coerceAttribute } from './catalog';
import { MantikoraHost, NodeId } from './protocol';

type Kind = 'element' | 'host' | 'text' | 'comment';

/** Attributes Angular writes for its own bookkeeping. They mean nothing to native. */
const IGNORED_ATTRIBUTE = /^(ng-version$|ng-reflect-)/;
const WHITESPACE = /^\s*$/;

/**
 * JS-side shadow of a node. Angular holds these as its "native nodes";
 * every synchronous query (parentNode, nextSibling) is answered from here.
 */
export class ShadowNode {
  parent: ShadowNode | null = null;
  readonly children: ShadowNode[] = [];
  /** True while native has this node inserted under `parent`. */
  native = false;
  destroyed = false;

  constructor(
    readonly id: NodeId,
    readonly kind: Kind,
    readonly type: string,
    public value = '',
  ) {}

  get spec(): ElementSpec | undefined {
    return this.kind === 'element' ? CATALOG[this.type] : undefined;
  }

  toString(): string {
    return this.kind === 'text' ? `text#${this.id}` : `<${this.type}>#${this.id}`;
  }
}

function fail(message: string): never {
  throw new Error(`Mantikora: ${message}`);
}

function unsupported(api: string): never {
  fail(`${api} is not supported. Mantikora has no CSS; use catalog props instead.`);
}

/** Turns Renderer2 calls into protocol v0 ops. Stateless per component, so one instance serves all. */
export class NativeRenderer implements Renderer2 {
  readonly data: Record<string, unknown> = Object.create(null);
  private nextId = 1;

  constructor(private readonly bridge: Bridge) {}

  destroy(): void {}

  createElement(name: string, namespace?: string | null): ShadowNode {
    if (namespace) fail(`namespaced element <${namespace}:${name}> is not supported`);
    if (name.startsWith('mk-')) {
      if (!CATALOG[name]) fail(`unknown element <${name}>. Catalog: ${Object.keys(CATALOG).join(', ')}`);
      const node = new ShadowNode(this.nextId++, 'element', name);
      this.bridge.push(['create', node.id, name]);
      return node;
    }
    if (name.includes('-')) return this.createHost(name);
    fail(`<${name}> is not a Mantikora element. Use catalog elements (mk-*) only.`);
  }

  createComment(value: string): ShadowNode {
    return new ShadowNode(0, 'comment', '#comment', value);
  }

  createText(value: string): ShadowNode {
    const node = new ShadowNode(this.nextId++, 'text', '#text', value);
    this.bridge.push(['text', node.id, value]);
    return node;
  }

  destroyNode(node: ShadowNode): void {
    // Angular calls this only for the root nodes of a destroyed view, so the whole subtree goes.
    if (node.destroyed) return;
    if (node.parent) this.detach(node);
    if (node.kind !== 'comment') this.bridge.push(['destroy', node.id]);
    markDestroyed(node);
  }

  appendChild(parent: ShadowNode, child: ShadowNode): void {
    this.insert(parent, child, null);
  }

  insertBefore(parent: ShadowNode, child: ShadowNode, ref: ShadowNode | null): void {
    this.insert(parent, child, ref);
  }

  removeChild(_parent: ShadowNode | null, child: ShadowNode): void {
    if (child.parent) this.detach(child, true);
  }

  selectRootElement(selectorOrNode: string | ShadowNode): ShadowNode {
    const node = typeof selectorOrNode === 'string' ? this.createHost(selectorOrNode) : selectorOrNode;
    this.bridge.push(['root', node.id]);
    return node;
  }

  parentNode(node: ShadowNode): ShadowNode | null {
    return node.parent;
  }

  nextSibling(node: ShadowNode): ShadowNode | null {
    const siblings = node.parent?.children;
    if (!siblings) return null;
    return siblings[siblings.indexOf(node) + 1] ?? null;
  }

  setAttribute(el: ShadowNode, name: string, value: string, namespace?: string | null): void {
    if (IGNORED_ATTRIBUTE.test(name) || el.kind === 'host') return;
    if (namespace) fail(`namespaced attribute ${namespace}:${name} on ${el} is not supported`);
    const type = this.propType(el, name);
    this.bridge.push(['prop', this.alive(el).id, name, coerceAttribute(type, value, `${el}.${name}`)]);
  }

  removeAttribute(el: ShadowNode, name: string): void {
    if (IGNORED_ATTRIBUTE.test(name) || el.kind === 'host') return;
    this.propType(el, name);
    this.bridge.push(['prop', this.alive(el).id, name, null]);
  }

  addClass(): void {
    unsupported('addClass');
  }

  removeClass(): void {
    unsupported('removeClass');
  }

  setStyle(): void {
    unsupported('setStyle');
  }

  removeStyle(): void {
    unsupported('removeStyle');
  }

  setProperty(el: ShadowNode, name: string, value: unknown): void {
    if (el.kind === 'host') return; // host bindings go to component inputs, never to native
    const type = this.propType(el, name);
    this.bridge.push(['prop', this.alive(el).id, name, checkValue(type, value, `${el}.${name}`)]);
  }

  setValue(node: ShadowNode, value: string): void {
    node.value = value;
    if (node.kind !== 'text' || node.destroyed) return;
    if (node.parent && !node.native && !WHITESPACE.test(value)) {
      fail(`text "${value}" cannot be a child of ${node.parent}`);
    }
    this.bridge.push(['setText', node.id, value]);
  }

  listen(target: unknown, eventName: string, callback: (event: unknown) => boolean | void): () => void {
    if (!(target instanceof ShadowNode)) fail(`global event target "${String(target)}" is not supported`);
    const events = target.spec?.events ?? [];
    if (!events.includes(eventName)) {
      fail(`${target} has no "${eventName}" event. Events: ${events.join(', ') || 'none'}`);
    }
    const listener = (payload: unknown) => callback(payload);
    if (this.bridge.addListener(target.id, eventName, listener)) {
      this.bridge.push(['listen', this.alive(target).id, eventName]);
    }
    return () => {
      if (this.bridge.removeListener(target.id, eventName, listener) && !target.destroyed) {
        this.bridge.push(['unlisten', target.id, eventName]);
      }
    };
  }

  private createHost(tag: string): ShadowNode {
    const node = new ShadowNode(this.nextId++, 'host', tag);
    this.bridge.push(['create', node.id, '#host', tag]);
    return node;
  }

  private insert(parent: ShadowNode, child: ShadowNode, ref: ShadowNode | null): void {
    this.alive(parent);
    this.alive(child);
    if (parent.kind === 'text' || parent.kind === 'comment') fail(`${parent} cannot have children`);
    const wasNative = child.native;
    if (child.parent) this.detach(child); // a move: native detaches on insert, so no op here

    const index = ref ? parent.children.indexOf(ref) : parent.children.length;
    if (index < 0) fail(`insertBefore: ${ref} is not a child of ${parent}`);
    parent.children.splice(index, 0, child);
    child.parent = parent;

    if (acceptsNatively(parent, child)) {
      child.native = true;
      this.bridge.push(['insert', parent.id, child.id, nativeIndex(child)]);
    } else if (wasNative) {
      this.bridge.push(['remove', child.id]);
    }
  }

  private detach(child: ShadowNode, emit = false): void {
    const parent = child.parent!;
    parent.children.splice(parent.children.indexOf(child), 1);
    child.parent = null;
    if (child.native && emit && !child.destroyed) this.bridge.push(['remove', child.id]);
    child.native = false;
  }

  private propType(el: ShadowNode, name: string) {
    const spec = el.spec;
    if (!spec) fail(`${el} has no props`);
    if (name === 'class' || name === 'style') unsupported(`"${name}" on ${el}`);
    const type = spec.props[name];
    if (!type) fail(`${el} has no prop "${name}". Props: ${Object.keys(spec.props).join(', ') || 'none'}`);
    return type;
  }

  private alive(node: ShadowNode): ShadowNode {
    if (node.destroyed) fail(`${node} was destroyed`);
    return node;
  }
}

/** Whether native should see `child` under `parent`. Throws when the combination is invalid. */
function acceptsNatively(parent: ShadowNode, child: ShadowNode): boolean {
  if (child.kind === 'comment') return false;
  const holds = parent.spec?.children ?? 'nodes'; // hosts are transparent and hold nodes
  if (child.kind === 'text') {
    if (holds === 'text') return true;
    if (WHITESPACE.test(child.value)) return false;
    fail(`text "${child.value}" cannot be a child of ${parent}`);
  }
  if (holds !== 'nodes') fail(`${child} cannot be a child of ${parent}; it holds ${holds}`);
  return true;
}

/** Position among the siblings native can see: comments and ignored whitespace do not count. */
function nativeIndex(child: ShadowNode): number {
  let index = 0;
  for (const sibling of child.parent!.children) {
    if (sibling === child) return index;
    if (sibling.native) index++;
  }
  return index;
}

function markDestroyed(node: ShadowNode): void {
  node.destroyed = true;
  node.native = false;
  for (const child of node.children) markDestroyed(child);
}

/** Angular entry point: one renderer for every component, one batch per change-detection cycle. */
export class NativeRendererFactory implements RendererFactory2 {
  readonly bridge: Bridge;
  private readonly renderer: NativeRenderer;
  private depth = 0;

  constructor(host: MantikoraHost) {
    this.bridge = new Bridge(host);
    this.renderer = new NativeRenderer(this.bridge);
  }

  createRenderer(_hostElement: unknown, _type: RendererType2 | null): Renderer2 {
    return this.renderer;
  }

  begin(): void {
    this.depth++;
  }

  end(): void {
    if (--this.depth === 0) this.bridge.scheduleFlush();
  }
}
