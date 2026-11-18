# Caduceus

A remote web UI for Hermes Agent. These are the words for what a person sees and does in it.

## Conversations

**Chat**:
A conversation with Hermes or one of its bots, held by Hermes as a session.
_Avoid_: Session (in UI copy), conversation thread

**Bot**:
A Hermes profile with its own face, model and gateway key, that people talk to by name.
_Avoid_: Agent (that is Hermes itself), profile (in UI copy)

**Bot Chat**:
A bot's one standing chat. It never resets: `/new` compacts it instead.
_Avoid_: DM, main chat

**Room**:
A group chat where several bots and the user talk together, hosted by the Hermes gateway.
_Avoid_: Group (alone), channel

**Reply chat**:
The chat that replies to a schedule's runs go to, one per job, titled `Reply to <job>`. A schedule's own chat only runs its job, so Hermes refuses anything typed into it; the first reply about a run carries what the run produced.
_Avoid_: Follow-up chat, copy

**Transcript**:
The messages Hermes has saved for a chat, oldest first.

## Runs

**Turn**:
One message from the user followed by the route the agent took in reply: its text and the tools it called.

**Run**:
The agent working on a turn right now. A chat has at most one run shown.
_Avoid_: Job (that is a schedule's run), task

**Run origin**:
How this tab knows a run. It was **sent here**, it is **watched** on the Hermes socket (a Bot Chat turn started elsewhere), or it is **followed** through the transcript while it runs in another tab, device or channel.

**Live tail**:
The running turn shown after a chat's saved transcript, which stops where the turn begins so nothing shows twice.

**Generation**:
Hermes' number for one turn of a Bot Chat. It tells a watched turn apart from the next one.

**Approval**:
A command the agent waits to run until the user allows or denies it.

**Clarify question**:
A question the agent asks the user with its clarify tool, answered by choosing or typing.

**Steer**:
A message sent while a run goes on. It redirects the run instead of starting a new turn.
_Avoid_: Interrupt, queue

**Face**:
A bot's drawn avatar. Its expression shows what the bot's run is doing or waiting for.
_Avoid_: Avatar (for the state), icon

## Notifications

**Notice**:
One piece of news the relay sends while you are away: a bot waits for you, a reply is ready, a room needs you, a schedule failed. A newer notice about the same chat replaces the older one.
_Avoid_: Alert, push (that is how it travels)

**Channel**:
Somewhere besides your devices that gets every notice: an ntfy topic or a webhook.
_Avoid_: Target, endpoint (in UI copy)

**Presence**:
A device saying it is in use right now, and which chat it shows, so that nothing notifies you about what you are looking at.
