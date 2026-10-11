// Opening the car picker, and what it does to the selection.

import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/store/store.js';

const reset = (): void => {
  useStore.setState({ sel: null, picker: null, history: [] });
};

beforeEach(reset);

describe('the picker', () => {
  it('is closed to start with', () => {
    expect(useStore.getState().picker).toBeNull();
  });

  it('opens with the cars under the tap', () => {
    useStore.getState().openPicker([44, 81, 4, 1]);
    expect(useStore.getState().picker).toEqual([44, 81, 4, 1]);
  });

  it('closes without changing the selection', () => {
    useStore.getState().select(44, false);
    useStore.getState().openPicker([44, 81]);
    useStore.getState().closePicker();
    expect(useStore.getState().picker).toBeNull();
    expect(useStore.getState().sel).toBe(44);
  });

  it('closes when a car is chosen from it', () => {
    useStore.getState().openPicker([44, 81, 4, 1]);
    useStore.getState().select(81, false);
    expect(useStore.getState().picker).toBeNull();
    expect(useStore.getState().sel).toBe(81);
  });

  it('opening it does not disturb the current selection', () => {
    useStore.getState().select(4, false);
    useStore.getState().openPicker([44, 81]);
    expect(useStore.getState().sel).toBe(4);
  });
});
