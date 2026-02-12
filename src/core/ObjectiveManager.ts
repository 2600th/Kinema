import type { EventBus } from './EventBus';
import type { Disposable } from './types';

export interface ObjectiveDefinition {
  id: string;
  text: string;
}

type ObjectiveState = ObjectiveDefinition & { completed: boolean };

/**
 * Lightweight objective tracker that emits objective UI events.
 */
export class ObjectiveManager implements Disposable {
  private objectives = new Map<string, ObjectiveState>();
  private order: string[] = [];

  constructor(private eventBus: EventBus) {}

  setObjectives(objectives: ObjectiveDefinition[]): void {
    this.objectives.clear();
    this.order = [];
    for (const objective of objectives) {
      this.objectives.set(objective.id, { ...objective, completed: false });
      this.order.push(objective.id);
    }
    this.emitCurrentObjective();
  }

  complete(id: string): void {
    const objective = this.objectives.get(id);
    if (!objective || objective.completed) return;
    objective.completed = true;
    this.eventBus.emit('objective:completed', { id: objective.id, text: objective.text });
    this.emitCurrentObjective();
  }

  isCompleted(id: string): boolean {
    return this.objectives.get(id)?.completed ?? false;
  }

  dispose(): void {
    this.objectives.clear();
    this.order = [];
  }

  private emitCurrentObjective(): void {
    for (const id of this.order) {
      const objective = this.objectives.get(id);
      if (objective && !objective.completed) {
        this.eventBus.emit('objective:set', { id: objective.id, text: objective.text });
        return;
      }
    }
    this.eventBus.emit('objective:set', { id: 'none', text: 'All objectives complete' });
  }
}

