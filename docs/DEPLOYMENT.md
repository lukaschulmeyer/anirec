# Running and deploying AniRec

## Local configuration

Use Node.js 24. Copy `.env.example` to `.env`, then set your own `MAL_CLIENT_ID`. The server reads it at runtime. Keep the file out of version control and never prefix the variable with `VITE_`, which would expose it to the browser build.

`npm run dev` runs the API and frontend together. `npm run build` followed by `npm start` serves built assets. The default address is `127.0.0.1:4317`; `HOST` and `PORT` can be set for other local environments. Use `HOST=0.0.0.0` only when you intend to accept network connections.

## Vercel package

1. Run `npm ci`, `npm run check`, and `npm test`.
2. Run `npm run deploy:prepare`. Note the generated `deployment/<timestamp>` path printed at completion.
3. In your Vercel project, add `MAL_CLIENT_ID` as a private environment variable for the environments you intend to use.
4. Deploy the generated directory with the Vercel CLI, linking it to your chosen project. Start with a preview deployment; verify it before promoting to production.

For example, from the generated directory:

```sh
vercel
```

For a verified release:

```sh
vercel --prod
```

The generated configuration preserves `/api/*`, `/recs`, `/privacy`, `/terms`, and the informational `/auth/mal/callback` route. The callback does not implement OAuth or account linking. The package bundles its API dependencies, sets a 30-second function limit, and supplies security headers. It contains no project ID, organization ID, Client ID, or linked account settings.

The root repository is source code; deploy the prepared package rather than relying on automatic framework detection at the root. CI verifies package creation and does not publish deployments or require secrets.

## Verify the deployed result

- Open the homepage, a shared `/recs?picks=mal%3A1&type=both` URL, privacy, and terms directly.
- Search, select more than one show, open details, change formats and title language, and load another batch when available.
- Confirm a final short batch removes Load more rather than adding unrelated titles.
- Confirm `/api/status` reports configuration without revealing a credential. A configured status alone does not establish a successful upstream request; complete a real search too.
- Inspect desktop and mobile layouts, keyboard focus and popup dismissal.

The checked-in privacy and terms pages describe the original public AniRec deployment. If hosting your own copy, update the operator, domain, contact details, and stated data practices to match your deployment.
