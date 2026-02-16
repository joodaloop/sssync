import path from "node:path";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { api } from "./src/server/api";
import type { Plugin } from "vite";

function honoDevServer(): Plugin {
  return {
    name: "hono-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();

        const url = new URL(req.url, `http://${req.headers.host}`);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }

        const request = new Request(url.toString(), {
          method: req.method,
          headers,
        });

        const response = await api.fetch(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [solidPlugin(), honoDevServer()],
  resolve: {
    alias: {
      sssync: path.resolve(__dirname, "../src/index.ts"),
    },
  },
});
