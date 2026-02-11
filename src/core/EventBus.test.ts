import { describe, it, expect } from 'vitest';
import { EventBus } from './EventBus';
import type { InputState } from './types';
import { NULL_INPUT } from './types';

describe('EventBus', () => {
  it('emits to subscribers', () => {
    const bus = new EventBus();
    let received: InputState | null = null;
    bus.on('input:state', (s) => {
      received = s;
    });
    bus.emit('input:state', NULL_INPUT);
    expect(received).toBe(NULL_INPUT);
  });

  it('unsubscribe stops receiving', () => {
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.on('input:state', () => count++);
    bus.emit('input:state', NULL_INPUT);
    unsub();
    bus.emit('input:state', NULL_INPUT);
    expect(count).toBe(1);
  });

  it('clear removes all listeners', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('input:state', () => count++);
    bus.clear();
    bus.emit('input:state', NULL_INPUT);
    expect(count).toBe(0);
  });
});
