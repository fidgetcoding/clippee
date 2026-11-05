import type { LabFx } from '../types';

/** Every effect from src/fx/lab/, by id. Builds canvases, so call it in a browser. */
export function createLabFx(): Record<string, LabFx>;
