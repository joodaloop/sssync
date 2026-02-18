## FAQ

### Will this scale to [insert large number here] users?
It depends on how well you set things up to do so. There are no fundamental bottlenecks to keeping things performant as your storage needs increase — at worst, SSSync is much more efficient than a regular web app that makes full API requests on each payload. 

There is no special magic server that might run out of memory, or special database with storage constraints. You can build whatever backend you like, as long as it satisfies the [protocol](#protocol).

### Is this approach local-first?

The defintions of that term are *very* muddled at the moment (read more), but we think the the seven original principles of the [local-first paper](https://www.inkandswitch.com/essay/local-first/#5-the-long-now) are the correct banchmark to use.

  1. No spinners: your work at your fingertips
  2. Your work is not trapped on one device
  3. The network is optional
  4. Seamless collaboration with your colleagues
  5. The Long Now
  6. Security and privacy by default
  7. You retain ultimate ownership and control

SSSync itself doesn't make your app full local-first, it starts out as a subset and gives the developer the ability to make it fully so if they desire.

We're as offline-first as can be, so that satisfies points 1 and 3, and we're a protocol for connecting to a server that syncs updates and satisfies queries, which accomplishes 2 and 4 once implemented correctly.

Points 5, 6, and 7 are as true as you make them.
- Privacy and security: You can encrypt all user data and still continue using our sync protocol. Our library doesn't care about what you sync as long as it has unique IDs for each object.
- The Long Now: If you build a desktop app instead of web one, people can keep using it even if someone stops paying for the server. The data is usually stored as very readable JSON or SQLite.
- Ownership and control: Users can be "able to copy and modify data in any way" by appending to the event log, through any means that the developer chooses to expose that functionality. As long as they use events from the existing list, the application can process an sync them perfectly fine.
