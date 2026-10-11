// The one scene, shared between the component that mounts it and the stream
// that feeds it. A module-level handle rather than React context, because the
// SSE client is not a component and must not re-render anything to push a frame.

import type { Scene } from './Scene.js';

let current: Scene | null = null;

export const setScene = (s: Scene | null): void => {
  current = s;
};
export const getScene = (): Scene | null => current;
