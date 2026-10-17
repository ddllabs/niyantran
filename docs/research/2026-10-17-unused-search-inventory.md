# Stored search cleanup inventory

> **Status: Normative.** Exact local data-edit inventory, 2026-10-17. No production changes.

Before SHA256 of src/data/html-feature-map.json: 0f56dbf501aae4e390c731e77f73fe81e6538e065aa9cedd718f03083e679c39.
Remove only the source field from the 57 entries below. No entry/ID/route/row count changes.
Source-registry.json remains unchanged: primaryFeedUrl is still used by apiStatus/admin and the server; sourceUrls feeds sourceLinks and registryEndpointCount. Contrary to the older blanket description, those fields are not unread. Retaining them preserves active provenance and endpoint accounting.
The browser archive derives links from records, not feature.source. src/lib/featureFeed.js and catalog discovery consume identities, not this duplicate value. In server/featureFeed.mjs primaryFeedUrl wins and sourceLinks deduplicates the same registry URL. Topic routing uses route/openLiveFallback markers. These are the consumers and proof boundary for each listed removal.

An offline integration test compares the real loader's rows, source links and requested URLs with and without the duplicate fields for every inventoried module. All other fields and all non-search sources are retained.

```json
[
  {
    "id": "sports:Indian Sports Wire",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India+hockey+OR+badminton+OR+kabaddi+OR+athletics+OR+chess+when:7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "291183e83b7cf5ef04a92720fa1c196d299512bd43c0163d70f14aea1dce5656",
    "registryKey": "sports-indian-sports-wire",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "sports:Sports Governance & Policy",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22sports%20ministry%22%20OR%20%22national%20sports%20federation%22%20OR%20%22National%20Sports%20Code%22%20OR%20NADA%20OR%20%22anti-doping%22%20OR%20%22Indian%20Olympic%20Association%22%20OR%20IOA%20OR%20%22sports%20governance%22%20OR%20%22Sports%20Governance%20Act%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "39a333a5c77e51d69b7898b62a0727066507c7e00c958a2350284e11a62e8db8",
    "registryKey": "sports-sports-governance-and-policy",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "entertainment:Entertainment News Wire",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Entertainment%22%20OR%20%22News%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "812d06755b7f22ec2d72624c6647f167615a64df026deb6b41556f8b90500e7e",
    "registryKey": "entertainment-entertainment-news-wire",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "entertainment:Bollywood & Film Wire",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Bollywood%22%20OR%20%22Film%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "3bc8a0431358d9d42456117543de2a3459043a05576577ba73ca8be0692cb106",
    "registryKey": "entertainment-bollywood-and-film-wire",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "geopolitics:Open Fronts",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Open%22%20OR%20%22Fronts%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "8a28e9087dd4b0d6965d47ea4941d0c58d6c00fd7b4ea44cb1a1b9281e7948f2",
    "registryKey": "global-open-fronts",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "geopolitics:Global Intelligence",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Global%22%20OR%20%22Intelligence%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "ddb5c2d3f176bb4365e51f2b53fe7daa4f6cc8e09145883fcba12a6dfdf33239",
    "registryKey": "global-global-intelligence",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "geopolitics:Alliances",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Alliances%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "a2808422ecd3e24b07d5401c6ade9751d306a3d1a9d5c5eb544a809ebb5ce3c6",
    "registryKey": "global-alliances",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "geopolitics:Nuclear Watch",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Nuclear%22%20OR%20%22Watch%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "b059e45f01e7e8e36e9543ae4f5cd92b49ea59ef3ecfee4e48164af0cd0c4d3a",
    "registryKey": "global-nuclear-watch",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "geopolitics:Critical Minerals",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Critical%22%20OR%20%22Minerals%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "996437f13fc3b29fcbb2de1a730db83a7662f0b8d72a0fd6472cd1839cd7ed54",
    "registryKey": "global-critical-minerals",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "national:Delimitation Impact Simulator",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Delimitation%22%20OR%20%22Impact%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "37f24fa8cb8633339509c2255afc5aee6784accf916cdf4e57d59c5b11dbb8b9",
    "registryKey": "national-delimitation-simulator",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "national:Bureaucratic Transfers — AGMUT Cadre",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Bureaucratic%22%20OR%20%22Transfers%22%20OR%20%22AGMUT%22%20OR%20%22Cadre%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "0bab5ace4f154e32b1e86ec79c493da064a3770b3e87c23e0a9b8dbef084e0e1",
    "registryKey": "national-ias-ips-transfers-agmut",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "national:LS Manifestos & Promises Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Manifestos%22%20OR%20%22Promises%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "a842faf9f38b722bb647dd161d34b13e46303c2ed2e2441aa97e704fbc687477",
    "registryKey": "national-manifestos-and-promises",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "state:Bureaucrat Transfer & Posting Tracker (State Cadre)",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(IAS%20OR%20IPS%20OR%20bureaucrat%20OR%20%22chief%20secretary%22)%20(transfer%20OR%20transferred%20OR%20posting%20OR%20posted)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "526db0aa272b3154fc16bf50f27e68c1247585374eb5503e22bc81b4333bb167",
    "registryKey": "state-state-cadre-transfers",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "state:Governor Assent Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(governor)%20(assent%20OR%20%22returned%20the%20bill%22%20OR%20%22withheld%20assent%22%20OR%20ordinance)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "0749fe9538ff084b630f2c99f6f301c0804455b8fc389c5a6ccc992e5bbfe327",
    "registryKey": "state-governor-and-assent",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "state:Assembly Proceedings Digest (Vernacular, Translated)",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Vidhan%20Sabha%22%20OR%20%22assembly%20proceedings%22%20OR%20%22legislative%20assembly%22%20OR%20%22assembly%20session%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "4116590b7901bd3bc1a5f35ae2f40919b28893c1abb6120805db0b1727815ce1",
    "registryKey": "state-assembly-proceedings",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "state:MLA Defection & Anti-defection Case Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(MLA%20OR%20MLAs%20OR%20legislator)%20(defection%20OR%20%22anti-defection%22%20OR%20%22Tenth%20Schedule%22%20OR%20%22disqualification%20petition%22%20OR%20disqualified%20OR%20%22switch%20party%22%20OR%20%22joins%20BJP%22%20OR%20%22joins%20Congress%22%20OR%20%22switched%20sides%22%20OR%20defect)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "8a9487b7dad8233950872d96659428637097ea5b1b777d1306ae267db42e7746",
    "registryKey": "state-mla-defection-and-anti-defection",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "state:District Media Monitor (Vernacular District Editions)",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(district%20OR%20collectorate%20OR%20%22district%20magistrate%22%20OR%20%22zilla%20parishad%22)%20(protest%20OR%20land%20OR%20water%20OR%20road%20OR%20school%20OR%20hospital)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "8b69513131c14a910abe5d550715ac8fa9091e58e7cab59390eef2c48fccf891",
    "registryKey": "state-district-media-monitor",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "state:Cabinet Decisions",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(cabinet)%20(decision%20OR%20approves%20OR%20approved%20OR%20%22cabinet%20meeting%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "bdb4ab5d9cbe80d61178b127b990cc419de2d6b29971c99189021015c8cc15cc",
    "registryKey": "state-cabinet-decisions",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "state:CAG Audit Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(CAG%20OR%20%22Comptroller%20and%20Auditor%20General%22)%20(audit%20OR%20report)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "6b720da2dd0d4c34f3bbf5aada48039912f9ca07a6aa4ee09468d5d6b4039681",
    "registryKey": "state-cag-audit-tracker",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "state:Legislative Productivity Comparison",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22assembly%20session%22%20OR%20%22Vidhan%20Sabha%20session%22%20OR%20%22monsoon%20session%22%20OR%20%22winter%20session%22%20OR%20%22budget%20session%22)%20(assembly%20OR%20%22Vidhan%20Sabha%22)%20(sittings%20OR%20adjourned%20OR%20%22sine%20die%22%20OR%20%22bills%20passed%22%20OR%20%22passed%20the%20bill%22%20OR%20walkout%20OR%20%22cut%20short%22%20OR%20curtailed)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "542d02442ce37ba771b927d7231569277e1ee9a84bc507cb00218e3062258527",
    "registryKey": "state-legislative-productivity-comparison",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "state:Governor Friction & President's Rule Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20governor%20(%22state%20government%22%20OR%20%22President's%20Rule%22%20OR%20%22Article%20356%22%20OR%20%22withheld%20assent%22%20OR%20%22governor's%20address%22%20OR%20walkout%20OR%20%22Raj%20Bhavan%22%20OR%20%22Lok%20Bhavan%22%20OR%20%22chief%20minister%22)%20(row%20OR%20clash%20OR%20friction%20OR%20standoff%20OR%20confrontation%20OR%20tussle%20OR%20%22President's%20Rule%22%20OR%20%22Article%20356%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "858044ef18b1d7bd9149f878c428a6be92cba8ef56ac5be47f8cf9f03ba21901",
    "registryKey": "state-governor-friction-and-presidents-rule",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "local:MGNREGA Works & Muster Roll Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22MGNREGA%22%20OR%20%22Works%22%20OR%20%22Muster%22%20OR%20%22Roll%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "2ff6823549b48b2fcdded7537bafb9d4ea3047ddc44ee2b3f12c960e2f310ba1",
    "registryKey": "local-mgnrega-works",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "local:Local Officer Directory + Transfer Tracker (BDO/SDO/EO)",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Local%22%20OR%20%22Officer%22%20OR%20%22Directory%22%20OR%20%22Transfer%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "a77f2558c24625520372496d3d4bf464d993cb23cece85a18f0c5c3fa1d7c4a1",
    "registryKey": "local-local-officer-directory",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "local:Councillor & Pradhan Profiles + Report Cards",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Councillor%22%20OR%20%22Pradhan%22%20OR%20%22Profiles%22%20OR%20%22Report%22%20OR%20%22Cards%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "a8b3f65828bf8762c7c4df994ed1496047b091431458f0549a3a4fc40a432bf0",
    "registryKey": "local-councillor-and-pradhan-cards",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "local:Hyperlocal News Aggregator",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Hyperlocal%22%20OR%20%22News%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "28b1257cc716afa539cc72ce504addf2e5eb2bbdc35a3f20d88990357b36bf5b",
    "registryKey": "local-hyperlocal-news",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "local:Municipal Watch",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Municipal%22%20OR%20%22Watch%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "77eb7bbc7f7eee74c1e6cbb4a854cfd4b86b741f213219fc1b954c3fe03eeedc",
    "registryKey": "local-municipal-watch",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "local:Panchayat Watch",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Panchayat%22%20OR%20%22Watch%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "11c3a9735565bf186dde3d0783f1d0007ed207dff37a6ef3d99d56c0a7e377d1",
    "registryKey": "local-panchayat-watch",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "local:Municipal Finance & Solvency",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Municipal%22%20OR%20%22Finance%22%20OR%20%22Solvency%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "b6eaad19ce0e125c963cd59f076b7aca28239f977e4c607ee28d758cd8a59850",
    "registryKey": "local-municipal-finance",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Supreme Court Order & Judgment Feed",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Supreme%22%20OR%20%22Court%22%20OR%20%22Order%22%20OR%20%22Judgment%22%20OR%20%22Feed%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "9b5d652452c8ce3fe74f8f7ac061d5c78262aa9d2eb987305301fb17299a92c0",
    "registryKey": "law-supreme-court-feed",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Order Archive by Topic (Cross-Court)",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Order%22%20OR%20%22Archive%22%20OR%20%22Topic%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "6e1f460decb67644f54a92ebc202b0a8b7030eec08fc395a3066ac0e006e6c38",
    "registryKey": "law-order-archive",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:District Court Case Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22District%22%20OR%20%22Court%22%20OR%20%22Case%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "8a76216a753887ec4df4baf39f8021777e71d84b035a2af1af54c38d4c734c7e",
    "registryKey": "law-district-court-case-tracker",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:UP High Court (Allahabad) Order Feed",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22High%22%20OR%20%22Court%22%20OR%20%22Order%22%20OR%20%22Feed%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "b4f21a88319fea03a6c5bee74ed6cc33ca27352a96fed840efb094d11c10830f",
    "registryKey": "law-allahabad-hc-feed",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:NGT Environmental Litigation Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22NGT%22%20OR%20%22Environmental%22%20OR%20%22Litigation%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "652761425f9053aa7d4108e8a3239b3e081b8400196d4bf36b293a1207bbee9b",
    "registryKey": "law-ngt-litigation",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:CAT & Consumer Disputes (NCDRC) Watch",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22CAT%22%20OR%20%22Consumer%22%20OR%20%22Disputes%22%20OR%20%22Watch%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "f0d1b657a0f85d606926bfa669b7385904cf9a4abe14500f6b6320bff600d60c",
    "registryKey": "law-cat-and-ncdrc-watch",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:ICC Proceedings",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22ICC%22%20OR%20%22Proceedings%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "f939603b9c0079be3b74cbfa5b7a22c069daa7cdbec9d18eb7fbc5d4742db28d",
    "registryKey": "law-icc-proceedings",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:ICJ Proceedings",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22ICJ%22%20OR%20%22Proceedings%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "3c9b8883a6e67bf28cf9e40e140fbfeb38adf9434415fde976aa1c50c5198732",
    "registryKey": "law-icj-proceedings",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Supreme Courts & precedent — other common-law jurisdictions",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Supreme%22%20OR%20%22Courts%22%20OR%20%22precedent%22%20OR%20%22other%22%20OR%20%22common-law%22%20OR%20%22jurisdictions%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "ad8b52f33f0ebed443dc03dc544cbb41c451db46cc59ae15f35ad2ff2a425cb7",
    "registryKey": "law-commonwealth-courts",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Regional Int'l Courts (ECtHR / CJEU / ITLOS)",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Regional%22%20OR%20%22Int'l%22%20OR%20%22Courts%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "d582cd2f93435140bd6fb8234235d9de1d42e451b0c6e299957e640828d8e5fb",
    "registryKey": "law-regional-courts",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Judge Analytics (Ruling Patterns)",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Judge%22%20OR%20%22Analytics%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "6a4274009600446365f647f0a7aa5d0866fb366b42c4033abe0cecfaa5a2a84a",
    "registryKey": "law-judge-analytics",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Case Pendency & Disposal Analytics",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Case%22%20OR%20%22Pendency%22%20OR%20%22Disposal%22%20OR%20%22Analytics%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "2afad2b0d25728056d344b6346970f0a386ad37e5f53e22f247209e6f815c546",
    "registryKey": "law-pendency-and-disposal",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Precedent / Citation Network",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Precedent%22%20OR%20%22Citation%22%20OR%20%22Network%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "9e8a23c50701d919492102b238a95c936137bf10746be2ca3d01e44dcfa90fbb",
    "registryKey": "law-citation-network",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Constitutional Bench Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Constitutional%22%20OR%20%22Bench%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "0f4bd1c42adf61fdd9d095dc6c3105a6ff10a75fcc8adc30fd91c89bb666aaa8",
    "registryKey": "law-constitution-benches",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Cause-List / Hearing Scheduler",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Cause-List%22%20OR%20%22Hearing%22%20OR%20%22Scheduler%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "aeb0c3c306754b602b50e33eb3bb2fd035347abba545e1d55e4b96ceaaae2e46",
    "registryKey": "law-hearing-scheduler",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:NCLT / NCLAT (Insolvency)",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22NCLT%22%20OR%20%22NCLAT%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "091d4209f120bd92c28ef7308d01985939aac1b2f140dd1a0d085f1d0b96de39",
    "registryKey": "law-insolvency-courts",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Sector Tribunals (ITAT / TDSAT / SAT / DRT)",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Sector%22%20OR%20%22Tribunals%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "a531689eeeaa8428606fced7c4e769003d9328c52d0fadf120ab682ed3b0dde5",
    "registryKey": "law-sector-tribunals",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Professional Case-Law Database",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Professional%22%20OR%20%22Case-Law%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "4c85f9f9e83124e89994961809d4f52ae65b63e3fc37e42c0a8341ad69cfb3a4",
    "registryKey": "law-case-law-library",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:HC Case Status & Cause Lists",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Case%22%20OR%20%22Status%22%20OR%20%22Cause%22%20OR%20%22Lists%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "b443f9e56434cc6305ae757cea94ae2fb10e14649792e33398899c6ebdce138d",
    "registryKey": "law-hc-cause-lists",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:HC Pendency & Disposal Analytics",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Pendency%22%20OR%20%22Disposal%22%20OR%20%22Analytics%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "e0fa3b648c849053ccaa3ee7a0ee99c8622323acc20bad81daf3a1674044c7e2",
    "registryKey": "law-hc-pendency",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:HC Judge Profiles & Bench Analytics",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Judge%22%20OR%20%22Profiles%22%20OR%20%22Bench%22%20OR%20%22Analytics%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "f45154c074fa5cb2bce45b6f582752dd1e0c4b4f10db1c74b6a346e1991b6520",
    "registryKey": "law-hc-bench-analytics",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:HC Constitutional & PIL Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Constitutional%22%20OR%20%22PIL%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "95c81a1505c2d4aa9912c329390bf289a78cebfbc8aaa45d8d4772bd02324bbd",
    "registryKey": "law-hc-pil-tracker",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:HC vs State Government Litigation",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22State%22%20OR%20%22Government%22%20OR%20%22Litigation%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "4a5c79647381ae3ff68045a67bc9f4d5493f11528b6d7f6f9532a73b52f08b57",
    "registryKey": "law-hc-vs-state",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:District Court Cause Lists",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22District%22%20OR%20%22Court%22%20OR%20%22Cause%22%20OR%20%22Lists%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "6b45471e895b41634594067b7165557bfee548576165625f17e6c0582c6d60d1",
    "registryKey": "law-district-court-cause-lists",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:District Court Pendency & Disposal",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22District%22%20OR%20%22Court%22%20OR%20%22Pendency%22%20OR%20%22Disposal%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "1a30e37b60055486ba357d8fda3c252e5085b0ace79f49485cc12ed029256742",
    "registryKey": "law-district-pendency",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Undertrial & Prison Data",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Undertrial%22%20OR%20%22Prison%22%20OR%20%22Data%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "b9562b1f75dc20a92aa5b43547f8a5acf02177cb3d6a130d1370eccd3a5fa47a",
    "registryKey": "law-prisons-and-undertrials",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Legal Aid & Lok Adalat Tracker",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Legal%22%20OR%20%22Aid%22%20OR%20%22Lok%22%20OR%20%22Adalat%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "6acca5153ab20f95e74a41c8cb8debef37ed6199e5dbd08c9c1a76d8acb97f04",
    "registryKey": "law-legal-aid-and-lok-adalats",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "judiciary:Local Judge & Court Directory",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Local%22%20OR%20%22Judge%22%20OR%20%22Court%22%20OR%20%22Directory%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "07e3782789889224db64e8a28c1f535d18f239089bf1ba9aeaebba71f8101007",
    "registryKey": "law-court-directory",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  },
  {
    "id": "climate:Carbon Price Monitor",
    "field": "source",
    "old": "https://news.google.com/rss/search?q=India%20(%22Carbon%22%20OR%20%22Price%22)%20when%3A7d&hl=en-IN&gl=IN&ceid=IN:en",
    "sha256": "0729c1f401e5f3e07f3684bd2744338b425d8e8e57e706f1697d3a83c3d18e20",
    "registryKey": "carbon-carbon-price-monitor",
    "reason": "duplicate; server primary/provenance use identical retained registry fields"
  }
]
```
