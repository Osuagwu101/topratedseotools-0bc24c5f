# ChatGPT Phase 4 transport boundary

Phase 4 builds the fixed-host transport layer behind the Phase 3 entitlement/ticket gateway.

It deliberately does **not** load, store, decrypt, replay, rotate, or request any ChatGPT/OpenAI browser session. The live gateway still stops with the controlled `missing_chatgpt_session_source` state until Phase 5 supplies an authorised account-specific adapter.

This layer provides:

- exact gateway-origin enforcement;
- fixed upstream origin mapping to `https://chatgpt.com`;
- strict allowlisting for required static asset hosts;
- restricted account/login/settings/billing document routes;
- request method and request-size policy;
- upstream request-header allowlisting;
- response-header scrubbing;
- internal redirect confinement;
- HTML/JSON/CSS URL rewriting helpers;
- streaming/body-mode classification;
- explicit WebSocket upgrade classification without opening an upstream socket.

No credential or anti-bot bypass logic belongs in Phase 4.
