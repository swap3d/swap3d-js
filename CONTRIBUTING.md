# Contributing

Install dependencies and run the complete validation suite:

```shell
npm ci
npm test
npm pack --dry-run
```

Public API changes must match a published version of
`swap3d/swap3d-openapi`. Preserve runtime support for Node.js 18 and modern
Fetch-compatible environments.

Never add credentials, private model files, or real user data to tests.
