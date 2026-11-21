using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using OpenGaming.Sdk.Internal;

namespace OpenGaming.Sdk
{
    public static class OpenGamingAttestation
    {
        /// <summary>
        /// Compute the deterministic repository-bound CIDv1 ("bafy...") for an Open Gaming record,
        /// following the identical CID-First Attestation Specification implemented by @opengaming/sdk:
        /// 1. Strip `signatures` from the record.
        /// 2. Strip `cid` and `signature` from the signature metadata and inject `repository: repositoryDid`.
        /// 3. Insert `$sig` onto the record, encode to canonical IPLD DAG-CBOR, and wrap SHA-256 as CIDv1.
        /// </summary>
        public static CidV1 ComputeAttestationCid(
            IDictionary<string, object?> record,
            IDictionary<string, object?> signatureMetadata,
            string repositoryDid)
        {
            if (string.IsNullOrEmpty(repositoryDid) || !repositoryDid.StartsWith("did:", StringComparison.Ordinal))
                throw new ArgumentException($"Invalid repositoryDid: expected DID starting with 'did:', got '{repositoryDid}'.");

            var cleanRecord = new Dictionary<string, object?>();
            foreach (var kv in record)
            {
                if (kv.Key == "signatures" || kv.Value == null) continue;
                cleanRecord[kv.Key] = kv.Value;
            }

            var sigPayload = new Dictionary<string, object?>();
            foreach (var kv in signatureMetadata)
            {
                if (kv.Key == "signature" || kv.Key == "cid" || kv.Value == null) continue;
                sigPayload[kv.Key] = kv.Value;
            }
            sigPayload["repository"] = repositoryDid;

            cleanRecord["$sig"] = sigPayload;
            byte[] cborBytes = DagCborEncoder.Encode(cleanRecord);
            return CidV1.FromDagCborBytes(cborBytes);
        }

        public static (InlineSignature Signature, string AttestationCid) CreateInlineSignature(
            IDictionary<string, object?> record,
            string issuerDid,
            string playerDid,
            OpenGamingSigningKey signingKey,
            string? issuedAt = null,
            string? rkey = null,
            string? keyId = null)
        {
            if (string.IsNullOrEmpty(issuerDid) || !issuerDid.StartsWith("did:", StringComparison.Ordinal))
                throw new ArgumentException($"Invalid issuerDid: expected DID, got '{issuerDid}'.");

            string effectiveIssuedAt = issuedAt ?? DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
            string resolvedKeyId = keyId ?? (issuerDid + OpenGamingConstants.AttestationKeyFragment);

            var meta = new Dictionary<string, object?>
            {
                ["$type"] = OpenGamingConstants.Nsids.Defs + "#inlineSignature",
                ["key"] = resolvedKeyId,
                ["issuer"] = issuerDid,
                ["issuedAt"] = effectiveIssuedAt
            };
            if (!string.IsNullOrEmpty(rkey)) meta["rkey"] = rkey;

            CidV1 cid = ComputeAttestationCid(record, meta, playerDid);
            byte[] sigBytes = signingKey.Sign(cid.Bytes);
            string cidStr = cid.Value;

            var inlineSig = new InlineSignature
            {
                Type = OpenGamingConstants.Nsids.Defs + "#inlineSignature",
                Key = resolvedKeyId,
                Issuer = issuerDid,
                IssuedAt = effectiveIssuedAt,
                Rkey = string.IsNullOrEmpty(rkey) ? null : rkey,
                Cid = cidStr,
                SignatureBase64 = CidV1.ToBase64Unpadded(sigBytes)
            };

            return (inlineSig, cidStr);
        }

        public static (AchievementUnlockRecord Record, string AttestationCid) CreateSignedUnlock(
            AchievementUnlockRecord unsignedUnlock,
            string playerDid,
            string issuerDid,
            OpenGamingSigningKey signingKey,
            string? rkey = null,
            string? keyId = null)
        {
            if (string.IsNullOrEmpty(unsignedUnlock.UnlockedAt))
                unsignedUnlock.UnlockedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
            unsignedUnlock.Player = playerDid;
            unsignedUnlock.Signatures = null;

            var map = unsignedUnlock.ToRecordMap();
            var (sig, cid) = CreateInlineSignature(map, issuerDid, playerDid, signingKey, unsignedUnlock.UnlockedAt, rkey, keyId);
            unsignedUnlock.Signatures = new List<InlineSignature> { sig };
            return (unsignedUnlock, cid);
        }

        public static (AchievementProgressRecord Record, string AttestationCid) CreateSignedProgress(
            AchievementProgressRecord unsignedProgress,
            string playerDid,
            string issuerDid,
            OpenGamingSigningKey signingKey,
            string? rkey = null,
            string? keyId = null)
        {
            if (string.IsNullOrEmpty(unsignedProgress.UpdatedAt))
                unsignedProgress.UpdatedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
            unsignedProgress.Signatures = null;

            var map = unsignedProgress.ToRecordMap();
            var (sig, cid) = CreateInlineSignature(map, issuerDid, playerDid, signingKey, unsignedProgress.UpdatedAt, rkey, keyId);
            unsignedProgress.Signatures = new List<InlineSignature> { sig };
            return (unsignedProgress, cid);
        }

        public static (LeaderboardScoreRecord Record, string AttestationCid) CreateSignedScore(
            LeaderboardScoreRecord unsignedScore,
            string playerDid,
            string issuerDid,
            OpenGamingSigningKey signingKey,
            string? rkey = null,
            string? keyId = null)
        {
            if (!unsignedScore.Score.HasValue && unsignedScore.Components != null)
            {
                foreach (var comp in unsignedScore.Components.Values)
                {
                    if (comp.IntValue.HasValue)
                    {
                        unsignedScore.Score = comp.IntValue.Value;
                        break;
                    }
                }
            }

            if (!unsignedScore.Score.HasValue && (unsignedScore.Components == null || unsignedScore.Components.Count == 0))
                throw new ArgumentException("CreateSignedScore requires either Score or at least one entry in Components.");

            if (string.IsNullOrEmpty(unsignedScore.RecordedAt))
                unsignedScore.RecordedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
            unsignedScore.Player = playerDid;
            unsignedScore.Signatures = null;

            var map = unsignedScore.ToRecordMap();
            var (sig, cid) = CreateInlineSignature(map, issuerDid, playerDid, signingKey, unsignedScore.RecordedAt, rkey, keyId);
            unsignedScore.Signatures = new List<InlineSignature> { sig };
            return (unsignedScore, cid);
        }

        public static (MatchResultRecord Record, string AttestationCid) CreateSignedMatchResult(
            MatchResultRecord unsignedMatch,
            string repositoryDid,
            string issuerDid,
            OpenGamingSigningKey signingKey,
            string? rkey = null,
            string? keyId = null)
        {
            if (unsignedMatch.Participants == null || unsignedMatch.Participants.Count < 2)
                throw new ArgumentException("CreateSignedMatchResult requires at least 2 participants.");

            if (string.IsNullOrEmpty(unsignedMatch.PlayedAt))
                unsignedMatch.PlayedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
            unsignedMatch.Signatures = null;

            var map = unsignedMatch.ToRecordMap();
            var (sig, cid) = CreateInlineSignature(map, issuerDid, repositoryDid, signingKey, unsignedMatch.PlayedAt, rkey, keyId);
            unsignedMatch.Signatures = new List<InlineSignature> { sig };
            return (unsignedMatch, cid);
        }

        public static (MatchResultRecord Record, InlineSignature Signature, string AttestationCid) CoSignMatchResult(
            MatchResultRecord matchRecord,
            string repositoryDid,
            string signerDid,
            OpenGamingSigningKey signingKey,
            string? issuedAt = null,
            string? rkey = null,
            string? keyId = null)
        {
            var map = matchRecord.ToRecordMap();
            var (sig, cid) = CreateInlineSignature(map, signerDid, repositoryDid, signingKey, issuedAt, rkey, keyId);

            var kept = new List<InlineSignature>();
            if (matchRecord.Signatures != null)
            {
                foreach (var existing in matchRecord.Signatures)
                {
                    string keyOwner = existing.Key.Split('#')[0];
                    if (existing.Issuer != signerDid && keyOwner != signerDid)
                        kept.Add(existing);
                }
            }
            kept.Add(sig);
            matchRecord.Signatures = kept;
            return (matchRecord, sig, cid);
        }

        public static string? ExtractDidFromAtUri(string? atUri)
        {
            if (string.IsNullOrEmpty(atUri) || !atUri!.StartsWith("at://", StringComparison.Ordinal))
                return null;
            string host = atUri.Substring("at://".Length).Split('/')[0];
            return host.StartsWith("did:", StringComparison.Ordinal) ? host : null;
        }

        public static string? ExtractRkeyFromAtUri(string? atUri)
        {
            if (string.IsNullOrEmpty(atUri) || !atUri!.StartsWith("at://", StringComparison.Ordinal))
                return null;
            string[] parts = atUri.Substring("at://".Length).Split('/');
            if (parts.Length < 3) return null;
            string rkey = string.Join("/", parts.Skip(2));
            return string.IsNullOrEmpty(rkey) ? null : rkey;
        }

        public static string? ExtractDidKeyFromDidDoc(IDictionary<string, object?> didDoc, string issuerDid, string keyId)
        {
            string fragment = keyId.Contains('#')
                ? "#" + keyId.Split('#')[1]
                : OpenGamingConstants.AttestationKeyFragment;
            string bareFragment = fragment.Substring(1);

            if (didDoc.TryGetValue("verificationMethod", out object? vmObj) && vmObj is IEnumerable<object?> vmList)
            {
                foreach (var item in vmList)
                {
                    if (item is IDictionary<string, object?> vm &&
                        vm.TryGetValue("id", out object? idVal) && idVal is string idStr &&
                        (idStr == issuerDid + fragment || idStr == fragment) &&
                        vm.TryGetValue("publicKeyMultibase", out object? pkVal) && pkVal is string pkStr &&
                        !string.IsNullOrEmpty(pkStr))
                    {
                        return pkStr.StartsWith("did:key:", StringComparison.Ordinal) ? pkStr : "did:key:" + pkStr;
                    }
                }
            }

            if (didDoc.TryGetValue("verificationMethods", out object? plcObj) &&
                plcObj is IDictionary<string, object?> plcMethods &&
                plcMethods.TryGetValue(bareFragment, out object? methodVal) &&
                methodVal is string methodKey &&
                !string.IsNullOrEmpty(methodKey))
            {
                return methodKey.StartsWith("did:key:", StringComparison.Ordinal) ? methodKey : "did:key:" + methodKey;
            }

            return null;
        }

        public static async Task<VerificationResult> VerifyRecordAttestationAsync(
            IDictionary<string, object?> record,
            string playerDid,
            string? recordUri = null,
            string? recordCid = null,
            string? expectedIssuerDid = null,
            IEnumerable<string>? trustedIssuerDids = null,
            bool allowAnyValidIssuer = false,
            bool allowCommunityLabelVerification = false,
            string? publicDidKey = null,
            IEnumerable<RevocationRecord>? revocations = null,
            IEnumerable<AtprotoLabel>? activeLabels = null,
            IEnumerable<string>? trustedLabelerDids = null,
            Func<string, Task<IDictionary<string, object?>?>>? resolveDidDoc = null)
        {
            if (record.TryGetValue("player", out object? playerObj) &&
                playerObj is string recPlayer &&
                recPlayer != playerDid)
            {
                return VerificationResult.Fail(
                    "player_mismatch",
                    $"Record player '{recPlayer}' does not match repository DID '{playerDid}'.");
            }

            var labelsList = activeLabels?.ToList() ?? new List<AtprotoLabel>();
            if (labelsList.Count > 0)
            {
                var blocking = FindInvalidatingLabels(labelsList, recordUri, recordCid, playerDid, trustedLabelerDids);
                if (blocking.Count > 0)
                {
                    return VerificationResult.Fail(
                        "label_invalidated",
                        "Record invalidated by moderation label: " + string.Join(", ", blocking.Select(l => $"{l.Val} (by {l.Src})")));
                }
            }

            string? targetUri =
                GetString(record, "achievement") ??
                GetString(record, "leaderboard") ??
                GetString(record, "challenge") ??
                GetString(record, "game");
            string? definitionPublisherDid = expectedIssuerDid ?? ExtractDidFromAtUri(targetUri);

            var allowedIssuers = new HashSet<string>(StringComparer.Ordinal);
            if (!string.IsNullOrEmpty(definitionPublisherDid)) allowedIssuers.Add(definitionPublisherDid!);
            if (trustedIssuerDids != null)
            {
                foreach (var d in trustedIssuerDids)
                    if (!string.IsNullOrEmpty(d)) allowedIssuers.Add(d);
            }

            var sigMaps = ExtractSignatureMaps(record);
            if (sigMaps.Count == 0)
            {
                if (allowCommunityLabelVerification && labelsList.Count > 0 && !string.IsNullOrEmpty(recordUri))
                {
                    var pos = FindVerificationLabels(labelsList, recordUri, recordCid, trustedLabelerDids);
                    if (pos.Count > 0)
                    {
                        string labelerDid = pos[0].Src;
                        var unsignedCid = ComputeAttestationCid(
                            record,
                            new Dictionary<string, object?>
                            {
                                ["$type"] = OpenGamingConstants.Nsids.Defs + "#inlineSignature",
                                ["key"] = "label:" + labelerDid,
                                ["issuer"] = labelerDid
                            },
                            playerDid).Value;

                        var revList = revocations?.ToList() ?? new List<RevocationRecord>();
                        var matchedRev = IsRecordRevoked(unsignedCid, playerDid, record, recordUri, definitionPublisherDid ?? labelerDid, definitionPublisherDid, revList);
                        if (matchedRev != null)
                        {
                            return VerificationResult.Fail("revoked", $"Record was revoked ({matchedRev.Reason}).", labelerDid, unsignedCid, matchedRev);
                        }
                        return VerificationResult.Ok(labelerDid, $"label:{labelerDid}#{pos[0].Val}", unsignedCid, "community-label");
                    }
                }
                return VerificationResult.Fail("missing_signatures", "Record contains no inline attestation signatures.");
            }

            IDictionary<string, object?>? chosenSig = null;
            foreach (var s in sigMaps)
            {
                string? key = GetString(s, "key");
                if (string.IsNullOrEmpty(key)) continue;
                if (allowAnyValidIssuer || allowedIssuers.Count == 0)
                {
                    chosenSig = s;
                    break;
                }
                string keyDid = key!.Split('#')[0];
                string? iss = GetString(s, "issuer");
                if (allowedIssuers.Contains(keyDid) || (!string.IsNullOrEmpty(iss) && allowedIssuers.Contains(iss!)))
                {
                    chosenSig = s;
                    break;
                }
            }

            if (chosenSig == null)
            {
                return VerificationResult.Fail(
                    "issuer_mismatch",
                    $"No signature found from trusted authority ({string.Join(", ", allowedIssuers)}).",
                    definitionPublisherDid);
            }

            string sigKey = GetString(chosenSig, "key")!;
            string keyDidPart = sigKey.Split('#')[0];
            string issuerDid = sigKey.StartsWith("did:key:", StringComparison.Ordinal)
                ? (GetString(chosenSig, "issuer") ?? definitionPublisherDid ?? keyDidPart)
                : keyDidPart;

            if (!allowAnyValidIssuer && allowedIssuers.Count > 0 && !allowedIssuers.Contains(issuerDid))
            {
                return VerificationResult.Fail(
                    "issuer_mismatch",
                    $"Signature issuer '{issuerDid}' is not in trusted issuers.",
                    issuerDid);
            }

            // Enforce optional rkey anti-evasion binding
            string? sigRkey = GetString(chosenSig, "rkey");
            if (!string.IsNullOrEmpty(sigRkey) && !string.IsNullOrEmpty(recordUri))
            {
                string? actualRkey = ExtractRkeyFromAtUri(recordUri);
                if (!string.IsNullOrEmpty(actualRkey) && actualRkey != sigRkey)
                {
                    return VerificationResult.Fail(
                        "rkey_mismatch",
                        $"Signature is bound to rkey '{sigRkey}', but record was found at rkey '{actualRkey}'.",
                        issuerDid);
                }
            }

            CidV1 computedCid = ComputeAttestationCid(record, chosenSig, playerDid);
            string attestationCid = computedCid.Value;
            string? claimedCid = GetString(chosenSig, "cid");
            if (!string.IsNullOrEmpty(claimedCid) && claimedCid != attestationCid)
            {
                return VerificationResult.Fail(
                    "cid_mismatch",
                    $"Claimed attestation CID '{claimedCid}' does not match recomputed CID '{attestationCid}'.",
                    issuerDid,
                    attestationCid);
            }

            string? resolvedDidKey = publicDidKey;
            if (string.IsNullOrEmpty(resolvedDidKey))
            {
                if (sigKey.StartsWith("did:key:", StringComparison.Ordinal))
                {
                    if (!allowAnyValidIssuer && allowedIssuers.Count > 0 && !allowedIssuers.Any(d => d.StartsWith("did:key:", StringComparison.Ordinal)))
                    {
                        return VerificationResult.Fail(
                            "invalid_key_format",
                            $"Bare did:key cannot attest on behalf of '{issuerDid}' without DID document binding.",
                            issuerDid,
                            attestationCid);
                    }
                    resolvedDidKey = sigKey;
                }
                else
                {
                    if (resolveDidDoc == null)
                    {
                        return VerificationResult.Fail(
                            "did_resolution_failed",
                            $"No DID resolver configured to resolve '{issuerDid}'.",
                            issuerDid,
                            attestationCid);
                    }
                    var didDoc = await resolveDidDoc(issuerDid).ConfigureAwait(false);
                    if (didDoc == null)
                    {
                        return VerificationResult.Fail(
                            "did_resolution_failed",
                            $"DID document not found for '{issuerDid}'.",
                            issuerDid,
                            attestationCid);
                    }
                    resolvedDidKey = ExtractDidKeyFromDidDoc(didDoc, issuerDid, sigKey);
                    if (string.IsNullOrEmpty(resolvedDidKey))
                    {
                        return VerificationResult.Fail(
                            "missing_attestation_key",
                            $"No '{sigKey}' verification method found in DID document for '{issuerDid}'.",
                            issuerDid,
                            attestationCid);
                    }
                }
            }

            byte[]? sigBytes = ExtractSignatureBytes(chosenSig);
            if (sigBytes == null || !OpenGamingSigningKey.VerifyDidKeySignature(resolvedDidKey!, computedCid.Bytes, sigBytes))
            {
                return VerificationResult.Fail(
                    "invalid_signature",
                    "Cryptographic signature verification failed.",
                    issuerDid,
                    attestationCid);
            }

            var revocationsList = revocations?.ToList() ?? new List<RevocationRecord>();
            var matchedRevocation = IsRecordRevoked(attestationCid, playerDid, record, recordUri, issuerDid, definitionPublisherDid, revocationsList);
            if (matchedRevocation != null)
            {
                return VerificationResult.Fail(
                    "revoked",
                    $"Attestation was revoked by publisher ({matchedRevocation.Reason}).",
                    issuerDid,
                    attestationCid,
                    matchedRevocation);
            }

            return VerificationResult.Ok(issuerDid, sigKey, attestationCid, "attestation");
        }

        public static async Task<VerificationResult> VerifyMatchResultAsync(
            IDictionary<string, object?> record,
            string repositoryDid,
            string? recordUri = null,
            string? recordCid = null,
            string? expectedIssuerDid = null,
            IEnumerable<string>? trustedIssuerDids = null,
            bool allowParticipantCoSigning = true,
            IDictionary<string, string>? participantDidKeys = null,
            IEnumerable<RevocationRecord>? revocations = null,
            IEnumerable<AtprotoLabel>? activeLabels = null,
            IEnumerable<string>? trustedLabelerDids = null,
            Func<string, Task<IDictionary<string, object?>?>>? resolveDidDoc = null)
        {
            var publisherCheck = await VerifyRecordAttestationAsync(
                record,
                repositoryDid,
                recordUri,
                recordCid,
                expectedIssuerDid,
                trustedIssuerDids,
                revocations: revocations,
                activeLabels: activeLabels,
                trustedLabelerDids: trustedLabelerDids,
                resolveDidDoc: resolveDidDoc).ConfigureAwait(false);

            if (publisherCheck.Verified || publisherCheck.Error == "revoked" || publisherCheck.Error == "label_invalidated")
                return publisherCheck;

            if (!allowParticipantCoSigning)
                return publisherCheck;

            var participantDids = new List<string>();
            if (record.TryGetValue("participants", out object? pObj) && pObj is IEnumerable<object?> pList)
            {
                foreach (var item in pList)
                {
                    if (item is IDictionary<string, object?> pm &&
                        GetString(pm, "did") is string d &&
                        d.StartsWith("did:", StringComparison.Ordinal) &&
                        !participantDids.Contains(d))
                    {
                        participantDids.Add(d);
                    }
                }
            }

            if (participantDids.Count < 2 || !participantDids.Contains(repositoryDid))
                return publisherCheck;

            var sigMaps = ExtractSignatureMaps(record);
            if (sigMaps.Count < participantDids.Count)
            {
                return VerificationResult.Fail(
                    "missing_participant_signatures",
                    $"Peer-to-peer match verification requires signatures from all {participantDids.Count} participant DIDs.");
            }

            string? definitionPublisherDid = expectedIssuerDid ?? ExtractDidFromAtUri(
                GetString(record, "leaderboard") ?? GetString(record, "challenge") ?? GetString(record, "game"));
            var revList = revocations?.ToList() ?? new List<RevocationRecord>();
            string primaryCid = string.Empty;
            string primaryKeyId = string.Empty;

            foreach (string participantDid in participantDids)
            {
                var sig = sigMaps.FirstOrDefault(s =>
                {
                    string? k = GetString(s, "key");
                    if (string.IsNullOrEmpty(k)) return false;
                    return k!.Split('#')[0] == participantDid || GetString(s, "issuer") == participantDid;
                });

                if (sig == null)
                {
                    return VerificationResult.Fail(
                        "missing_participant_signatures",
                        $"Missing co-signature from match participant '{participantDid}'.");
                }

                string sigKey = GetString(sig, "key")!;
                string? sigRkey = GetString(sig, "rkey");
                if (!string.IsNullOrEmpty(sigRkey) && !string.IsNullOrEmpty(recordUri))
                {
                    string? actualRkey = ExtractRkeyFromAtUri(recordUri);
                    if (!string.IsNullOrEmpty(actualRkey) && actualRkey != sigRkey)
                    {
                        return VerificationResult.Fail("rkey_mismatch", $"Participant signature bound to '{sigRkey}', found '{actualRkey}'.", participantDid);
                    }
                }

                CidV1 computedCid = ComputeAttestationCid(record, sig, repositoryDid);
                string cidStr = computedCid.Value;
                string? claimedCid = GetString(sig, "cid");
                if (!string.IsNullOrEmpty(claimedCid) && claimedCid != cidStr)
                {
                    return VerificationResult.Fail("cid_mismatch", "Claimed CID mismatch for participant signature.", participantDid, cidStr);
                }

                string? didKey = null;
                if (participantDidKeys != null) participantDidKeys.TryGetValue(participantDid, out didKey);
                if (string.IsNullOrEmpty(didKey))
                {
                    if (resolveDidDoc == null)
                        return VerificationResult.Fail("did_resolution_failed", $"No DID resolver for '{participantDid}'.", participantDid, cidStr);
                    var doc = await resolveDidDoc(participantDid).ConfigureAwait(false);
                    if (doc == null)
                        return VerificationResult.Fail("did_resolution_failed", $"DID document not found for '{participantDid}'.", participantDid, cidStr);
                    didKey = ExtractDidKeyFromDidDoc(doc, participantDid, sigKey);
                    if (string.IsNullOrEmpty(didKey))
                        return VerificationResult.Fail("missing_attestation_key", $"Missing '{sigKey}' for '{participantDid}'.", participantDid, cidStr);
                }

                byte[]? sigBytes = ExtractSignatureBytes(sig);
                if (sigBytes == null || !OpenGamingSigningKey.VerifyDidKeySignature(didKey!, computedCid.Bytes, sigBytes))
                {
                    return VerificationResult.Fail("invalid_signature", $"Invalid co-signature from '{participantDid}'.", participantDid, cidStr);
                }

                var rev = IsRecordRevoked(cidStr, participantDid, record, recordUri, definitionPublisherDid ?? participantDid, definitionPublisherDid, revList);
                if (rev != null)
                {
                    return VerificationResult.Fail("revoked", $"Match revoked ({rev.Reason}).", participantDid, cidStr, rev);
                }

                if (participantDid == repositoryDid || string.IsNullOrEmpty(primaryCid))
                {
                    primaryCid = cidStr;
                    primaryKeyId = sigKey;
                }
            }

            return VerificationResult.Ok(repositoryDid, primaryKeyId, primaryCid, "multi-participant", participantDids);
        }

        public static (string Rkey, RevocationRecord Record) CreateRevocationRecord(
            string scope,
            string playerDid,
            string subjectUri,
            string reason,
            string? attestationCid = null,
            string? recordUri = null,
            string? before = null,
            string? note = null,
            string? revokedAt = null)
        {
            if (!playerDid.StartsWith("did:", StringComparison.Ordinal))
                throw new ArgumentException($"Invalid player DID: '{playerDid}'.");
            if (!subjectUri.StartsWith("at://", StringComparison.Ordinal))
                throw new ArgumentException($"Invalid subject AT-URI: '{subjectUri}'.");
            if (scope == "attestation" && string.IsNullOrWhiteSpace(attestationCid))
                throw new ArgumentException("attestationCid is required when scope is 'attestation'.");

            var rec = new RevocationRecord
            {
                Scope = scope,
                AttestationCid = attestationCid,
                Player = playerDid,
                Subject = subjectUri,
                RecordUri = recordUri,
                Before = before,
                Reason = reason,
                Note = note,
                RevokedAt = revokedAt ?? DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            };

            string rkey;
            if (scope == "attestation")
            {
                rkey = attestationCid!.Trim();
            }
            else
            {
                using var sha = SHA256.Create();
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes($"{scope}:{playerDid}:{subjectUri}"));
                rkey = $"rev-{scope}-{BytesToHex(hash).Substring(0, 24)}";
            }

            return (rkey, rec);
        }

        public static RevocationRecord? IsRecordRevoked(
            string attestationCid,
            string playerDid,
            IDictionary<string, object?> record,
            string? recordUri,
            string issuerDid,
            string? definitionPublisherDid,
            IEnumerable<RevocationRecord> revocations)
        {
            string? achUri = GetString(record, "achievement");
            string? lbUri = GetString(record, "leaderboard");
            string? chUri = GetString(record, "challenge");
            string? gameUri = GetString(record, "game");
            string? tsStr = GetString(record, "unlockedAt") ?? GetString(record, "recordedAt") ?? GetString(record, "playedAt") ?? GetString(record, "updatedAt");
            bool hasTs = DateTimeOffset.TryParse(tsStr, out DateTimeOffset recordTime);

            var authorized = new HashSet<string>(StringComparer.Ordinal) { issuerDid };
            if (!string.IsNullOrEmpty(definitionPublisherDid)) authorized.Add(definitionPublisherDid!);
            string? targetOwner = ExtractDidFromAtUri(achUri ?? lbUri ?? chUri ?? gameUri);
            if (!string.IsNullOrEmpty(targetOwner)) authorized.Add(targetOwner!);

            foreach (var rev in revocations)
            {
                string? revOrigin = rev.OriginPublisherDid ?? ExtractDidFromAtUri(rev.Subject);
                if (string.IsNullOrEmpty(revOrigin) || !authorized.Contains(revOrigin!)) continue;
                string? subjOwner = ExtractDidFromAtUri(rev.Subject);
                if (!string.IsNullOrEmpty(subjOwner) && !authorized.Contains(subjOwner!)) continue;
                if (rev.Player != playerDid) continue;

                if (rev.Scope == "attestation")
                {
                    if (!string.IsNullOrEmpty(rev.AttestationCid) && rev.AttestationCid == attestationCid)
                        return rev;
                    if (string.IsNullOrEmpty(rev.AttestationCid) && !string.IsNullOrEmpty(recordUri) && rev.RecordUri == recordUri)
                        return rev;
                    continue;
                }

                if (!string.IsNullOrEmpty(rev.Before) && hasTs &&
                    DateTimeOffset.TryParse(rev.Before, out DateTimeOffset cutoff) &&
                    recordTime > cutoff)
                {
                    continue;
                }

                if (rev.Scope == "achievement" && achUri != null && rev.Subject == achUri) return rev;
                if (rev.Scope == "leaderboard" && lbUri != null && rev.Subject == lbUri) return rev;
                if (rev.Scope == "challenge" && chUri != null && rev.Subject == chUri) return rev;
                if (rev.Scope == "match" && GetString(record, "$type") == OpenGamingConstants.Nsids.MatchResult)
                {
                    if ((gameUri != null && rev.Subject == gameUri) ||
                        (lbUri != null && rev.Subject == lbUri) ||
                        (chUri != null && rev.Subject == chUri))
                        return rev;
                }
                if (rev.Scope == "game" && ((gameUri != null && rev.Subject == gameUri) ||
                    (gameUri == null && rev.Subject.Contains("/games.atmosphere.define/"))))
                {
                    return rev;
                }
            }
            return null;
        }

        public static List<AtprotoLabel> ResolveActiveLabels(IEnumerable<AtprotoLabel> events, DateTimeOffset? now = null)
        {
            var effectiveNow = now ?? DateTimeOffset.UtcNow;
            var sorted = events.OrderBy(e => DateTimeOffset.TryParse(e.Cts, out var t) ? t : DateTimeOffset.MinValue).ToList();
            var active = new Dictionary<string, AtprotoLabel>(StringComparer.Ordinal);

            foreach (var ev in sorted)
            {
                string key = $"{ev.Src}|{ev.Uri}|{ev.Cid ?? string.Empty}|{ev.Val}";
                if (ev.Neg) active.Remove(key);
                else active[key] = ev;
            }

            return active.Values.Where(l =>
            {
                if (string.IsNullOrEmpty(l.Exp)) return true;
                return !DateTimeOffset.TryParse(l.Exp, out var exp) || exp > effectiveNow;
            }).ToList();
        }

        public static List<AtprotoLabel> FindInvalidatingLabels(
            IEnumerable<AtprotoLabel> activeLabels,
            string? recordUri,
            string? recordCid,
            string? playerDid,
            IEnumerable<string>? trustedLabelerDids = null)
        {
            var trusted = trustedLabelerDids != null ? new HashSet<string>(trustedLabelerDids, StringComparer.Ordinal) : null;
            var invalidating = new HashSet<string>(OpenGamingConstants.DefaultInvalidatingLabels, StringComparer.Ordinal);

            return activeLabels.Where(l =>
            {
                if (l.Neg) return false;
                if (trusted != null && !trusted.Contains(l.Src)) return false;
                if (!invalidating.Contains(l.Val)) return false;
                if (!string.IsNullOrEmpty(recordUri) && l.Uri == recordUri)
                {
                    if (!string.IsNullOrEmpty(l.Cid) && !string.IsNullOrEmpty(recordCid) && l.Cid != recordCid)
                        return false;
                    return true;
                }
                return !string.IsNullOrEmpty(playerDid) && l.Uri == playerDid;
            }).ToList();
        }

        public static List<AtprotoLabel> FindVerificationLabels(
            IEnumerable<AtprotoLabel> activeLabels,
            string? recordUri,
            string? recordCid,
            IEnumerable<string>? trustedLabelerDids = null)
        {
            if (string.IsNullOrEmpty(recordUri)) return new List<AtprotoLabel>();
            var trusted = trustedLabelerDids != null ? new HashSet<string>(trustedLabelerDids, StringComparer.Ordinal) : null;
            var allowed = new HashSet<string>(OpenGamingConstants.DefaultVerificationLabels, StringComparer.Ordinal);

            return activeLabels.Where(l =>
            {
                if (l.Neg) return false;
                if (trusted != null && !trusted.Contains(l.Src)) return false;
                if (!allowed.Contains(l.Val)) return false;
                if (l.Uri != recordUri) return false;
                if (!string.IsNullOrEmpty(l.Cid) && !string.IsNullOrEmpty(recordCid) && l.Cid != recordCid)
                    return false;
                return true;
            }).ToList();
        }

        private static string? GetString(IDictionary<string, object?> map, string key) =>
            map.TryGetValue(key, out object? val) && val is string s ? s : null;

        private static List<IDictionary<string, object?>> ExtractSignatureMaps(IDictionary<string, object?> record)
        {
            var result = new List<IDictionary<string, object?>>();
            if (record.TryGetValue("signatures", out object? sigsObj) && sigsObj is IEnumerable<object?> list)
            {
                foreach (var item in list)
                {
                    if (item is IDictionary<string, object?> m) result.Add(m);
                }
            }
            return result;
        }

        private static byte[]? ExtractSignatureBytes(IDictionary<string, object?> sigMap)
        {
            if (!sigMap.TryGetValue("signature", out object? sigField) || sigField == null)
                return null;
            if (sigField is byte[] raw) return raw;
            if (sigField is IDictionary<string, object?> bMap &&
                bMap.TryGetValue("$bytes", out object? bStrObj) &&
                bStrObj is string b64)
            {
                try
                {
                    return CidV1.FromBase64Flexible(b64);
                }
                catch
                {
                    return null;
                }
            }
            return null;
        }

        internal static string BytesToHex(byte[] bytes)
        {
            var sb = new StringBuilder(bytes.Length * 2);
            foreach (byte b in bytes) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }
}
