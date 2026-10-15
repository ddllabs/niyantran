# Record panel graph, brief loading, and a fresh chat by default (F204, F205, F206)

> **Status: Living.** Owner requests 2026-10-16, UI only. Built on `task/module-scroll`.

## F204. No relations graph on record panels

Owner: the four-lane graph ("Bill & its impact", "Bloc & what it touches", …) "is not genuine, it
can be misleading … we should remove that wherever it comes."

- Found: one component (`TouchGraph`) drawn by `RecordPanel` for 26 record types. Its lanes are thin:
  a bill's "sector" repeats its ministry's name, and most far lanes read "None on record".
- Done: the graph, its node count and its caption are gone from every record panel. The related
  records under it are real register rows (other bills of the ministry, blocs sharing members, …) and
  stay, as "NN · Related on record". `TouchGraph.jsx` and its styles are deleted; the model contract
  no longer requires lanes or a centre node. The adapters still compute `lanes`/`nodes`, now unread
  (left for a cleanup, to keep this change out of 26 adapter files).

## F205. Reading a stored brief vs writing one

Owner: "Is it that we are re-analyzing it every time it's clicked, or once it's analyzed, we keep it
forever? … When a genuine API call is happening, we can use this company's logo with the shimmering
effect … When it is simply loading from our database, it will be simply loading."

- Answer: a brief is written once, stored and reused (F123); every later opening reads it. Both
  showed "Writing AI brief…" before, which read as re-analysis.
- One request returns the stored brief or writes it, so the browser tells them apart by time: the
  first 1.2 s is a plain two-line skeleton ("Loading the AI brief…" for screen readers); after that,
  or when the server says another request is writing it ('pending'), the card shows the Niyantran
  mark and "Writing the AI brief…" over three shimmering lines (transform only; still with reduced
  motion). A server flag for "writing" would make it exact; not needed now.

## F206. A new chat by default

Owner: "no matter where you click … the last message that opens up is always the last chat … the
default action is a new chat" unless the reader opens a previous chat.

- Found: the thread picks the newest conversation on first load and the panel never unmounts, so it
  kept showing it; nothing reset it on a desk, module or record change.
- Done: the thread keeps a `stale` mark, set at start, on sign-in changes and by `contextChanged()`
  (the panel calls it when the desk, module or selected record changes). When AI opens (or becomes
  ready), `freshIfStale()` starts a new local chat (no server row until its first turn). It does
  nothing while an answer runs, while a conversation asked for by the credits page is on its way, or
  when the active chat is already an untouched new one; choosing from history, opening from the
  credits page, sending and the + button clear the mark. The panel runs it before the seed effect, so
  a record's Ask AI or a drop lands in the new chat. While AI is already showing, clicking a row keeps
  the chat (the reader may be adding records to it).

## Evidence

- Unit tests for each (graph absent and related records kept; skeleton vs mark and the 1.2 s switch;
  the controller's fresh-chat rules and the panel wiring), full suite, lint and build.
- Browser (signed-in local preview): the first AI open shows a new chat; after picking an old chat,
  selecting a row, visiting Record and returning to AI, a new chat (0 messages).

## Review (2026-10-16)

Independent `agent-skills:code-reviewer` on `9b21083..f7f76b8`: one required fix, taken up. A new chat
never replaces the reader's work: an unsent new chat (with records attached or not) or text typed in
the composer is kept. Also taken up: a page change within 1.5 s of opening a chat from the credits
page is ignored (the desk coming back after the account page); the record key is memoised; the brief's
"slow" mark is reset when its record is left, so a record visited again starts as a read.
