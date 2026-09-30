import { ApplicationRef, CUSTOM_ELEMENTS_SCHEMA, Component, signal } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { Bridge } from './bridge';
import { NativeRenderer, NativeRendererFactory, ShadowNode } from './native-renderer';
import { Op } from './protocol';
import { provideMantikora } from './provide';
import { RecordingHost } from './testing/reference-mirror';

function setup() {
  const posted: { ops: Op[] }[] = [];
  const bridge = new Bridge({ post: (json) => posted.push(JSON.parse(json)) });
  const renderer = new NativeRenderer(bridge);
  const ops = () => {
    bridge.flush();
    return posted.flatMap((b) => b.ops);
  };
  return { bridge, renderer, ops, posted };
}

describe('NativeRenderer', () => {
  describe('closed vocabulary', () => {
    it('creates catalog elements', () => {
      const { renderer, ops } = setup();
      renderer.createElement('mk-column');
      expect(ops()).toEqual([['create', 1, 'mk-column']]);
    });

    it('throws on unknown mk-* elements and plain HTML', () => {
      const { renderer } = setup();
      expect(() => renderer.createElement('mk-card')).toThrow(/unknown element <mk-card>/);
      expect(() => renderer.createElement('div')).toThrow(/<div> is not a Mantikora element/);
      expect(() => renderer.createElement('svg', 'svg')).toThrow(/namespaced/);
    });

    it('treats other dashed tags as transparent component hosts', () => {
      const { renderer, ops } = setup();
      renderer.createElement('app-profile');
      expect(ops()).toEqual([['create', 1, '#host', 'app-profile']]);
    });

    it('throws on every CSS api', () => {
      const { renderer } = setup();
      const el = renderer.createElement('mk-text');
      expect(() => renderer.addClass()).toThrow(/addClass is not supported/);
      expect(() => renderer.removeClass()).toThrow(/removeClass/);
      expect(() => renderer.setStyle()).toThrow(/setStyle/);
      expect(() => renderer.removeStyle()).toThrow(/removeStyle/);
      expect(() => renderer.setAttribute(el, 'class', 'big')).toThrow(/"class"/);
      expect(() => renderer.setAttribute(el, 'style', 'color: red')).toThrow(/"style"/);
    });
  });

  describe('props', () => {
    it('coerces static attributes by catalog type', () => {
      const { renderer, ops } = setup();
      const column = renderer.createElement('mk-column');
      const button = renderer.createElement('mk-button');
      renderer.setAttribute(column, 'spacing', '12');
      renderer.setAttribute(button, 'disabled', '');
      renderer.setAttribute(button, 'disabled', 'false');
      expect(ops().slice(2)).toEqual([
        ['prop', 1, 'spacing', 12],
        ['prop', 2, 'disabled', true],
        ['prop', 2, 'disabled', false],
      ]);
    });

    it('rejects unknown props and wrong types', () => {
      const { renderer } = setup();
      const text = renderer.createElement('mk-text');
      const column = renderer.createElement('mk-column');
      expect(() => renderer.setAttribute(text, 'size', '12')).toThrow(/has no prop "size"/);
      expect(() => renderer.setAttribute(column, 'spacing', 'wide')).toThrow(/not a number/);
      expect(() => renderer.setProperty(text, 'variant', 'huge')).toThrow(/expected one of body, title/);
      expect(() => renderer.setProperty(column, 'spacing', '12')).toThrow(/expected number/);
    });

    it('ignores Angular bookkeeping attributes and host attributes', () => {
      const { renderer, ops } = setup();
      const host = renderer.createElement('app-root');
      const text = renderer.createElement('mk-text');
      renderer.setAttribute(host, 'ng-version', '22.2.0');
      renderer.setAttribute(host, 'title', 'anything');
      renderer.setAttribute(text, 'ng-reflect-variant', 'title');
      expect(ops()).toHaveLength(2);
    });

    it('resets a prop with null', () => {
      const { renderer, ops } = setup();
      const field = renderer.createElement('mk-text-field');
      renderer.setProperty(field, 'value', undefined);
      renderer.removeAttribute(field, 'label');
      expect(ops().slice(1)).toEqual([
        ['prop', 1, 'value', null],
        ['prop', 1, 'label', null],
      ]);
    });
  });

  describe('tree', () => {
    it('skips comments when computing the native index', () => {
      const { renderer, ops } = setup();
      const column = renderer.createElement('mk-column');
      const anchor = renderer.createComment('container');
      const a = renderer.createElement('mk-text');
      const b = renderer.createElement('mk-text');
      renderer.appendChild(column, anchor);
      renderer.appendChild(column, a);
      renderer.insertBefore(column, b, anchor);
      expect(ops().filter((op) => op[0] === 'insert')).toEqual([
        ['insert', 1, 2, 0],
        ['insert', 1, 3, 0],
      ]);
      expect(renderer.nextSibling(b)).toBe(anchor);
      expect(renderer.parentNode(anchor)).toBe(column);
    });

    it('moves an attached node with a single insert', () => {
      const { renderer, ops } = setup();
      const column = renderer.createElement('mk-column');
      const a = renderer.createElement('mk-text');
      const b = renderer.createElement('mk-text');
      renderer.appendChild(column, a);
      renderer.appendChild(column, b);
      renderer.insertBefore(column, b, a);
      expect(ops().filter((op) => op[0] === 'insert' || op[0] === 'remove')).toEqual([
        ['insert', 1, 2, 0],
        ['insert', 1, 3, 1],
        ['insert', 1, 3, 0],
      ]);
      expect(column.children).toEqual([b, a]);
    });

    it('keeps whitespace text out of native and rejects real text in layout parents', () => {
      const { renderer, ops } = setup();
      const column = renderer.createElement('mk-column');
      const space = renderer.createText('\n  ');
      renderer.appendChild(column, space);
      expect(ops().some((op) => op[0] === 'insert')).toBe(false);
      expect(() => renderer.setValue(space, 'oops')).toThrow(/cannot be a child of <mk-column>/);
      expect(() => renderer.appendChild(column, renderer.createText('hi'))).toThrow(/cannot be a child/);
    });

    it('enforces what each element may hold', () => {
      const { renderer } = setup();
      const text = renderer.createElement('mk-text');
      const field = renderer.createElement('mk-text-field');
      expect(() => renderer.appendChild(text, renderer.createElement('mk-button'))).toThrow(/holds text/);
      expect(() => renderer.appendChild(field, renderer.createText('x'))).toThrow(/cannot be a child/);
    });

    it('removes, then destroys a whole subtree without further ops', () => {
      const { renderer, ops } = setup();
      const column = renderer.createElement('mk-column');
      const button = renderer.createElement('mk-button');
      const label = renderer.createText('Go');
      renderer.appendChild(button, label);
      renderer.appendChild(column, button);
      const off = renderer.listen(button, 'tap', () => {});
      ops();
      const before = ops().length;

      renderer.removeChild(column, button);
      renderer.destroyNode(button);
      off();
      renderer.setValue(label, 'late');

      expect(ops().slice(before)).toEqual([
        ['remove', 2],
        ['destroy', 2],
      ]);
      expect((label as ShadowNode).destroyed).toBe(true);
    });
  });

  describe('events', () => {
    it('sends listen once per node and event, unlisten after the last listener', () => {
      const { renderer, ops } = setup();
      const button = renderer.createElement('mk-button');
      const off1 = renderer.listen(button, 'tap', () => {});
      const off2 = renderer.listen(button, 'tap', () => {});
      off1();
      off2();
      expect(ops().slice(1)).toEqual([
        ['listen', 1, 'tap'],
        ['unlisten', 1, 'tap'],
      ]);
    });

    it('rejects events the element does not have and global targets', () => {
      const { renderer } = setup();
      const text = renderer.createElement('mk-text');
      expect(() => renderer.listen(text, 'tap', () => {})).toThrow(/has no "tap" event/);
      expect(() => renderer.listen('window', 'resize', () => {})).toThrow(/global event target/);
    });

    it('delivers the payload as $event and records the event seq', () => {
      const { bridge, renderer, posted } = setup();
      const field = renderer.createElement('mk-text-field');
      const seen: unknown[] = [];
      renderer.listen(field, 'change', (value) => void seen.push(value));
      bridge.receive(JSON.stringify({ v: 0, seq: 7, event: 'change', node: 1, payload: 'abc' }));
      renderer.setProperty(field, 'value', 'abc');
      bridge.flush();
      expect(seen).toEqual(['abc']);
      expect(posted[0]).toMatchObject({ batch: 1, evt: 7 });
    });

    it('rejects other protocol versions', () => {
      const { bridge } = setup();
      expect(() => bridge.receive('{"v":1,"seq":1,"event":"tap","node":1}')).toThrow(/version 1/);
    });
  });

  describe('batching', () => {
    it('flushes once after the outermost end, in a microtask', async () => {
      const posted: string[] = [];
      const factory = new NativeRendererFactory({ post: (json) => posted.push(json) });
      const renderer = factory.createRenderer(null, null);
      factory.begin();
      renderer.createElement('mk-column');
      factory.begin();
      renderer.createElement('mk-text');
      factory.end();
      factory.end();
      expect(posted).toHaveLength(0);
      await Promise.resolve();
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0]).ops).toHaveLength(2);
    });

    it('does not send empty batches', async () => {
      const posted: string[] = [];
      const factory = new NativeRendererFactory({ post: (json) => posted.push(json) });
      factory.begin();
      factory.end();
      await Promise.resolve();
      expect(posted).toHaveLength(0);
    });
  });
});

@Component({
  selector: 'app-flow',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <mk-column>
      <mk-text>top</mk-text>
      @if (show()) {
        <mk-text>shown</mk-text>
      }
      @for (item of items(); track item) {
        <mk-text>{{ item }}</mk-text>
      }
      <mk-text>bottom</mk-text>
    </mk-column>
  `,
})
class FlowComponent {
  readonly show = signal(false);
  readonly items = signal(['a', 'b', 'c']);
}

describe('Angular control flow on the Mantikora renderer', () => {
  async function start() {
    const host = new RecordingHost();
    const appRef: ApplicationRef = await createApplication({ providers: [provideMantikora(host)] });
    const ref = appRef.bootstrap(FlowComponent);
    await appRef.whenStable();
    const update = async (fn: (c: FlowComponent) => void) => {
      fn(ref.instance);
      await appRef.whenStable();
    };
    return { host, appRef, update };
  }

  const tree = (...texts: string[]) => ['mk-column', ...texts.map((t) => `  mk-text "${t}"`)].join('\n');

  it('renders @if and @for at the right positions', async () => {
    const { host, appRef, update } = await start();
    expect(host.mirror.render()).toBe(tree('top', 'a', 'b', 'c', 'bottom'));

    await update((c) => c.show.set(true));
    expect(host.mirror.render()).toBe(tree('top', 'shown', 'a', 'b', 'c', 'bottom'));

    await update((c) => c.items.set(['c', 'a', 'd']));
    expect(host.mirror.render()).toBe(tree('top', 'shown', 'c', 'a', 'd', 'bottom'));

    await update((c) => c.show.set(false));
    expect(host.mirror.render()).toBe(tree('top', 'c', 'a', 'd', 'bottom'));
    appRef.destroy();
  });

  it('frees destroyed nodes on the native side', async () => {
    const { host, appRef, update } = await start();
    const initial = host.mirror.size;

    await update((c) => c.show.set(true));
    await update((c) => c.show.set(false));
    await update((c) => c.items.set([]));

    // "shown" came and went; a, b, c are gone: 3 elements + 3 text nodes
    expect(host.mirror.size).toBe(initial - 6);
    appRef.destroy();
  });
});
