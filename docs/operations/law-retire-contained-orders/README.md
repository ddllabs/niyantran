# Law retirement of three contained orders (owner-authorized-20261027-law-retire-contained-orders)

> **Status: Historical (dated 2026-10-27).** Three short IBBI_NCLT orders were retired from serving. Each one's text
> is contained in a longer order of the same day that was kept. Nothing was deleted, and the change is reversible.

- **Decision:**
  - Owner Tamanesh Kauri, in chat, 2026-10-27 14:56 IST: "Keep the longer orders as you listed".
  - This applies to the three overlapping pairs found by the autopilot receipts for batches 7, 9 and 10.
- **Retired (hidden), with the order kept beside each:**

  | Pair | Retired (shorter) | Chunks | Kept (longer) | Chunks | Order date |
  | --- | --- | --- | --- | --- | --- |
  | Master Weaver Ethnics India | `9781d6d42a44617e` (record `78c677c9…2d`) | 14 | `91d46e288216be50` | 83 | 2024-05-02 |
  | Dharti Dredging and Infrastructure | `9a4c2ee179c4082b` (record `ba0737e8…79`) | 49 | `1b551478588dfa33` | 174 | 2023-07-20 |
  | MSA Developers | `dae6d05550bdb5c3` (record `e21cc65e…f3`) | 6 | `912189341684a077` | 34 | 2023-10-13 |

- **Mechanism** (one transaction, service SQL, 2026-10-27):
  - `law_records.visible = false` on the three listing records. With the listing hidden:
    - `law_document_is_published` is false for those documents;
    - the documents, chunks and desk rows are hidden from authenticated readers by the existing restrictive policies;
    - retrieval (`match_documents`, which runs under the caller's JWT) and `law_listing_page` (security invoker) no
      longer return them.
  - `law_publications` for the three documents was updated as follows:
    - `status` changed from `published` to `held`;
    - `decision_id` set to `owner-authorized-20261027-law-retire-contained-orders`;
    - `approver` set to `Tamanesh Kauri (chat, 2026-10-27 14:56 IST)`;
    - a reason appended that names the kept order and the prior decision.
  - The documents, chunks, text inputs, jobs and links are unchanged. Nothing re-publishes them:
    - no function sets `visible` back to true;
    - the indexing trigger fires only when `indexed_at` is first set;
    - `law_reconcile` holds any re-submission against a hidden listing (`listing_identity_conflict`).
- **Verified as `authenticated`:**
  - The three retired documents: 0 visible documents, chunks, records, desk rows and listing results.
  - The three kept documents: visible, with 83, 174 and 34 chunks.
  - Law documents served: 7,546 of 7,549.
  - Autopilot documents served: 4,436 of 4,439.
  - Visible listings: 7,875 of 7,878.
- **To reverse** (for any one pair), in one transaction:

  ```sql
  update public.law_records set visible = true where id = '<record id>';
  update public.law_publications
     set status = 'published', decision_id = '<new decision>', approver = '<owner>', updated_at = now()
   where document_id = '<document id>';
  ```
