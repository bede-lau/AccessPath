import http from "node:http";

// Placeholder shell only — barriers and form logic arrive in P03.
const PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demo Aid Application</title>
  </head>
  <body>
    <main>
      <h1>Demo fixture — implemented in P03</h1>
    </main>
  </body>
</html>
`;

export function createDemoServer(): http.Server {
  return http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(PAGE_HTML);
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ error: "not_found" }));
  });
}

export function start(
  port = Number(process.env.DEMO_AID_APP_PORT ?? 4173),
  host = "127.0.0.1",
): Promise<http.Server> {
  const server = createDemoServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export function stop(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
