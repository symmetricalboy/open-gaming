using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using OpenGaming.Sdk.Internal;

namespace OpenGaming.Sdk
{
    public sealed class OpenGamingHttpResponse
    {
        public int StatusCode { get; set; }
        public string BodyText { get; set; } = string.Empty;
        public Dictionary<string, string> Headers { get; set; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }

    public interface IOpenGamingHttpTransport
    {
        Task<OpenGamingHttpResponse> SendAsync(
            string method,
            string url,
            byte[]? body = null,
            string? contentType = null,
            IDictionary<string, string>? headers = null,
            CancellationToken cancellationToken = default);
    }

    public sealed class SystemNetHttpTransport : IOpenGamingHttpTransport
    {
        private readonly HttpClient _http;

        public SystemNetHttpTransport(HttpClient? httpClient = null)
        {
            _http = httpClient ?? new HttpClient();
        }

        public async Task<OpenGamingHttpResponse> SendAsync(
            string method,
            string url,
            byte[]? body = null,
            string? contentType = null,
            IDictionary<string, string>? headers = null,
            CancellationToken cancellationToken = default)
        {
            using var req = new HttpRequestMessage(new HttpMethod(method), url);
            if (body != null)
            {
                var content = new ByteArrayContent(body);
                if (!string.IsNullOrEmpty(contentType))
                    content.Headers.TryAddWithoutValidation("Content-Type", contentType);
                req.Content = content;
            }
            if (headers != null)
            {
                foreach (var kv in headers)
                    req.Headers.TryAddWithoutValidation(kv.Key, kv.Value);
            }

            using var res = await _http.SendAsync(req, cancellationToken).ConfigureAwait(false);
            string text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            var outHeaders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var h in res.Headers)
                outHeaders[h.Key] = string.Join(",", h.Value);

            return new OpenGamingHttpResponse
            {
                StatusCode = (int)res.StatusCode,
                BodyText = text,
                Headers = outHeaders
            };
        }
    }

    public sealed class AtprotoSession
    {
        public string Did { get; set; } = string.Empty;
        public string? Handle { get; set; }
        public string PdsUrl { get; set; } = "https://bsky.social";
        public string AccessToken { get; set; } = string.Empty;
        public string? RefreshToken { get; set; }
        public bool IsDpopBound { get; set; }
        public string? DpopNonce { get; set; }
    }

    public sealed class PkceChallenge
    {
        public string CodeVerifier { get; set; } = string.Empty;
        public string CodeChallenge { get; set; } = string.Empty;
        public string State { get; set; } = string.Empty;
    }

    public sealed class QueuedPdsWrite
    {
        public string Collection { get; set; } = string.Empty;
        public string? Rkey { get; set; }
        public string WriteMode { get; set; } = "putRecord"; // "putRecord" | "createRecord"
        public Dictionary<string, object?> Record { get; set; } = new Dictionary<string, object?>();
    }

    /// <summary>
    /// High-level Open Gaming AT Protocol client for Unity and .NET games.
    /// Supports:
    /// - ATProto Native OAuth PKCE (S256) + DPoP proof JWT generation and App Password dev sessions.
    /// - Writing signed or direct records & replay/media blobs to the player's PDS (`putRecord`, `createRecord`, `uploadBlob`).
    /// - Requesting Mode A signed receipts from a studio's attestation backend.
    /// - Querying any Open Gaming AppView (`actor.getProfile`, `leaderboard.getScores`, `/api/library`, `/api/game`).
    /// - Offline write queueing & flush on reconnect.
    /// </summary>
    public sealed class OpenGamingClient
    {
        private readonly IOpenGamingHttpTransport _transport;
        private readonly string _appViewBaseUrl;
        private readonly OpenGamingSigningKey? _dpopKey;

        public AtprotoSession? Session { get; set; }

        public OpenGamingClient(
            string appViewBaseUrl = "https://opengaming.games",
            IOpenGamingHttpTransport? transport = null,
            OpenGamingSigningKey? dpopKey = null)
        {
            _appViewBaseUrl = appViewBaseUrl.TrimEnd('/');
            _transport = transport ?? new SystemNetHttpTransport();
            _dpopKey = dpopKey;
        }

        /* --- PKCE & DPoP Native OAuth Helpers --- */

        public static PkceChallenge GeneratePkceChallenge()
        {
            var verifierBytes = new byte[32];
            var stateBytes = new byte[16];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(verifierBytes);
                rng.GetBytes(stateBytes);
            }

            string verifier = CidV1.ToBase64Url(verifierBytes);
            byte[] challengeHash;
            using (var sha = SHA256.Create())
            {
                challengeHash = sha.ComputeHash(Encoding.ASCII.GetBytes(verifier));
            }

            return new PkceChallenge
            {
                CodeVerifier = verifier,
                CodeChallenge = CidV1.ToBase64Url(challengeHash),
                State = CidV1.ToBase64Url(stateBytes)
            };
        }

        public static string BuildNativeOAuthAuthorizeUrl(
            string authorizationEndpoint,
            string clientIdMetadataUrl,
            string redirectUri,
            PkceChallenge pkce,
            string scope = OpenGamingConstants.RecommendedOAuthScopes,
            string? loginHint = null)
        {
            var sb = new StringBuilder(authorizationEndpoint);
            sb.Append(authorizationEndpoint.Contains("?") ? "&" : "?");
            sb.Append("response_type=code");
            sb.Append("&client_id=").Append(Uri.EscapeDataString(clientIdMetadataUrl));
            sb.Append("&redirect_uri=").Append(Uri.EscapeDataString(redirectUri));
            sb.Append("&scope=").Append(Uri.EscapeDataString(scope));
            sb.Append("&code_challenge=").Append(Uri.EscapeDataString(pkce.CodeChallenge));
            sb.Append("&code_challenge_method=S256");
            sb.Append("&state=").Append(Uri.EscapeDataString(pkce.State));
            if (!string.IsNullOrEmpty(loginHint))
                sb.Append("&login_hint=").Append(Uri.EscapeDataString(loginHint));
            return sb.ToString();
        }

        /// <summary>
        /// Build a RFC 9449 DPoP proof JWT signed by an ephemeral or persistent P-256 keypair.
        /// </summary>
        public static string CreateDpopProofJwt(
            OpenGamingSigningKey dpopKey,
            string httpMethod,
            string targetUrl,
            string? nonce = null,
            string? accessToken = null)
        {
            if (!OpenGamingSigningKey.TryDecompressP256DidKey(dpopKey.PublicDidKey, out byte[] qx, out byte[] qy))
                throw new InvalidOperationException("Failed extracting P-256 coordinates from DPoP key.");

            var header = new Dictionary<string, object?>
            {
                ["typ"] = "dpop+jwt",
                ["alg"] = "ES256",
                ["jwk"] = new Dictionary<string, object?>
                {
                    ["kty"] = "EC",
                    ["crv"] = "P-256",
                    ["x"] = CidV1.ToBase64Url(qx),
                    ["y"] = CidV1.ToBase64Url(qy)
                }
            };

            var jtiBytes = new byte[16];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(jtiBytes);

            var payload = new Dictionary<string, object?>
            {
                ["jti"] = CidV1.ToBase64Url(jtiBytes),
                ["htm"] = httpMethod.ToUpperInvariant(),
                ["htu"] = targetUrl.Split('?')[0],
                ["iat"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            };

            if (!string.IsNullOrEmpty(nonce))
                payload["nonce"] = nonce;

            if (!string.IsNullOrEmpty(accessToken))
            {
                using var sha = SHA256.Create();
                byte[] ath = sha.ComputeHash(Encoding.ASCII.GetBytes(accessToken));
                payload["ath"] = CidV1.ToBase64Url(ath);
            }

            string encodedHeader = CidV1.ToBase64Url(Encoding.UTF8.GetBytes(OpenGamingJson.Serialize(header)));
            string encodedPayload = CidV1.ToBase64Url(Encoding.UTF8.GetBytes(OpenGamingJson.Serialize(payload)));
            string signingInput = encodedHeader + "." + encodedPayload;
            byte[] sig = dpopKey.Sign(Encoding.ASCII.GetBytes(signingInput));
            return signingInput + "." + CidV1.ToBase64Url(sig);
        }

        /* --- App Password Dev Login & PDS Record Writes --- */

        public async Task<AtprotoSession> LoginWithAppPasswordAsync(
            string identifier,
            string appPassword,
            string pdsUrl = "https://bsky.social",
            CancellationToken cancellationToken = default)
        {
            string cleanPds = pdsUrl.TrimEnd('/');
            var bodyMap = new Dictionary<string, object?>
            {
                ["identifier"] = identifier,
                ["password"] = appPassword
            };

            var res = await SendJsonAsync("POST", $"{cleanPds}/xrpc/com.atproto.server.createSession", bodyMap, includeAuth: false, cancellationToken: cancellationToken)
                .ConfigureAwait(false);
            EnsureSuccess(res, "createSession");

            var json = OpenGamingJson.ParseObject(res.BodyText);
            Session = new AtprotoSession
            {
                Did = json.TryGetValue("did", out var d) && d is string ds ? ds : string.Empty,
                Handle = json.TryGetValue("handle", out var h) && h is string hs ? hs : null,
                PdsUrl = cleanPds,
                AccessToken = json.TryGetValue("accessJwt", out var a) && a is string jwt ? jwt : string.Empty,
                RefreshToken = json.TryGetValue("refreshJwt", out var r) && r is string refJwt ? refJwt : null,
                IsDpopBound = false
            };
            return Session;
        }

        public async Task<(string Uri, string Cid)> PutRecordAsync(
            string collection,
            string rkey,
            IDictionary<string, object?> record,
            CancellationToken cancellationToken = default)
        {
            var session = RequireSession();
            var payload = new Dictionary<string, object?>
            {
                ["repo"] = session.Did,
                ["collection"] = collection,
                ["rkey"] = rkey,
                ["record"] = record
            };

            var res = await SendJsonAsync(
                "POST",
                $"{session.PdsUrl.TrimEnd('/')}/xrpc/com.atproto.repo.putRecord",
                payload,
                includeAuth: true,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            EnsureSuccess(res, "putRecord");

            var parsed = OpenGamingJson.ParseObject(res.BodyText);
            string uri = parsed.TryGetValue("uri", out var u) && u is string us ? us : string.Empty;
            string cid = parsed.TryGetValue("cid", out var c) && c is string cs ? cs : string.Empty;
            return (uri, cid);
        }

        public async Task<(string Uri, string Cid)> CreateRecordAsync(
            string collection,
            IDictionary<string, object?> record,
            string? rkey = null,
            CancellationToken cancellationToken = default)
        {
            var session = RequireSession();
            var payload = new Dictionary<string, object?>
            {
                ["repo"] = session.Did,
                ["collection"] = collection,
                ["record"] = record
            };
            if (!string.IsNullOrEmpty(rkey)) payload["rkey"] = rkey;

            var res = await SendJsonAsync(
                "POST",
                $"{session.PdsUrl.TrimEnd('/')}/xrpc/com.atproto.repo.createRecord",
                payload,
                includeAuth: true,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            EnsureSuccess(res, "createRecord");

            var parsed = OpenGamingJson.ParseObject(res.BodyText);
            string uri = parsed.TryGetValue("uri", out var u) && u is string us ? us : string.Empty;
            string cid = parsed.TryGetValue("cid", out var c) && c is string cs ? cs : string.Empty;
            return (uri, cid);
        }

        public async Task<BlobRef> UploadBlobAsync(
            byte[] data,
            string mimeType,
            CancellationToken cancellationToken = default)
        {
            var session = RequireSession();
            string url = $"{session.PdsUrl.TrimEnd('/')}/xrpc/com.atproto.repo.uploadBlob";
            var headers = BuildAuthHeaders("POST", url);

            var res = await _transport.SendAsync("POST", url, data, mimeType, headers, cancellationToken).ConfigureAwait(false);
            EnsureSuccess(res, "uploadBlob");

            var root = OpenGamingJson.ParseObject(res.BodyText);
            if (!root.TryGetValue("blob", out var bObj) || !(bObj is IDictionary<string, object?> blobMap))
                throw new InvalidOperationException("uploadBlob response did not contain a blob object.");

            string cidLink = string.Empty;
            if (blobMap.TryGetValue("ref", out var refObj) && refObj is IDictionary<string, object?> refMap &&
                refMap.TryGetValue("$link", out var linkVal) && linkVal is string ls)
            {
                cidLink = ls;
            }

            long size = blobMap.TryGetValue("size", out var sVal) && sVal is long sl ? sl : data.Length;
            return new BlobRef
            {
                CidLink = cidLink,
                MimeType = mimeType,
                Size = size
            };
        }

        /* --- Studio Backend Attestation Flow + PDS Persistence --- */

        /// <summary>
        /// Request a Mode A signed record from your game studio's attestation backend and immediately
        /// write it to the authenticated player's PDS repository.
        /// </summary>
        public async Task<(string Uri, string Cid, Dictionary<string, object?> SignedRecord)> RequestAttestedRecordAndWriteAsync(
            string studioAttestationEndpoint,
            IDictionary<string, object?> claimPayload,
            string collection,
            string writeMode = "putRecord",
            string? rkey = null,
            string? studioAuthBearerToken = null,
            CancellationToken cancellationToken = default)
        {
            var extraHeaders = new Dictionary<string, string>();
            if (!string.IsNullOrEmpty(studioAuthBearerToken))
                extraHeaders["Authorization"] = "Bearer " + studioAuthBearerToken;

            byte[] bodyBytes = Encoding.UTF8.GetBytes(OpenGamingJson.Serialize(claimPayload));
            var attestRes = await _transport.SendAsync("POST", studioAttestationEndpoint, bodyBytes, "application/json", extraHeaders, cancellationToken)
                .ConfigureAwait(false);
            EnsureSuccess(attestRes, "studioAttestation");

            var parsed = OpenGamingJson.ParseObject(attestRes.BodyText);
            var signedRecord = parsed.TryGetValue("record", out var recObj) && recObj is Dictionary<string, object?> innerRec
                ? innerRec
                : parsed;
            string? effectiveRkey = rkey ?? (parsed.TryGetValue("rkey", out var rkObj) && rkObj is string rks ? rks : null);

            if (writeMode == "putRecord" && !string.IsNullOrEmpty(effectiveRkey))
            {
                var (uri, cid) = await PutRecordAsync(collection, effectiveRkey!, signedRecord, cancellationToken).ConfigureAwait(false);
                return (uri, cid, signedRecord);
            }
            else
            {
                var (uri, cid) = await CreateRecordAsync(collection, signedRecord, effectiveRkey, cancellationToken).ConfigureAwait(false);
                return (uri, cid, signedRecord);
            }
        }

        /* --- AppView XRPC & Viewer Queries --- */

        public async Task<Dictionary<string, object?>> GetActorProfileAsync(
            string actorDidOrHandle,
            CancellationToken cancellationToken = default)
        {
            string url = $"{_appViewBaseUrl}/xrpc/{OpenGamingConstants.Nsids.ActorGetProfile}?actor={Uri.EscapeDataString(actorDidOrHandle)}";
            var res = await _transport.SendAsync("GET", url, cancellationToken: cancellationToken).ConfigureAwait(false);
            EnsureSuccess(res, "actor.getProfile");
            return OpenGamingJson.ParseObject(res.BodyText);
        }

        public async Task<Dictionary<string, object?>> GetLeaderboardScoresAsync(
            string leaderboardUri,
            string timeframe = "allTime",
            string scope = "public",
            string? viewer = null,
            string? player = null,
            bool includeObsolete = false,
            string? sortBy = null,
            IDictionary<string, string>? dimensions = null,
            string? seed = null,
            int limit = 25,
            CancellationToken cancellationToken = default)
        {
            var sb = new StringBuilder($"{_appViewBaseUrl}/xrpc/{OpenGamingConstants.Nsids.LeaderboardGetScores}");
            sb.Append("?leaderboard=").Append(Uri.EscapeDataString(leaderboardUri));
            sb.Append("&timeframe=").Append(Uri.EscapeDataString(timeframe));
            sb.Append("&scope=").Append(Uri.EscapeDataString(scope));
            sb.Append("&limit=").Append(limit);
            if (!string.IsNullOrEmpty(viewer)) sb.Append("&viewer=").Append(Uri.EscapeDataString(viewer));
            if (!string.IsNullOrEmpty(player)) sb.Append("&player=").Append(Uri.EscapeDataString(player));
            if (includeObsolete) sb.Append("&includeObsolete=true");
            if (!string.IsNullOrEmpty(sortBy)) sb.Append("&sortBy=").Append(Uri.EscapeDataString(sortBy));
            string dimStr = OpenGamingLeaderboards.SerializeDimensionsFilter(dimensions);
            if (!string.IsNullOrEmpty(dimStr)) sb.Append("&dimensions=").Append(Uri.EscapeDataString(dimStr));
            if (!string.IsNullOrEmpty(seed)) sb.Append("&seed=").Append(Uri.EscapeDataString(seed));

            var res = await _transport.SendAsync("GET", sb.ToString(), cancellationToken: cancellationToken).ConfigureAwait(false);
            EnsureSuccess(res, "leaderboard.getScores");
            return OpenGamingJson.ParseObject(res.BodyText);
        }

        public async Task<Dictionary<string, object?>> GetActorLibraryAsync(
            string actorDidOrHandle,
            string? shelf = null,
            CancellationToken cancellationToken = default)
        {
            string url = $"{_appViewBaseUrl}/api/library?actor={Uri.EscapeDataString(actorDidOrHandle)}";
            if (!string.IsNullOrEmpty(shelf)) url += "&shelf=" + Uri.EscapeDataString(shelf);
            var res = await _transport.SendAsync("GET", url, cancellationToken: cancellationToken).ConfigureAwait(false);
            EnsureSuccess(res, "api/library");
            return OpenGamingJson.ParseObject(res.BodyText);
        }

        /* --- Persistent Offline Submission Queue --- */

        public static void EnqueueOfflineWrite(string queueFilePath, QueuedPdsWrite item)
        {
            var items = LoadOfflineQueue(queueFilePath);
            items.Add(item);
            SaveOfflineQueue(queueFilePath, items);
        }

        public async Task<int> FlushOfflineQueueAsync(string queueFilePath, CancellationToken cancellationToken = default)
        {
            var items = LoadOfflineQueue(queueFilePath);
            if (items.Count == 0) return 0;

            var remaining = new List<QueuedPdsWrite>();
            int flushed = 0;

            foreach (var item in items)
            {
                try
                {
                    if (item.WriteMode == "putRecord" && !string.IsNullOrEmpty(item.Rkey))
                        await PutRecordAsync(item.Collection, item.Rkey!, item.Record, cancellationToken).ConfigureAwait(false);
                    else
                        await CreateRecordAsync(item.Collection, item.Record, item.Rkey, cancellationToken).ConfigureAwait(false);
                    flushed++;
                }
                catch
                {
                    remaining.Add(item);
                }
            }

            SaveOfflineQueue(queueFilePath, remaining);
            return flushed;
        }

        private static List<QueuedPdsWrite> LoadOfflineQueue(string path)
        {
            var result = new List<QueuedPdsWrite>();
            if (!File.Exists(path)) return result;
            string raw = File.ReadAllText(path, Encoding.UTF8);
            if (string.IsNullOrWhiteSpace(raw)) return result;

            var root = OpenGamingJson.ParseObject(raw);
            if (root.TryGetValue("items", out var arrObj) && arrObj is IEnumerable<object?> arr)
            {
                foreach (var el in arr)
                {
                    if (el is IDictionary<string, object?> m &&
                        m.TryGetValue("collection", out var c) && c is string col &&
                        m.TryGetValue("record", out var r) && r is Dictionary<string, object?> rec)
                    {
                        result.Add(new QueuedPdsWrite
                        {
                            Collection = col,
                            Rkey = m.TryGetValue("rkey", out var rk) && rk is string rks ? rks : null,
                            WriteMode = m.TryGetValue("writeMode", out var wm) && wm is string wms ? wms : "putRecord",
                            Record = rec
                        });
                    }
                }
            }
            return result;
        }

        private static void SaveOfflineQueue(string path, List<QueuedPdsWrite> items)
        {
            string? dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var serializedItems = new List<object?>();
            foreach (var i in items)
            {
                serializedItems.Add(new Dictionary<string, object?>
                {
                    ["collection"] = i.Collection,
                    ["rkey"] = i.Rkey,
                    ["writeMode"] = i.WriteMode,
                    ["record"] = i.Record
                });
            }
            var wrapper = new Dictionary<string, object?> { ["items"] = serializedItems };
            File.WriteAllText(path, OpenGamingJson.Serialize(wrapper), Encoding.UTF8);
        }

        private AtprotoSession RequireSession() =>
            Session ?? throw new InvalidOperationException("OpenGamingClient has no active ATProto session.");

        private Dictionary<string, string> BuildAuthHeaders(string method, string url)
        {
            var headers = new Dictionary<string, string>();
            if (Session == null || string.IsNullOrEmpty(Session.AccessToken)) return headers;

            if (Session.IsDpopBound && _dpopKey != null)
            {
                headers["Authorization"] = "DPoP " + Session.AccessToken;
                headers["DPoP"] = CreateDpopProofJwt(_dpopKey, method, url, Session.DpopNonce, Session.AccessToken);
            }
            else
            {
                headers["Authorization"] = "Bearer " + Session.AccessToken;
            }
            return headers;
        }

        private async Task<OpenGamingHttpResponse> SendJsonAsync(
            string method,
            string url,
            IDictionary<string, object?> payload,
            bool includeAuth,
            CancellationToken cancellationToken)
        {
            byte[] body = Encoding.UTF8.GetBytes(OpenGamingJson.Serialize(payload));
            var headers = includeAuth ? BuildAuthHeaders(method, url) : null;
            var res = await _transport.SendAsync(method, url, body, "application/json", headers, cancellationToken)
                .ConfigureAwait(false);

            // Handle RFC 9449 DPoP-Nonce challenge automatically
            if (includeAuth && Session != null && Session.IsDpopBound && _dpopKey != null &&
                (res.StatusCode == 400 || res.StatusCode == 401) &&
                res.Headers.TryGetValue("DPoP-Nonce", out string? newNonce) &&
                !string.IsNullOrEmpty(newNonce))
            {
                Session.DpopNonce = newNonce;
                headers = BuildAuthHeaders(method, url);
                res = await _transport.SendAsync(method, url, body, "application/json", headers, cancellationToken)
                    .ConfigureAwait(false);
            }

            return res;
        }

        private static void EnsureSuccess(OpenGamingHttpResponse res, string operation)
        {
            if (res.StatusCode < 200 || res.StatusCode >= 300)
            {
                throw new HttpRequestException($"Open Gaming {operation} failed (HTTP {res.StatusCode}): {res.BodyText}");
            }
        }
    }
}
