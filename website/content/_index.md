---
title: SSSync
---

- **Make it hard to mess up:** Sync is a deceptively hard problem space. Our library should try to force people to do the right thing.
- **Flexibility over vertical integration:** The key part of our approach is a very simple HTTP-based protocol, no custom technology required.
- **Borrow from the best:** API decisions should be guided by people who have been doing this for years. In particular:
  1. Linear is the company that has had the most experience with working with sync, and their sync engine is the basis of almost of every design decision
  2. Zero/Replicache inspired our system of named mutators
  3. Industry lore from dozens of other practitioners
