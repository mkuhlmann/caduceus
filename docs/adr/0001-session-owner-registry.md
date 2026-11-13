# Which bot owns a chat is kept in a registry, not passed with each request

A bot's chats live under `/p/<profile>/` on the gateway, so every request for a chat needs to know which bot owns
it. `src/lib/gateway.ts` keeps that in a registry (`setSessionProfile`) that is filled when a chat is first met,
instead of taking the bot as an argument to each of its many calls. The cost is an ordering rule: a chat must be
registered before anything requests it, which is why ChatView registers a bot's other conversations in a
synchronous watch. Threading the bot through every call would widen the gateway's interface for every caller (most
of whom only have a chat id) without fixing a bug seen so far. Revisit this if a request is ever found going to the
wrong bot.
