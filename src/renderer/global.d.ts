import type { StudioAPI } from '../shared/types';

declare global {
  interface Window {
    demoforge: StudioAPI;
  }
}

export {};
