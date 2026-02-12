import * as path from "path";
import express = require("express");
import { VerusIdInterface } from "verusid-ts-client";
import { generateQr, generateAuthQr, generateInvoiceQr, generateAppEncryptionQr, generateDataPacketQr, signDataPacket } from "./routes";
import {
  SYSTEM_ID_TESTNET,
  requireString,
  parseNumber
} from "./routes/utils";

const {
  RPC_HOST,
  RPC_PORT,
  RPC_USER,
  RPC_PASSWORD
} = require("../config.js");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, "..", "views"));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.resolve(__dirname, "..", "public")));

app.get("/", (_req, res) => {
  res.render("index");
});

app.get("/api/identities", async (_req, res) => {
  try {
    const rpcHost = typeof RPC_HOST === "string" && RPC_HOST.trim().length > 0
      ? RPC_HOST.trim()
      : "localhost";
    const rpcPort = parseNumber(RPC_PORT, "RPC_PORT", 18843);
    const rpcUser = requireString(RPC_USER, "RPC_USER");
    const rpcPassword = requireString(RPC_PASSWORD, "RPC_PASSWORD");

    const verusId = new VerusIdInterface(
      SYSTEM_ID_TESTNET,
      `http://${rpcHost}:${rpcPort}`,
      {
        auth: {
          username: rpcUser,
          password: rpcPassword
        }
      }
    );

    const rpcResult = await verusId.interface.request({
      getParams: () => [],
      cmd: "listidentities"
    } as any);

    if (rpcResult.error || !Array.isArray(rpcResult.result)) {
      res.json({ identities: [] });
      return;
    }

    const identities = rpcResult.result
      .filter((entry: any) => entry?.identity?.name && entry?.identity?.identityaddress)
      .map((entry: any) => ({
        name: entry.identity.name,
        iAddress: entry.identity.identityaddress
      }));

    res.json({ identities });
  } catch (error) {
    console.error("Failed to list identities:", error);
    res.json({ identities: [] });
  }
});

app.get("/api/currencies", async (_req, res) => {
  try {
    const rpcHost = typeof RPC_HOST === "string" && RPC_HOST.trim().length > 0
      ? RPC_HOST.trim()
      : "localhost";
    const rpcPort = parseNumber(RPC_PORT, "RPC_PORT", 18843);
    const rpcUser = requireString(RPC_USER, "RPC_USER");
    const rpcPassword = requireString(RPC_PASSWORD, "RPC_PASSWORD");

    const verusId = new VerusIdInterface(
      SYSTEM_ID_TESTNET,
      `http://${rpcHost}:${rpcPort}`,
      {
        auth: {
          username: rpcUser,
          password: rpcPassword
        }
      }
    );

    const queries: Array<{
      launchstate: "complete" | "launched" | "prelaunch";
      systemtype?: "local" | "pbaas" | "imported" | "gateway";
    }> = [
      { launchstate: "complete" },
      { launchstate: "launched" },
      { launchstate: "prelaunch" },
      { launchstate: "complete", systemtype: "local" },
      { launchstate: "complete", systemtype: "pbaas" },
      { launchstate: "complete", systemtype: "imported" },
      { launchstate: "complete", systemtype: "gateway" },
      { launchstate: "launched", systemtype: "local" },
      { launchstate: "launched", systemtype: "pbaas" },
      { launchstate: "launched", systemtype: "imported" },
      { launchstate: "launched", systemtype: "gateway" },
      { launchstate: "prelaunch", systemtype: "local" },
      { launchstate: "prelaunch", systemtype: "pbaas" },
      { launchstate: "prelaunch", systemtype: "imported" },
      { launchstate: "prelaunch", systemtype: "gateway" }
    ] as const;

    const results = await Promise.all(
      queries.map((query) => verusId.interface.listCurrencies(query))
    );

    const combined = results.flatMap((result, index) => {
      const list = Array.isArray(result.result) ? result.result : [];
      const meta = queries[index];
      return list.map((entry: any) => ({
        entry,
        launchstate: meta.launchstate,
        systemtype: meta.systemtype
      }));
    });

    const seen = new Set<string>();
    const chainCurrencies = combined
      .filter(({ entry }) => entry?.currencydefinition?.currencyid)
      .filter(({ entry }) => {
        const id = entry.currencydefinition.currencyid;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map(({ entry, launchstate, systemtype }) => ({
        currencyId: entry.currencydefinition.currencyid,
        name: entry.currencydefinition.name,
        fullyQualifiedName: entry.currencydefinition.fullyqualifiedname,
        launchstate,
        systemtype,
        hasBalance: false
      }));

    // Pull wallet-held currencies to ensure balances appear in the list.
    const walletAddressGroups = await verusId.interface.request({
      cmd: "listaddressgroupings",
      getParams: () => []
    } as any);
    const addressGroups = Array.isArray(walletAddressGroups.result)
      ? walletAddressGroups.result
      : [];
    const walletAddresses = new Set<string>();
    addressGroups.forEach((group: any[]) => {
      if (!Array.isArray(group)) return;
      group.forEach((entry: any[]) => {
        if (Array.isArray(entry) && typeof entry[0] === "string") {
          walletAddresses.add(entry[0]);
        }
      });
    });

    let walletCurrencies: Array<{
      currencyId: string;
      name: string;
      hasBalance: boolean;
    }> = [];
    if (walletAddresses.size > 0) {
      const walletBalances = await verusId.interface.getAddressBalance({
        addresses: Array.from(walletAddresses),
        friendlynames: true
      });
      const currencyBalance = walletBalances.result?.currencybalance ?? {};
      const currencyNames = walletBalances.result?.currencynames ?? {};

      walletCurrencies = Object.keys(currencyBalance).map((currencyId) => ({
        currencyId,
        name: currencyNames[currencyId] || currencyId,
        hasBalance: true
      }));
    }

    const byId = new Map<string, any>();
    chainCurrencies.forEach((currency) => {
      byId.set(currency.currencyId, currency);
    });
    walletCurrencies.forEach((currency) => {
      const existing = byId.get(currency.currencyId);
      if (existing) {
        existing.hasBalance = true;
        if (!existing.name && currency.name) {
          existing.name = currency.name;
        }
      } else {
        byId.set(currency.currencyId, {
          currencyId: currency.currencyId,
          name: currency.name,
          fullyQualifiedName: undefined,
          launchstate: undefined,
          systemtype: undefined,
          hasBalance: true
        });
      }
    });

    const currencies = Array.from(byId.values())
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ currencies });
  } catch (error) {
    console.error("Failed to list currencies:", error);
    res.json({ currencies: [] });
  }
});

app.post("/api/generate-qr", generateQr);
app.post("/api/generate-auth-qr", generateAuthQr);
app.post("/api/generate-invoice-qr", generateInvoiceQr);
app.post("/api/generate-app-encryption-qr", generateAppEncryptionQr);
app.post("/api/generate-data-packet-qr", generateDataPacketQr);
app.post("/api/sign-data-packet", signDataPacket);

const portEnv = process.env.UI_PORT ?? process.env.PORT;
const port = portEnv ? parseNumber(portEnv, "UI_PORT") : 3000;

app.listen(port, () => {
  console.log(`Local UI server running at http://localhost:${port}`);
});

