import { createMiddleware } from "@solidjs/start/middleware";
import { api } from "./api";

export default createMiddleware({
  onRequest: async (event) => {
    const url = new URL(event.request.url);
    if (url.pathname.startsWith("/api")) {
      const response = await api.fetch(event.request);
      if (response.ok || response.status === 404) {
        event.response.status = response.status;
        event.response.headers.set("Content-Type", "application/json");
        return response;
      }
    }
  },
});
