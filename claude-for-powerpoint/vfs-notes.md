# VFS notes

The PowerPoint bundle exposes a **virtual, read-only bash tool** backed by an in-memory `/agents` filesystem.

## Key finding

This is very likely powered by **just-bash**:

- the bundle contains the string `Linux version 5.15.0-generic (just-bash) #1 SMP PREEMPT`
- it also contains `just-bash shell builtins`
- the shell runtime is implemented by `class XG`, which manages env/cwd, commands, and `exec()` over a virtual filesystem

## Architecture

There are two shell instances over the same VFS:

- **writer shell**: full access, used internally to maintain `/agents/...`
- **reader shell**: read-only, exposed as the `bash` tool

A read-only FS proxy blocks mutations like:

- `writeFile`
- `appendFile`
- `mkdir`
- `rm`
- `cp`
- `mv`

So the user-facing bash tool can inspect the workspace but cannot modify it.

## VFS layout

Each connected agent gets a directory:

```text
/agents/<agent-id>/
  transcript.jsonl
  metadata.json
  status.json
  files/
```

Typical contents:

- `transcript.jsonl` — conversation history mirrored as JSONL
- `metadata.json` — agent schema/display/capabilities
- `status.json` — current status such as file name / document URL
- `files/` — files shared through conductor

## How it is populated

Conductor events are mirrored into the VFS:

- message streams append to `/agents/<id>/transcript.jsonl`
- agent online/status events write `metadata.json` and `status.json`
- shared files are written to `/agents/<id>/files/<name>`

Interestingly, the internal writer often updates the VFS by running shell commands like:

- `mkdir -p /agents/<id>`
- `cat > /agents/<id>/metadata.json`
- `cat >> /agents/<id>/transcript.jsonl`

## Exposed bash tool

The `bash` tool does **not** run the host machine's real shell. It executes commands inside the read-only just-bash runtime over the virtual `/agents` tree.

It is intended for inspecting conductor state, not general shell access.

### Allowed commands

Whitelisted commands include:

- `cat`, `head`, `tail`, `wc`
- `grep`, `egrep`, `fgrep`, `rg`
- `find`, `cut`, `sort`, `uniq`, `tr`
- `jq`, `base64`, `ls`, `pwd`, `tree`
- and a few other simple utilities

### Not available

Examples explicitly not available:

- `awk`, `sed`, `echo`, `printf`
- `curl`, `wget`
- `python`, `node`
- `less`, `more`

## `conductor.*` API spec

A `conductor` global is injected into:

- `execute_office_js` code
- PowerPoint OOXML zip-edit sandboxes (`edit_slide_xml`, `edit_slide_chart`, `edit_slide_master`-style code paths)

It exposes exactly three methods:

### `conductor.writeFile(name, data)`
Broadcast a file to connected peers.

**Behavior**
- Throws if the conductor client is not connected:
  - `Conductor client not connected — cannot broadcast file`
- Validates `name` with this regex:
  - `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$`
- Sends a conductor `file` event via `emitFile(name, data)`
- The file is mirrored into the VFS as:
  - `/agents/<your-agent-id>/files/<name>`
- Peers receive the file in their own conductor cache / VFS

**Notes**
- Intended for text payloads like JSON, XML, CSV, TSV, TXT, MD, SVG
- The implementation does not await anything; it is effectively synchronous from sandbox code
- This is transport/shared-state, **not durable document storage**

### `conductor.readFile(agentId, name)`
Read a shared file from the local conductor cache.

**Behavior**
- Validates `agentId` with this regex:
  - `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$`
- Returns the cached file contents if present
- Returns `null` if the file is not known locally

**Notes**
- Reads from the same per-agent file map that is mirrored into:
  - `/agents/<agentId>/files/<name>`
- No network request is made here; this is a local cache lookup
- The prompt strongly encourages reading and using the file in the **same tool call** so large payloads do not leak into chat context

### `conductor.listFiles(agentId)`
List currently known shared files for an agent.

**Behavior**
- Validates `agentId` with the same regex as above
- Returns an array of filenames
- Returns `[]` if no files are known for that agent

## Validation rules

### Agent IDs
Used by `readFile()` and `listFiles()`:

```text
^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$
```

Invalid IDs throw:

```text
Invalid agentId: <value>
```

### Filenames
Used by `writeFile()` storage/broadcast path:

```text
^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$
```

Invalid names throw:

```text
Invalid filename: <value>
```

## Lifecycle / persistence

These files are **ephemeral**.

- They live in conductor-managed in-memory state plus the mirrored VFS
- They are not saved into the `.pptx`
- They are not normal local filesystem files
- They can be replayed briefly from the conductor server, but the client registers with `peerRetention: 60` and there is explicit expiry/purge handling

So `conductor.writeFile()` is best understood as:

- **temporary cross-agent artifact broadcast**, not persistence

## Practical purpose

This VFS + `conductor.*` pair gives the model a safe way to inspect and exchange:

- connected-agent transcripts
- shared conductor files
- peer metadata and status

without exposing the real local filesystem or a real shell.

Typical workflow:

1. Use virtual `bash` to inspect `/agents/<id>/transcript.jsonl` or peek at `/agents/<id>/files/...`
2. If full data is needed, use `conductor.readFile(agentId, name)` inside `execute_office_js`
3. If sending large data to another agent, use `conductor.writeFile(name, data)` and then `send_message` with a short instruction
