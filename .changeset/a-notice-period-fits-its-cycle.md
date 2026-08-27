---
'@saasicat/nest': minor
---

A notice period belongs to a rhythm, not to a platform

`cancellationNoticeDays` took one number for every subscription and now takes
one per rhythm — `{ monthly, yearly }`, both defaulting to `0`. One number could
not be right for both: a fortnight of notice on a yearly contract is unusual,
and three months on a monthly one is void against a consumer under §309 Nr. 9
BGB. No ceiling is enforced, because the platform cannot know whether an
installation serves consumers or businesses. The rhythm that decides is the
subscription's, not the plan's, and a rhythm nobody configured is owed nothing
rather than inheriting the other one.

A notice longer than the billing period was neither reachable nor honoured: the
deadline it computed had always passed, so every declaration counted as late,
and the remedy was exactly one period — 60 days of notice on a monthly cycle
gave the customer between 31 and 60 days depending on the day they declared. A
cancellation now lands on the first period end that actually serves the notice.

An add-on has no notice period, which was already the behaviour and is now the
decision: cancelling one takes effect at the end of its own period, or its
minimum term, or the plan's end — whenever it is declared. A test refuses any
reference to the notice machinery from the bundle path.
