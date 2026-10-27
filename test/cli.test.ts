import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the real CLI in a subprocess with HOME pointed at a temp dir, so the
// config it reads is ours, and against a fake CouchDB served by Bun.serve.
let home: string;
let server: ReturnType<typeof Bun.serve>;
const deletes: string[] = [];

async function writeConfig(config: unknown): Promise<void> {
  await Bun.write(
    join(home, ".config", "sillon", "config.json"),
    JSON.stringify(config),
  );
}

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", "src/index.ts", ...args], {
    env: { ...process.env, HOME: home, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "sillon-cli-"));
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (req.method === "DELETE") {
        deletes.push(url.pathname);
        return Response.json({ ok: true });
      }
      if (url.pathname === "/testdb/no-rev") {
        return Response.json({ _id: "no-rev", x: 1 });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });
});

afterAll(async () => {
  server.stop(true);
  await rm(home, { recursive: true, force: true });
});

describe("sillon CLI", () => {
  it("doc delete fails clearly when the document has no _rev", async () => {
    const url = `http://localhost:${server.port}`;
    await writeConfig({
      connections: { fake: url },
      defaultConnectionName: "fake",
    });
    const { stdout, stderr } = await run(
      "doc",
      "delete",
      "no-rev",
      "testdb",
      "--force",
    );
    expect(stdout + stderr).toContain('Document "no-rev" has no _rev');
    expect(deletes).toEqual([]);
  });

  it("connect list prints (unnamed) for a connection without a name", async () => {
    await writeConfig({ connections: { "": "http://example.invalid:5984" } });
    const { stdout } = await run("connect", "list");
    expect(stdout).toContain("(unnamed)");
    expect(stdout).toContain("http://example.invalid:5984");
  });
});
