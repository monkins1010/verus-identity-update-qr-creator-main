import { Request, Response } from "express";
import * as QRCode from "qrcode";
import { BN } from "bn.js";
import {
  DataPacketRequestDetails,
  DataPacketRequestOrdinalVDXFObject,
  DataDescriptor,
  CompactIAddressObject,
  VerifiableSignatureData,
  URLRef,
  VdxfUniValue,
  CrossChainDataRefKey
} from "verus-typescript-primitives";
import { primitives, VerusIdInterface } from "verusid-ts-client";
import {
  ValidationError,
  RedirectInput,
  requireString,
  parseJsonField,
  buildGenericRequestFromDetails,
  signRequest,
  getRpcConfig,
  SYSTEM_ID_TESTNET
} from "../utils";

type GenerateDataPacketQrPayload = {
  signingId?: string;
  flagHasRequestId?: boolean;
  flagHasStatements?: boolean;
  flagHasSignature?: boolean;
  flagForUsersSignature?: boolean;
  flagForTransmittalToUser?: boolean;
  flagHasUrlForDownload?: boolean;
  signableObjects?: unknown;
  statements?: unknown;
  requestId?: string;
  redirects?: unknown;
  downloadUrl?: string;
  dataHash?: string;
};

function parseOptionalIAddress(value: unknown, fieldName: string): CompactIAddressObject | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  const cleaned = trimmed.endsWith("@") ? trimmed.slice(0, -1) : trimmed;
  if (!cleaned) return undefined;
  return CompactIAddressObject.fromAddress(cleaned);
}

function buildFlags(payload: GenerateDataPacketQrPayload): InstanceType<typeof BN> {
  let flags = new BN(0);
  
  if (payload.flagHasRequestId) {
    flags = flags.or(DataPacketRequestDetails.HAS_REQUEST_ID);
  }
  if (payload.flagHasStatements) {
    flags = flags.or(DataPacketRequestDetails.HAS_STATEMENTS);
  }
  if (payload.flagHasSignature) {
    flags = flags.or(DataPacketRequestDetails.HAS_SIGNATURE);
  }
  if (payload.flagForUsersSignature) {
    flags = flags.or(DataPacketRequestDetails.FOR_USERS_SIGNATURE);
  }
  if (payload.flagForTransmittalToUser) {
    flags = flags.or(DataPacketRequestDetails.FOR_TRANSMITTAL_TO_USER);
  }
  if (payload.flagHasUrlForDownload) {
    flags = flags.or(DataPacketRequestDetails.HAS_URL_FOR_DOWNLOAD);
  }
  
  return flags;
}

function parseSignableObjects(value: unknown): DataDescriptor[] {
  if (value == null || value === "" || value === "[]") {
    return [];
  }
  
  let parsed: unknown[];
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new ValidationError(`Invalid JSON for signableObjects: ${message}`);
    }
  } else if (Array.isArray(value)) {
    parsed = value;
  } else {
    throw new ValidationError("signableObjects must be a JSON array.");
  }
  
  if (!Array.isArray(parsed)) {
    throw new ValidationError("signableObjects must be a JSON array.");
  }
  
  return parsed.map((obj, index) => {
    try {
      const objAny = obj as Record<string, unknown>;
      // Ensure version is BN and flags are set properly
      const objWithVersion = {
        ...objAny,
        version: objAny.version != null ? new BN(objAny.version as number) : new BN(1),
        flags: objAny.flags != null ? new BN(objAny.flags as number) : new BN(0)
      };
      return DataDescriptor.fromJson(objWithVersion);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid object";
      throw new ValidationError(`Invalid DataDescriptor at index ${index}: ${message}`);
    }
  });
}

function parseStatements(value: unknown): string[] | undefined {
  if (value == null || value === "" || value === "[]") {
    return undefined;
  }
  
  let parsed: unknown[];
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new ValidationError(`Invalid JSON for statements: ${message}`);
    }
  } else if (Array.isArray(value)) {
    parsed = value;
  } else {
    throw new ValidationError("statements must be a JSON array of strings.");
  }
  
  if (!Array.isArray(parsed)) {
    throw new ValidationError("statements must be a JSON array of strings.");
  }
  
  const statements = parsed.map((item, index) => {
    if (typeof item !== "string") {
      throw new ValidationError(`Statement at index ${index} must be a string.`);
    }
    return item;
  });
  
  return statements.length > 0 ? statements : undefined;
}

function validateDataHash(dataHash: string | undefined): Buffer | undefined {
  if (!dataHash) return undefined;
  const trimmed = dataHash.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new ValidationError("Data hash must be exactly 32 bytes (64 hex characters).");
  }
  return Buffer.from(trimmed, 'hex');
}

function buildUrlDataDescriptor(url: string, dataHash?: string): DataDescriptor {
  // Validate and convert dataHash to Buffer if provided
  const dataHashBuffer = validateDataHash(dataHash);
  
  // Create URLRef with version 1, URL, and optional datahash
  const urlRefParams: Record<string, unknown> = { version: new BN(1), url: url };
  if (dataHashBuffer) {
    urlRefParams.datahash = dataHashBuffer;
  }
  const urlRef = new URLRef(urlRefParams as any);
  
  // Create a map with the CrossChainDataRefKey pointing to the URLRef
  const urlRefMap: Array<{[key: string]: any}> = [];
  urlRefMap.push({ [CrossChainDataRefKey.vdxfid]: urlRef });
  
  // Create VdxfUniValue from the map
  const urlRefUniValue = new VdxfUniValue({ values: urlRefMap });
  
  // Create DataDescriptor with the serialized VdxfUniValue
  const urlDescriptor = DataDescriptor.fromJson({
    version: 1,
    objectdata: urlRefUniValue.toBuffer().toString('hex')
  });
  
  return urlDescriptor;
}

function buildDataPacketRequest(params: {
  signingId: string;
  flags: InstanceType<typeof BN>;
  signableObjects: DataDescriptor[];
  statements?: string[];
  requestId?: CompactIAddressObject;
  redirects?: RedirectInput[];
}): primitives.GenericRequest {
  const detailsParams: Record<string, unknown> = {
    version: new BN(1),
    flags: params.flags,
    signableObjects: params.signableObjects
  };
  
  if (params.statements && params.statements.length > 0) {
    detailsParams.statements = params.statements;
  }
  if (params.requestId) {
    detailsParams.requestID = params.requestId;
  }

  const details = new DataPacketRequestDetails(detailsParams as any);

  return buildGenericRequestFromDetails({
    details: [new DataPacketRequestOrdinalVDXFObject({ data: details })],
    signed: true,
    signingId: params.signingId,
    redirects: params.redirects
  });
}

export async function generateDataPacketQr(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as GenerateDataPacketQrPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword } = getRpcConfig();
    const signingId = requireString(payload.signingId, "signingId");
    
    // Validate mutual exclusivity of signature flags
    if (payload.flagHasSignature && payload.flagForUsersSignature) {
      throw new ValidationError("'Has Signature' and 'For User's Signature' are mutually exclusive.");
    }
    
    const flags = buildFlags(payload);
    let signableObjects: DataDescriptor[] = [];
    const statements = parseStatements(payload.statements);
    const requestId = parseOptionalIAddress(payload.requestId, "requestId");

    // When flagHasUrlForDownload is set, signableObjects is ONLY the URL DataDescriptor
    if (payload.flagHasUrlForDownload) {
      const downloadUrl = typeof payload.downloadUrl === "string" ? payload.downloadUrl.trim() : "";
      if (!downloadUrl) {
        throw new ValidationError("Download URL is required when FLAG_HAS_URL_FOR_DOWNLOAD is set.");
      }
      const dataHash = typeof payload.dataHash === "string" ? payload.dataHash.trim() : undefined;
      const urlDescriptor = buildUrlDataDescriptor(downloadUrl, dataHash);
      signableObjects = [urlDescriptor];
    } else {
      signableObjects = parseSignableObjects(payload.signableObjects);
    }

    const redirects = parseJsonField<RedirectInput[]>(
      payload.redirects,
      "redirects",
      true
    );

    if (!Array.isArray(redirects) || redirects.length === 0) {
      throw new ValidationError("redirects must be a non-empty JSON array.");
    }

    // Validate flag consistency
    if (payload.flagHasStatements && (!statements || statements.length === 0)) {
      throw new ValidationError("Statements are required when FLAG_HAS_STATEMENTS is set.");
    }
    if (payload.flagHasRequestId && !requestId) {
      throw new ValidationError("Request ID is required when FLAG_HAS_REQUEST_ID is set.");
    }

    const reqToSign = buildDataPacketRequest({
      signingId,
      flags,
      signableObjects,
      statements,
      requestId,
      redirects
    });

    await signRequest({
      request: reqToSign,
      rpcHost,
      rpcPort,
      rpcUser,
      rpcPassword,
      signingId
    });

    const deeplink = reqToSign.toWalletDeeplinkUri();
    const qrDataUrl = await QRCode.toDataURL(deeplink, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6
    });

    res.json({ deeplink, qrDataUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = error instanceof ValidationError ? 400 : 500;
    if (status === 500) {
      console.error("Data Packet QR generation failed:", error);
    }
    res.status(status).json({ error: message });
  }
}

type SignDataPacketPayload = {
  signingId?: string;
  flagHasRequestId?: boolean;
  flagHasStatements?: boolean;
  flagHasSignature?: boolean;
  flagForUsersSignature?: boolean;
  flagForTransmittalToUser?: boolean;
  flagHasUrlForDownload?: boolean;
  signableObjects?: unknown;
  statements?: unknown;
  requestId?: string;
  downloadUrl?: string;
  dataHash?: string;
};

export async function signDataPacket(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body as SignDataPacketPayload;
    const { rpcHost, rpcPort, rpcUser, rpcPassword } = getRpcConfig();
    const signingId = requireString(payload.signingId, "signingId");
    
    // Validate mutual exclusivity of signature flags
    if (payload.flagHasSignature && payload.flagForUsersSignature) {
      throw new ValidationError("'Has Signature' and 'For User's Signature' are mutually exclusive.");
    }
    
    const flags = buildFlags(payload);
    let signableObjects: DataDescriptor[] = [];
    const statements = parseStatements(payload.statements);
    const requestId = parseOptionalIAddress(payload.requestId, "requestId");

    // When flagHasUrlForDownload is set, signableObjects is ONLY the URL DataDescriptor
    if (payload.flagHasUrlForDownload) {
      const downloadUrl = typeof payload.downloadUrl === "string" ? payload.downloadUrl.trim() : "";
      if (!downloadUrl) {
        throw new ValidationError("Download URL is required when FLAG_HAS_URL_FOR_DOWNLOAD is set.");
      }
      const dataHash = typeof payload.dataHash === "string" ? payload.dataHash.trim() : undefined;
      const urlDescriptor = buildUrlDataDescriptor(downloadUrl, dataHash);
      signableObjects = [urlDescriptor];
    } else {
      signableObjects = parseSignableObjects(payload.signableObjects);
    }

    // Build the DataPacketRequestDetails
    const detailsParams: Record<string, unknown> = {
      version: new BN(1),
      flags: flags,
      signableObjects: signableObjects
    };
    
    if (statements && statements.length > 0) {
      detailsParams.statements = statements;
    }
    if (requestId) {
      detailsParams.requestID = requestId;
    }

    const details = new DataPacketRequestDetails(detailsParams as any);
    
    // Get the hex of the DataPacketRequestDetails buffer
    const messageHex = details.toBuffer().toString("hex");

    // Call signdata RPC
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

    const sigRes = await verusId.interface.request({
      cmd: "signdata",
      getParams: () => [{
        address: signingId,
        messagehex: messageHex
      }]
    } as any);

    if (sigRes.error) {
      throw new Error(sigRes.error.message || "RPC signdata failed.");
    }

    const result = sigRes.result as Record<string, unknown>;
    if (!result || typeof result.signature !== "string") {
      throw new Error("RPC signdata returned no valid signature.");
    }

    // Convert to VerifiableSignatureData using fromCLIJson
    const verifiableSignature = VerifiableSignatureData.fromCLIJson(result as any);
    const signatureJson = verifiableSignature.toJson();

    res.json({
      signatureData: signatureJson,
      messageHex: messageHex
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = error instanceof ValidationError ? 400 : 500;
    if (status === 500) {
      console.error("Data Packet signing failed:", error);
    }
    res.status(status).json({ error: message });
  }
}
