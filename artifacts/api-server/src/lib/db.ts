import Database from "@replit/database";

const client = new Database();

type DbResult<T> = { ok: true; value: T } | { ok: false; value: null };

export const db = {
  async get(key: string): Promise<DbResult<string | null>> {
    try {
      const result = await client.get(key);
      if (result && typeof result === "object" && "ok" in result) {
        const r = result as { ok: boolean; value: unknown };
        const v = r.value;
        return {
          ok: true,
          value: typeof v === "string" ? v : v == null ? null : JSON.stringify(v),
        };
      }
      return {
        ok: true,
        value:
          typeof result === "string"
            ? result
            : result == null
            ? null
            : JSON.stringify(result),
      };
    } catch {
      return { ok: false, value: null };
    }
  },

  async set(key: string, value: string): Promise<{ ok: boolean }> {
    try {
      await client.set(key, value);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },

  async delete(key: string): Promise<{ ok: boolean }> {
    try {
      await client.delete(key);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },

  async list(prefix?: string): Promise<DbResult<string[]>> {
    try {
      const result = await client.list(prefix ?? "");
      if (result && typeof result === "object" && "ok" in result) {
        const r = result as { ok: boolean; value: unknown };
        return {
          ok: true,
          value: Array.isArray(r.value) ? (r.value as string[]) : [],
        };
      }
      return {
        ok: true,
        value: Array.isArray(result) ? (result as string[]) : [],
      };
    } catch {
      return { ok: false, value: null };
    }
  },
};
