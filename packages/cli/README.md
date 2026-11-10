# @nodium.io/cli

[![npm version](https://img.shields.io/npm/v/@nodium.io/cli.svg)](https://www.npmjs.com/package/@nodium.io/cli)
[![license](https://img.shields.io/npm/l/@nodium.io/cli.svg)](./LICENSE)

The `nodium` command for the [Nodium](https://nodium.io) WhatsApp API: check
your setup, read your numbers and conversations, ship templates, webhooks and
Flows, add clients — and replay your webhooks to your local server, signed like
production. A thin layer over
[`@nodium.io/whatsapp`](https://www.npmjs.com/package/@nodium.io/whatsapp):
same key, same client header, same errors. Node 20 or later.

## Install

```bash
npm install -g @nodium.io/cli   # or run it once: npx @nodium.io/cli …
nodium login                    # paste your key (nod_…, Settings › API keys in the console)
nodium status                   # what the key is, your numbers, your webhooks, the next step
```

`nodium status` answers in a few lines:

```
Authentication: authenticated
Key: nod_1a2b… "ci", never expires
Account: Acme (acc_…)
Access: every client of the account
Clients: 12
WhatsApp Numbers: 3 (3 on)
Webhooks: 1 active of 1

Next:
  nodium numbers list
  nodium send --channel <id> --to <+33…> --text "Hello"
```

- `Access` is `every client of the account`, or the client the key is pinned to.
- `Clients` shows only for a key that is not pinned.
- `Webhooks: not visible with this key (pinned to My company)`: the
  subscriptions of "My company" receive every client's events, so a key pinned
  to My company cannot read them. Use a key that is not pinned.

`nodium login` checks the key with Nodium and saves it to
`$XDG_CONFIG_HOME/nodium/config.json` (`~/.config/nodium/config.json` by
default), readable by you only. The key is looked up in this order: `--key`,
then `NODIUM_KEY`, then that file. It is never printed in full. `nodium logout`
deletes the file.

## Commands

```
nodium login | logout | status | health
nodium events [--after <seq>] [--limit <n>]

nodium numbers list [--all] | get <id> | check <id> | diagnose <id>
nodium conversations list [--channel <id>] [--contact <id>] [--phone <n>] | get <id>
nodium messages list <conversationId> | get <id>
nodium contacts list [--search <text>] | get <id>
nodium templates list [--all] | get <id> | new --input <file> | update <id> --input <file>
nodium templates deploy <id> | refresh <id> | wait <id> [--timeout 10m] | delete <id> | import [--all]
nodium webhooks list | deliveries [--failed] | new --url <url> --event <name> | update <id>
nodium webhooks delete <id> | test <id> | redeliver <deliveryId> | rotate-secret <id>
nodium tenants list | get <id> | new --name <name> [--external-id <id>] [--connect-link] | update <id> [--name …] [business fields]
nodium connect-link new --tenant <id> [--mode dedicated|coexistence] [--phone <+33…>] [business fields, below]
nodium connect-link list [--state pending|used|expired] [--client <id>] | update <id> [--expires-in-days 7] [--redirect-url <url>] | revoke <id>
nodium logs [--errors] | stats [--source template|broadcast] [--channel <id>] | sandbox
nodium flows deploy <file.json> [--name <name>] [--id <flowId>] [--publish]

nodium send --channel <id> --to <+33…> --text "…" | --template <name> | --input <file> | --stdin
nodium listen --forward <url> [--secret <whsec_…>] [--events a,b]
```

`nodium help <command>` (or `--help`) describes each one. Lists show the newest
20; `--limit <n>` shows more, following the pages for you.

Options for every command:

- `--tenant <id>` acts for one of your clients (its id or your own
  `externalId`). Without it, a command acts on "My company", or on the client
  the key is pinned to.
- `--output json|human` — see below.
- `--yes` (`-y`) approves a command that sends or changes something.
- `--key`, `--base-url` (or `NODIUM_BASE_URL`), `--no-color` (or `NO_COLOR`).

## A template, from file to approved

```bash
cat > order_ready.json <<'EOF'
{ "name": "order_ready", "language": "en", "category": "UTILITY",
  "body": "Hello {{1}}, your order is ready." }
EOF

nodium templates new --input order_ready.json   # a draft: nothing goes to Meta yet
nodium templates deploy <id>                     # asks "Proceed? [y/N]"
nodium templates wait <id> --timeout 10m         # exit 0 approved, 1 refused or timed out
nodium send --channel <id> --to +33612345678 --template order_ready --language en --var 1=Karim
```

`templates wait` asks Meta every 15 seconds until every WhatsApp account of the
client approved the template, or one rejected, paused or disabled it.

## Send

```bash
nodium send --channel <id> --to +33612345678 --text "Hello"
nodium send --channel <id> --to +33612345678 --input image.json   # any message: the JSON of POST /messages
```

Free text only goes within 24 hours of the person's last message; a template is
the only way to write first. A send Meta refuses answers HTTP 200: the command
reads the message status, prints why, and exits 1.

## Webhooks, clients, Flows

```bash
nodium webhooks new --url https://app.example.com/webhooks/nodium --event message.received --event message.failed
nodium webhooks deliveries --failed
nodium webhooks redeliver <deliveryId>

nodium tenants new --name "Agence Horizon" --external-id crm-4187 --connect-link
nodium connect-link new --tenant crm-4187 \
  --business-name "Agence Horizon" --email contact@horizon.fr --website horizon.fr \
  --street "3 rue Haute" --postal-code 69001 --city Lyon --country FR \
  --category TRAVEL --description "Travel agency in Lyon."

nodium flows deploy booking.json                    # a draft Flow at Meta; validation problems printed
nodium flows deploy booking.json --id <flowId> --publish
```

The webhook secret and the connect link are shown only once: store them. A
published Flow can no longer change.

The connect page asks your client which app the number is on, then a short
"Your business" form with everything Meta asks for, then opens Meta's window
already filled. The business flags of `tenants new --connect-link` and
`connect-link new` prefill that form, field by field: `--business-name`
(default: the client's name), `--display-name` (the name shown in WhatsApp),
`--email`, `--website`, `--street`, `--postal-code`, `--city`, `--country`,
`--category` and `--description`. The more you give, the less your client
types.

## Listen

No tunnel, no public address: it reads your events from Nodium and replays
each one to a URL on your machine.

```bash
nodium listen --forward http://localhost:3000/webhook --secret whsec_… --events message.received,message.failed
```

```
Listening from now → http://localhost:3000/webhook
10:32:01  message.received         200     12 ms  evt_0123…
10:32:07  message.failed           500      4 ms  evt_4567… [crm-4187]
```

- Each call is the body of a real delivery and carries the real headers
  (`X-Nodium-Event`, `X-Nodium-Delivery`, and `X-Nodium-Signature: t=…,v1=…` when
  you give `--secret`, or `NODIUM_WEBHOOK_SECRET`). The signature is computed
  locally with the secret you give: use the one of your webhook subscription, or
  any string your code also uses to verify.
- It reads the event log (`GET /events`) from a cursor, so a dropped connection
  loses nothing; `Ctrl+C` stops it and prints the number to resume from
  (`--from <seq>`).
- It acts on the events of every client of the account, unless `--tenant <id>`
  names one or the key is pinned to one. `--verbose` prints each event's
  `data`; `--interval <ms>` sets the polling pace (default 1000).
- A call your server answers with a non-`2xx` status, or not at all, is shown
  and not retried.

## Output and exit codes

- `--output human` (the default in a terminal): short lines and tables, then a
  `Next:` block with the commands that usually come next.
- `--output json` (the default when the output is piped): the object the SDK
  returns, unchanged, on stdout. A refusal goes to stderr as
  `{ "error": { "status", "code", "message", "requestId" } }`.
- Exit code `0` done, `1` refused by Nodium or Meta (also a template refused, a
  Flow with problems, a failed send), `2` a wrong command line or a missing
  approval.

## Approval before a write

`send`, `templates deploy|delete`, `webhooks new|update|delete|redeliver|rotate-secret`,
`tenants new`, `connect-link new` and `flows deploy` say what they are about to
do and ask `Proceed? [y/N]`. Outside a terminal nobody can answer: they refuse
(exit 2) unless you pass `--yes`.

## Using the CLI with an AI agent

The CLI suits a coding agent (Claude Code, Cursor, Codex…) as it is:

1. **Read first.** `nodium status`, `nodium numbers list`, `nodium templates get <id>`,
   `nodium conversations list`: they change nothing and need no approval.
2. **Confirm before writing.** Show the person what will be sent or changed,
   then run the command with `--yes` only once they agreed. Without `--yes`, a
   write run by an agent stops with exit code 2: nothing is sent.
3. **Use JSON.** Piped, every command prints JSON; pass `--output json` to be
   sure. Branch on `error.code`, never on the message.
4. **Give the agent its own key**, pinned to one client and with an expiry
   (`POST /keys` with `clientId` and `expiresInDays`), through `NODIUM_KEY`.

## License

MIT © By-Tech.io
