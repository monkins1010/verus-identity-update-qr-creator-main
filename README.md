# Verus Identity Update QR Creator

A tool for generating QR codes and deeplinks that trigger `updateidentity` calls in Verus Mobile wallets.

## Overview

This project creates signed requests that can be scanned or clicked by Verus Mobile users to update their VerusID identity data. The request is encoded as a deeplink URI and displayed as a QR code in the terminal.

## Prerequisites

- A running Verus testnet daemon (verusd) with RPC access
- A VerusID in your wallet to sign the request
- Node.js and Yarn

## Configuration

Edit `config.js` to configure your request:

### RPC Settings

```javascript
RPC_PORT: 18843,
RPC_USER: "your-rpc-user",
RPC_PASSWORD: "your-rpc-password",
```

### Identity Changes

Define the changes you want to make to the identity in `JSON_IDENTITY_CHANGES`. This is the same format you would pass to `jsonidentity` when calling `updateidentity` via the CLI:

```javascript
JSON_IDENTITY_CHANGES: {
  "name": "player7",
  "contentmultimap": {
    // Your VDXF key mappings here
  },
},
```

### Request ID

A unique identifier for the request:

```javascript
REQUEST_ID: "iJitWFN8PY37GrBVtF38HyftG8WohWipbL",
```

### Signing Identity

The VerusID from your running wallet that will sign the request:

```javascript
SIGNING_ID: "i89UVSuN6vfWg1mWpXMuc6dsJBdeYTi7bX",
```

### Redirect URIs

Configure how the wallet responds after processing the request:

```javascript
REDIRECTS: [
  // Type 1: Redirect - appends response as URL parameter
  {
    type: "1",
    uri: "https://www.verus.io"
  },
  // Type 2: POST - sends response data via POST request
  {
    type: "2",
    uri: "https://example.com/callback/post-7c3b2f"
  }
]
```

**Important:** When both redirect types are specified, **Type 2 (POST) always takes precedence over Type 1 (Redirect)** when the wallet processes the QR code or deeplink. The wallet will send the response data to the POST endpoint first.

## Usage

Build the TypeScript code:

```bash
yarn build
```

Run the tool to generate the QR code and deeplink:

```bash
yarn main
```

The tool will:
1. Connect to your local Verus daemon
2. Create a signed identity update request
3. Display a QR code in the terminal
4. Print the deeplink URI to the console

## How It Works

1. The tool constructs an `IdentityUpdateRequestDetails` object from your configuration
2. It wraps this in a `GenericRequest` with optional response URIs
3. The request is signed using the specified signing identity via the Verus daemon
4. The signed request is encoded as a wallet deeplink URI
5. The URI is displayed as a QR code for Verus Mobile to scan

## License

MIT
