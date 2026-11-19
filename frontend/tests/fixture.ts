import type { Config } from "../src/api";

export const fixture: Config = {
  version: 1,
  projects: [
    {
      id: "demo",
      name: "Demo application",
      environments: ["development", "staging"],
      features: [
        {
          id: "agreements",
          name: "Agreements",
          endpoints: [
            {
              id: "accept",
              name: "Accept agreement",
              method: "POST",
              path: "/v1/agreements/acceptances",
              enabled: true,
              responses: [
                {
                  id: "success",
                  name: "Agreement accepted",
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                  body: { success: true },
                  delayMs: 200,
                },
                {
                  id: "failure",
                  name: "Temporary failure",
                  status: 503,
                  headers: { "Content-Type": "application/json" },
                  body: { error: "Please try again" },
                  delayMs: 500,
                },
              ],
              scenarios: [
                {
                  id: "always",
                  name: "Always accept",
                  revision: "1",
                  behavior: "always",
                  count: 0,
                  responseIds: ["success"],
                  exhaustion: "repeat",
                  priority: 0,
                  conditions: [],
                },
              ],
              active: { development: "always", staging: "always" },
            },
          ],
        },
      ],
    },
  ],
};
