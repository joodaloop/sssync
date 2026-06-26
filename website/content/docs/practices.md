---
title: Best Practices
description: A few recommendations before you get started.
---

### Ensure you actually want a local-first application

Bad fit for:
- Random data access. Like Youtube, or Twitter.
- Apps that interact with physical resources like money, or...a railwway crossing gate.
- Domains that need to preserve invariants
- Content websites. Try using a Service Worker cache instead.
- Low session duration, many visitors.

### Fractional indexes

### Local-only events

### Data modelling
Use junction tables and foreign keys instead of nested JSON objects.
