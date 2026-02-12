import { describe, it, expect } from 'vitest';
import { EventBus } from './EventBus';
import { ObjectiveManager } from './ObjectiveManager';

describe('ObjectiveManager', () => {
  it('emits current objective and advances on completion', () => {
    const eventBus = new EventBus();
    const manager = new ObjectiveManager(eventBus);
    const setEvents: Array<{ id: string; text: string }> = [];
    const completedEvents: Array<{ id: string; text: string }> = [];

    eventBus.on('objective:set', (payload) => setEvents.push(payload));
    eventBus.on('objective:completed', (payload) => completedEvents.push(payload));

    manager.setObjectives([
      { id: 'a', text: 'First objective' },
      { id: 'b', text: 'Second objective' },
    ]);

    expect(setEvents.at(-1)).toEqual({ id: 'a', text: 'First objective' });

    manager.complete('a');
    expect(completedEvents.at(-1)).toEqual({ id: 'a', text: 'First objective' });
    expect(setEvents.at(-1)).toEqual({ id: 'b', text: 'Second objective' });

    manager.complete('b');
    expect(setEvents.at(-1)).toEqual({ id: 'none', text: 'All objectives complete' });
  });

  it('reports completion state by id', () => {
    const eventBus = new EventBus();
    const manager = new ObjectiveManager(eventBus);
    manager.setObjectives([{ id: 'door', text: 'Open the door' }]);

    expect(manager.isCompleted('door')).toBe(false);
    manager.complete('door');
    expect(manager.isCompleted('door')).toBe(true);
    expect(manager.isCompleted('missing')).toBe(false);
  });
});

