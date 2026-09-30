# `Frontend`

![IO Control logo](./public/img/logo.png)

## Getting Started

### Run the frontend locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the Vite dev server:

   ```bash
   npm run dev
   ```

3. Open the app in your browser:

   - http://localhost:5173/

Vite automatically loads `.env.development` when running the local dev server, so you can use it to point the frontend at your device or backend.

### Environment configuration

Create or edit `.env.development` in the project root if you want to override local development values.

Example:

```dotenv
# Optional websocket override for local development.
VITE_WEBSOCKET_URL=ws://{ip-address}/ws

# Optional HTTP proxy target for /api requests.
VITE_PROXY_TARGET=http://{ip-address}
```

### Available scripts

- `npm run dev` - Starts a dev server at http://localhost:5173/

- `npm run build` - Builds for production, emitting to `dist/`

- `npm run preview` - Starts a server at http://localhost:4173/ to test production build locally
