
import { Engine } from './engines';

export class EngineRegistry {
  private engines = new Map<string, Engine>();

  register(engine: Engine) {
    this.engines.set(engine.name, engine);
  }

  get<T extends Engine>(name: string): T {
    const engine = this.engines.get(name);
    if (!engine) {
      throw new Error(`Engine not found: ${name}`);
    }
    return engine as T;
  }
}
