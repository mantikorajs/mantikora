import { ApplicationRef } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { NativeRendererFactory, NativeEvent, provideMantikora } from '../renderer';
import { RecordingHost } from '../renderer/testing/reference-mirror';
import { App } from './app';

async function startCounter() {
  const host = new RecordingHost();
  const appRef: ApplicationRef = await createApplication({ providers: [provideMantikora(host)] });
  appRef.bootstrap(App);
  await appRef.whenStable();
  const { bridge } = appRef.injector.get(NativeRendererFactory);
  const send = async (event: Omit<NativeEvent, 'v'>) => {
    bridge.receive(JSON.stringify({ v: 0, ...event }));
    await appRef.whenStable();
  };
  return { host, appRef, send };
}

describe('counter app on the Mantikora renderer', () => {
  it('builds the whole screen in one batch', async () => {
    const { host, appRef } = await startCounter();

    expect(host.batches).toHaveLength(1);
    expect(host.batches[0]).toMatchObject({ v: 0, batch: 1, evt: 0 });
    expect(host.batches[0].ops).toEqual([
      ['create', 1, '#host', 'app-root'],
      ['root', 1],
      ['create', 2, 'mk-column'],
      ['prop', 2, 'spacing', 12],
      ['prop', 2, 'padding', 16],
      ['insert', 1, 2, 0],
      ['create', 3, 'mk-text'],
      ['prop', 3, 'variant', 'title'],
      ['insert', 2, 3, 0],
      ['text', 4, ''],
      ['insert', 3, 4, 0],
      ['create', 5, 'mk-button'],
      ['insert', 2, 5, 1],
      ['listen', 5, 'tap'],
      ['text', 6, 'Increment'],
      ['insert', 5, 6, 0],
      ['create', 7, 'mk-text-field'],
      ['prop', 7, 'label', 'Name'],
      ['insert', 2, 7, 2],
      ['listen', 7, 'change'],
      ['create', 8, 'mk-text'],
      ['insert', 2, 8, 3],
      ['text', 9, ''],
      ['insert', 8, 9, 0],
      ['setText', 4, 'Clicked 0 times'],
      ['prop', 7, 'value', ''],
      ['setText', 9, 'Hello '],
    ]);
    expect(host.mirror.render()).toBe(
      [
        'mk-column padding=16 spacing=12',
        '  mk-text variant="title" "Clicked 0 times"',
        '  mk-button "Increment" (tap)',
        '  mk-text-field label="Name" value="" (change)',
        '  mk-text "Hello "',
      ].join('\n'),
    );
    appRef.destroy();
  });

  it('a tap produces one batch with only the changed text', async () => {
    const { host, appRef, send } = await startCounter();

    await send({ seq: 1, event: 'tap', node: 5 });

    expect(host.batches).toHaveLength(2);
    expect(host.batches[1]).toEqual({ v: 0, batch: 2, evt: 1, ops: [['setText', 4, 'Clicked 1 times']] });

    await send({ seq: 2, event: 'tap', node: 5 });
    expect(host.batches[2]).toEqual({ v: 0, batch: 3, evt: 2, ops: [['setText', 4, 'Clicked 2 times']] });
    appRef.destroy();
  });

  it('typing updates the greeting and echoes the value back', async () => {
    const { host, appRef, send } = await startCounter();

    await send({ seq: 1, event: 'change', node: 7, payload: 'Ana' });

    expect(host.batches[1].evt).toBe(1);
    expect(host.batches[1].ops).toEqual(
      expect.arrayContaining([
        ['prop', 7, 'value', 'Ana'],
        ['setText', 9, 'Hello Ana'],
      ]),
    );
    expect(host.batches[1].ops).toHaveLength(2);
    expect(host.mirror.render()).toContain('mk-text "Hello Ana"');
    appRef.destroy();
  });

  it('ignores events for nodes nobody listens to', async () => {
    const { host, appRef, send } = await startCounter();

    await send({ seq: 1, event: 'tap', node: 3 });

    expect(host.batches).toHaveLength(1);
    appRef.destroy();
  });
});
