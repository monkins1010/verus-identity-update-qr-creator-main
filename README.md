# Verus Request QR Creator

A web-based tool for generating QR codes and deeplinks for various Verus Mobile wallet requests.

## Overview

This project provides a web UI to create signed requests that can be scanned or clicked by Verus Mobile users. Supported request types include:

- **Identity Update** - Update VerusID identity data
- **Authentication** - Request user authentication/login
- **Invoice** - Generate payment invoices
- **App Encryption** - Create encrypted data requests
- **Data Packet** - Request signed data packets with optional URL downloads
- **User Data** - Request user data

Each request is encoded as a deeplink URI and displayed as a scannable QR code.

## Prerequisites

- A running Verus testnet daemon (verusd) with RPC access
- A VerusID in your wallet to sign requests
- Node.js and Yarn

## Configuration

Edit `config.js` to configure RPC settings:

```javascript
RPC_HOST: "127.0.0.1",
RPC_PORT: 18843,
RPC_USER: "your-rpc-user",
RPC_PASSWORD: "your-rpc-password",
```

## Usage

Build and start the web server:

```bash
yarn ui
```

This will start the server (default port 3000). Open your browser to `http://localhost:3000` to access the UI.

### Available Tabs

- **Update Identity** - Configure identity changes and generate update requests
- **Authentication** - Create authentication challenge requests
- **Invoice** - Generate payment invoice QR codes
- **App Encryption** - Create app encryption requests
- **Data Packet** - Build data packet requests with flags for signatures, statements, URL downloads, and data hashes
- **User Data** - Request specific user data

### Common Features

- **Signing Identity** - Select from available VerusIDs in your wallet (global dropdown)
- **Redirects** - Configure redirect or POST callback URIs for wallet responses
- **QR Code** - Generated QR codes can be scanned by Verus Mobile
- **Deeplink** - Copy the deeplink URI directly

## How It Works

1. Select a request type tab and fill in the required fields
2. The tool constructs the appropriate request details object
3. The request is wrapped in a `GenericRequest` with optional response URIs
4. The request is signed using the specified signing identity via the Verus daemon
5. The signed request is encoded as a wallet deeplink URI
6. The URI is displayed as a QR code for Verus Mobile to scan

## CLI Mode

For command-line usage (identity update only):

```bash
yarn build
yarn main
```

This uses the settings in `config.js` to generate a QR code in the terminal.

## License

MIT
