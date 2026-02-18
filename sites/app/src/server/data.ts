export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Post {
  id: number;
  userId: number;
  title: string;
  body: string;
}

export const users: User[] = [
  { id: 1, name: "Alice Johnson", email: "alice@example.com" },
  { id: 2, name: "Bob Smith", email: "bob@example.com" },
  { id: 3, name: "Charlie Brown", email: "charlie@example.com" },
];

export const posts: Post[] = [
  { id: 1, userId: 1, title: "Getting Started with Solid", body: "Solid.js is a reactive UI library..." },
  { id: 2, userId: 1, title: "Why Signals Matter", body: "Fine-grained reactivity changes everything..." },
  { id: 3, userId: 2, title: "Hono is Fast", body: "Hono is an ultrafast web framework..." },
  { id: 4, userId: 2, title: "Edge Computing", body: "Running code at the edge means lower latency..." },
  { id: 5, userId: 3, title: "TypeScript Tips", body: "Use discriminated unions for better type safety..." },
];
