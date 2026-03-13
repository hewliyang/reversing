# Cross-agent messages

This plugin uses a brokered **WebSocket message bus** called **conductor** for cross-agent communication.

## What it is

- Each Office add-in instance registers as an agent, e.g. `excel-xxxxxx`, `powerpoint-xxxxxx`.
- The client opens a WebSocket to a URL like `/v2/conductor/<user>`.
- A server in the middle tracks connected agents and relays messages/events.

## Tools

### `get_connected_agents`
Returns the local client's cached list of peers. It does **not** directly query the target agent.

### `send_message`
Sends a fire-and-forget packet over the conductor socket:

```json
{
  "type": "conductor_send_message",
  "to": "powerpoint-0e0009",
  "message": "Hi"
}
```

It returns immediately. Any reply arrives later as a **new inbound message**, not as the return value of the tool call.

## Receiving side

When an agent receives a `conductor_message`, the add-in queues it and feeds the message text into that agent's local query loop. So this is closer to **async agent-to-agent messaging** than classic request/response RPC.

## File sharing

Inside `execute_office_js`, a `conductor` global is exposed:

- `conductor.writeFile(name, data)`
- `conductor.readFile(agentId, name)`
- `conductor.listFiles(agentId)`

Shared files are mirrored into a virtual filesystem like:

- `/agents/<agent-id>/transcript.jsonl`
- `/agents/<agent-id>/files/<name>`

## Architecture

```text
Excel add-in
  -> WebSocket
    -> conductor server
      -> WebSocket
        -> PowerPoint add-in
```

So: **yes, there is a server handling cross-agent messages**. It is brokered, not direct peer-to-peer communication.
