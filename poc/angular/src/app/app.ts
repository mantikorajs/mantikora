import { CUSTOM_ELEMENTS_SCHEMA, Component, signal } from '@angular/core';

/** The Phase 0 counter: one of each catalog element. */
@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class App {
  protected readonly count = signal(0);
  protected readonly name = signal('');

  protected increment(): void {
    this.count.update((c) => c + 1);
  }
}
