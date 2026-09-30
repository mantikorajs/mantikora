import { EnvironmentProviders, RendererFactory2, makeEnvironmentProviders } from '@angular/core';
import { NativeRendererFactory } from './native-renderer';
import { MantikoraHost } from './protocol';

/** Replaces Angular's DOM renderer with the Mantikora renderer and exposes `__mantikora.receive` to the host. */
export function provideMantikora(host: MantikoraHost): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: NativeRendererFactory,
      useFactory: () => {
        const factory = new NativeRendererFactory(host);
        (globalThis as { __mantikora?: unknown }).__mantikora = {
          receive: (json: string) => factory.bridge.receive(json),
        };
        return factory;
      },
    },
    { provide: RendererFactory2, useExisting: NativeRendererFactory },
  ]);
}
