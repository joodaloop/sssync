import { defineConfig } from "@solidjs/start/config";
import { createApp } from "vinxi";
import { Hono } from "hono";

export default defineConfig({
  middleware: "./src/server/middleware.ts",
  ssr: false,
});
