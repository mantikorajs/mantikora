import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { detectHost, provideMantikora } from '../renderer';

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideMantikora(detectHost())],
};
