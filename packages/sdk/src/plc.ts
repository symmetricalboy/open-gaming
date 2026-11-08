import type { AtpAgent } from '@atproto/api';

const DEFAULT_PLC_URL = 'https://plc.directory';

/**
 * Trigger a PLC operation confirmation email to the account owner's registered email address.
 * Needed once before calling `registerAttestationKey` on a `did:plc` identity.
 */
export async function requestPlcOperationToken(agent: AtpAgent): Promise<void> {
  await agent.com.atproto.identity.requestPlcOperationSignature();
}

/**
 * Register a public `did:key:z...` under the `#attestations` verification method
 * (`verificationMethods.attestations`) in a `did:plc` document.
 */
export async function registerAttestationKey({
  agent,
  did,
  publicDidKey,
  token,
  plcDirectoryUrl = DEFAULT_PLC_URL,
}: {
  agent: AtpAgent;
  did: string;
  publicDidKey: string;
  token: string;
  plcDirectoryUrl?: string;
}): Promise<void> {
  if (!did.startsWith('did:plc:')) {
    throw new Error(
      `registerAttestationKey only applies to did:plc identities (received "${did}"). For did:web, add "${did}#attestations" to your /.well-known/did.json verificationMethod array.`
    );
  }
  if (!publicDidKey.startsWith('did:key:')) {
    throw new Error(`publicDidKey must start with "did:key:", received "${publicDidKey}".`);
  }

  // Fetch current recommended/current PLC credentials so we preserve existing keys, handles, and PDS endpoints
  const plcDataRes = await fetch(`${plcDirectoryUrl.replace(/\/$/, '')}/${encodeURIComponent(did)}/data`);
  if (!plcDataRes.ok) {
    throw new Error(`Failed to fetch current PLC data for ${did}: HTTP ${plcDataRes.status}`);
  }
  const currentPlc = (await plcDataRes.json()) as {
    rotationKeys?: string[];
    alsoKnownAs?: string[];
    verificationMethods?: Record<string, string>;
    services?: Record<string, { type: string; endpoint: string }>;
  };

  const updatedVerificationMethods: Record<string, string> = {
    ...(currentPlc.verificationMethods ?? {}),
    attestations: publicDidKey,
  };

  const signed = await agent.com.atproto.identity.signPlcOperation({
    token: token.trim(),
    rotationKeys: currentPlc.rotationKeys,
    alsoKnownAs: currentPlc.alsoKnownAs,
    verificationMethods: updatedVerificationMethods,
    services: currentPlc.services,
  });

  await agent.com.atproto.identity.submitPlcOperation({
    operation: signed.data.operation,
  });
}
