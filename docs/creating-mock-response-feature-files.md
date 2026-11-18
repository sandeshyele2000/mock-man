# Mockman feature JSON format

Save a feature bundle as `<name>.mockman-feature.json` and upload it using
Mockman's **Import feature** control. This reference describes the expected file
structure for any feature. Response payloads are defined by the API being mocked.

## Complete example

```json
{
  "format": "mockman-feature",
  "version": 1,
  "feature": {
    "id": "example-feature",
    "name": "Example feature",
    "endpoints": [
      {
        "id": "example-list",
        "name": "List example items",
        "method": "GET",
        "path": "/api/example/items",
        "enabled": true,
        "responses": [
          {
            "id": "items-success",
            "name": "Items available",
            "status": 200,
            "headers": { "Content-Type": "application/json" },
            "body": { "items": [{ "id": "item-001", "name": "Sample item" }] },
            "delayMs": 0
          }
        ],
        "scenarios": [
          {
            "id": "list-success",
            "name": "List succeeds",
            "revision": "",
            "behavior": "always",
            "count": 0,
            "responseIds": ["items-success"],
            "exhaustion": "repeat",
            "priority": 0,
            "conditions": []
          }
        ],
        "active": { "development": "list-success" }
      }
    ]
  }
}
```

## Structure and fields

| Object | Field | Type / meaning |
| --- | --- | --- |
| Bundle | `format` | Must be `"mockman-feature"`. |
| Bundle | `version` | Must be numeric `1`. |
| Bundle | `feature` | One feature object. |
| Feature | `id`, `name` | Identifier and display name. |
| Feature | `endpoints` | Array of endpoint objects. |
| Endpoint | `id`, `name` | Identifier and display name. |
| Endpoint | `method` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, or `OPTIONS`. |
| Endpoint | `path` | Exact absolute pathname, including any base-URL path prefix; no host, query string, or fragment. |
| Endpoint | `enabled` | Boolean; use `true` to enable matching. |
| Endpoint | `responses` | Array of saved response objects. |
| Endpoint | `scenarios` | Array of scenario objects. |
| Endpoint | `active` | Object mapping environment names to scenario IDs. |
| Response | `id`, `name` | Identifier and display name. |
| Response | `status` | Integer HTTP status, 200–599. |
| Response | `headers` | Object mapping header names to string values. |
| Response | `body` | Any JSON value. Use an object directly for an object payload, not a stringified object. |
| Response | `delayMs` | Integer delay, 0–30000 milliseconds. |
| Scenario | `id`, `name` | Identifier and display name. |
| Scenario | `revision` | String; use `""` in a new import file. |
| Scenario | `behavior` | One of the behaviors below. |
| Scenario | `count` | Integer 0–1000000 for simple/JavaScript behaviors; used by `failFirst` and `failAfter`. Use `0` otherwise. |
| Scenario | `responseIds` | Array of response IDs belonging to this endpoint. |
| Scenario | `exhaustion` | `"repeat"` or `"loop"`; determines sequence behavior. Use `"repeat"` otherwise. |
| Scenario | `priority` | Integer from -1000000 to 1000000; higher values take precedence for conditional matching. |
| Scenario | `conditions` | Array of conditions; use `[]` for unconditional selection. |
| Scenario | `code` | JavaScript source string; only for `javascript` behavior. |
| Scenario | `flow` | Flow graph object; required for `flow` behavior. |

The `body` in the example is arbitrary sample API data. Mockman does not require
an `items`, `success`, `data`, or `payload` envelope: use the shape your API returns.

## Scenario behaviors

| `behavior` | Required configuration / behavior |
| --- | --- |
| `always` | Exactly one response ID; returns it every time. |
| `failFirst` | Exactly two response IDs ordered `[failure, success]`; first `count` attempts fail, then succeed. |
| `failAfter` | Exactly two response IDs ordered `[failure, success]`; first `count` attempts succeed, then fail. |
| `sequence` | 1–100 response IDs in order. `repeat` holds the final response; `loop` starts again. |
| `javascript` | Nonempty `code` up to 32 KiB and 1–100 allowed response IDs. Return `{ responseId: "saved-response-id" }` or `{ response: { status: 200, headers: {}, body: {}, delayMs: 0 } }`. |
| `flow` | A `flow` graph as described below; `responseIds` can be `[]` (maximum 100). |

JavaScript runs in Goja with `input`, `request`, `responses`, `attempt`, `session`,
`environment`, Lodash (`_`), and Moment (`moment`). It has no Node APIs and a
50 ms execution limit. Response ID literals in ordinary single/double quotes
are rewritten during import; dynamically constructed IDs and backtick literals
are not reliably remapped.

## Condition structure

```json
{
  "source": "query",
  "key": "page",
  "value": "2"
}
```

- `source`: `query`, `header`, or `body`.
- `key`: query parameter name, header name, or dotted JSON object path.
- `value`: string compared exactly against the request value.
- All conditions in a scenario must match. Header names are case-insensitive.
- Non-string JSON body values are compared using their JSON representation.
- A scenario can have at most 20 conditions, with unique source/key pairs.
- Mockman parses JSON request bodies; it does not decrypt encrypted payloads.

Selection order: explicit `X-Mock-Scenario` override, matching conditional
scenarios ordered by descending priority, then the environment's active scenario.
Overrides and active scenarios must still satisfy their conditions. Overlapping
conditional scenarios must have different priorities.

## Optional flow graph structure

Put this object in a scenario's `flow` field and set `behavior` to `"flow"`.
The response ID must exist in the endpoint's `responses` array.

```json
{
  "startNodeId": "start",
  "nodes": [
    { "id": "start", "type": "start", "x": 0, "y": 0 },
    { "id": "reply", "type": "response", "x": 200, "y": 0, "responseId": "items-success" },
    { "id": "end", "type": "end", "x": 400, "y": 0 }
  ],
  "connections": [
    { "id": "start-reply", "source": "start", "target": "reply" },
    { "id": "reply-end", "source": "reply", "target": "end" }
  ]
}
```

Node types are `start`, `response`, `javascript`, and `end`. Exactly one node must
be `start`, and `startNodeId` must reference it. JavaScript nodes add `code` and
`outputs` (1–16 unique output names). Connections from JavaScript nodes specify a
`sourcePort` matching a declared output. Start/response nodes have at most one
outgoing connection; start must have one. End nodes have none. A graph supports
1–200 nodes and at most 400 connections.

A response node emits one HTTP response and saves the next node for the following
request. An end node repeats the last saved response. Flow/attempt state is scoped
to project, environment, endpoint, scenario revision, and session; endpoints do
not share arbitrary state.

## Validation and import rules

- IDs must match `[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`; names are at most 160 characters.
- Feature IDs and endpoint IDs are unique within a project. Method/path pairs
  are unique within each feature; different features may share routes.
  Response/scenario IDs are unique per endpoint.
- All response, scenario, and graph references must resolve.
- Provide arrays/objects for `endpoints`, `responses`, `scenarios`, `conditions`,
  `headers`, and `active`, including empty ones where appropriate; do not use `null`.
- Each endpoint supports at most 100 responses and 100 scenarios.
- Paths match exactly, including trailing slashes; route parameters/wildcards
  are not expanded. Use query conditions instead of adding a query to `path`.
- Do not set transport-managed response headers such as `Content-Length`.
- Imports append a feature and regenerate its IDs and referenced IDs. Routes may
  overlap existing features. Use the imported feature's new ID in `X-Mock-Feature`
  to distinguish shared routes; the dashboard's Try request sets it automatically.
- `active` entries for environments absent from the target project are dropped.
  Choose an active scenario for each target environment after importing.
- This wrapper is for dashboard feature import, not `PUT /api/config`, which
  expects a full workspace configuration.

Check JSON syntax before upload:

```sh
python3 -m json.tool example.mockman-feature.json > /dev/null
```

The server validates configuration rules when the import is saved. Syntax
validation alone does not establish import compatibility.

## Source references

- [Feature import/export](../frontend/src/App.tsx): `exportFeature` / `importFeature`.
- [JSON models and scenario selection](../backend/internal/engine/engine.go).
- [Validation rules](../backend/internal/engine/validate.go).
- [JavaScript runtime](../backend/internal/engine/javascript.go).
- [Flow runtime](../backend/internal/engine/flow.go).
- [OpenAPI schema](../backend/api/openapi.yaml).
