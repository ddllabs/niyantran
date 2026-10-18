# D2 application launch execution

> **Status: Living.** 2026-10-18 IST. Owner approved proceeding with the D2
> plan, checking/saving the old Vercel URL first, and requesting Namecheap login
> when needed. Razorpay held; corpus ingestion excluded.

## Old website retained address — verified before any handover

**https://niyantran-weld.vercel.app/** is publicly accessible, HTTP200.
The former source repository `ItsCloudDev/niyantran` publishes this address
in its homepage metadata. No upstream remote was added or fetched.

Its public entry HTML and https://www.nter.pro/ both contain701 bytes and have
the same SHA256:

`ece75a0151d0b53baaa9d5160e00d0d3947701c99b4a032739739c0596732a58`

Both reference `/assets/index-CSPSnG4I.js` and
`/assets/index-CRDikyBL.css`. This is evidence of matching public entry pages,
not an assertion about the unknown owning project's Git commit. The Vercel
address is a project alias, not a verified immutable deployment URL; its owner
can change/remove it. No old project or deployment is to be deleted. Moving
nter.pro does not intentionally remove this alias, but continued ownership and
availability cannot be guaranteed from our account.

Initial public DNS confirms Cloudflare NS julio/sara, apex A64.29.17.1 and
216.198.79.1, and www CNAME `d88d44ae01c786a8.vercel-dns-017.com.`.
No DS answer was returned. MX answers identify Namecheap forwarding:
eforward1/2/3.registrar-servers.com priority10, eforward4 priority15 and
eforward5 priority20. Root SPF is
`v=spf1 include:spf.efwd.registrar-servers.com ~all`; no DMARC answer observed.
These forwarding records must be preserved, and the owner must confirm the
forwarding destinations and any other services. Public DNS is not a complete
zone export. Exact records are rechecked immediately before switching.

Local HTTP/DNS capture files are under /tmp/niyantran-d2-* and are untracked.
Credentials, frontend keys and dotenv contents were not read or printed.
No DNS, domain association, backend configuration or public traffic change
has occurred at this checkpoint.
