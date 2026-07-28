import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { start, stop } from "../src/server";

describe("demo-aid-app server", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      await stop(server);
      server = undefined;
    }
  });

  function baseUrl(instance: http.Server): string {
    const { port } = instance.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it("serves the accessible placeholder page on GET /", async () => {
    server = await start(0);
    const response = await fetch(`${baseUrl(server)}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    const html = await response.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<main>");
    expect(html).toContain("<h1>Demo fixture — implemented in P03</h1>");
  });

  it("returns ok JSON on GET /health", async () => {
    server = await start(0);
    const response = await fetch(`${baseUrl(server)}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown routes and stops cleanly", async () => {
    server = await start(0);
    const response = await fetch(`${baseUrl(server)}/nope`);
    expect(response.status).toBe(404);

    await stop(server);
    server = undefined;
  });
});
