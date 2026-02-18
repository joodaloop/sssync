import { Hono } from "hono";
import { users, posts } from "./data";

export const api = new Hono()
  .basePath("/api")
  .get("/users", (c) => {
    return c.json(users);
  })
  .get("/users/:id", (c) => {
    const id = Number(c.req.param("id"));
    const user = users.find((u) => u.id === id);
    if (!user) return c.json({ error: "User not found" }, 404);
    return c.json(user);
  })
  .get("/users/:id/posts", (c) => {
    const id = Number(c.req.param("id"));
    const userPosts = posts.filter((p) => p.userId === id);
    return c.json(userPosts);
  });
