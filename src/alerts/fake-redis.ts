import type { RedisClient } from "./redis";

/** Just enough Redis for the alert store: GET, SET [NX] [PX], DEL, and the compare-and-delete release script. */
export class FakeRedis implements RedisClient {
  data = new Map<string, { value: string; until: number | null }>();
  commands: Array<Array<string | number>> = [];
  constructor(private clock: () => number = Date.now) {}

  private live(key: string) {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.until !== null && entry.until <= this.clock()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  async command(args: Array<string | number>): Promise<unknown> {
    this.commands.push(args);
    await Promise.resolve();
    const [name, key, ...rest] = args as [string, string, ...Array<string | number>];
    if (name === "GET") return this.live(key)?.value ?? null;
    if (name === "DEL") return this.data.delete(key) ? 1 : 0;
    if (name === "SET") {
      const [value, ...flags] = rest as string[];
      const nx = flags.includes("NX");
      const px = flags.indexOf("PX");
      if (nx && this.live(key)) return null;
      this.data.set(key, { value: String(value), until: px >= 0 ? this.clock() + Number(flags[px + 1]) : null });
      return "OK";
    }
    if (name === "EVAL") {
      const [, , , lockKey, owner] = args as [string, string, number, string, string];
      const entry = this.live(lockKey);
      if (entry?.value === owner) {
        this.data.delete(lockKey);
        return 1;
      }
      return 0;
    }
    throw new Error(`FakeRedis: unsupported ${String(name)}`);
  }
}
