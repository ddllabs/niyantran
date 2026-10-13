# Web-search probe fixtures

> **Status:** Historical (dated 2026-10-13). Test fixtures.

`probe1-*.json` are OpenRouter responses captured 2026-10-13 by the web-search probe of research-chat's research-call shape (`openrouter:web_search` server tool, engine exa, max_uses 3). They are parsed fields, not raw SSE bytes. Page excerpts (`url_citation.content`) are trimmed to 300 characters and `content` to 400; `usage` is unchanged.

| Model | Provider | Web searches | `usage.cost` (USD) | `cost_details.upstream_inference_cost` |
|---|---|---|---|---|
| google/gemini-3.8-flash | Google | 1 | 0.0156745 | 0.0086745 |
| deepseek/deepseek-v4-flash | StreamLake | 1 | 0.000111111 | 0.000111111 |
| anthropic/claude-sonnet-5 | Claude Platform on AWS | 2 | 0.0522001 | 0.0382001 |
| openai/gpt-6-astra | OpenAI | 3 | 0.13307049999999998 | 0.1120705 |
