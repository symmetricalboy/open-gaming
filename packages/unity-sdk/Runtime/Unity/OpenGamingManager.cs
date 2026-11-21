#if UNITY_5_3_OR_NEWER
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace OpenGaming.Sdk.Unity
{
    /// <summary>
    /// UnityWebRequest-backed HTTP transport supporting Desktop, Mobile (iOS/Android), Consoles, and WebGL builds.
    /// </summary>
    public sealed class UnityWebRequestTransport : IOpenGamingHttpTransport
    {
        public async Task<OpenGamingHttpResponse> SendAsync(
            string method,
            string url,
            byte[]? body = null,
            string? contentType = null,
            IDictionary<string, string>? headers = null,
            CancellationToken cancellationToken = default)
        {
            using var uwr = new UnityWebRequest(url, method);
            uwr.downloadHandler = new DownloadHandlerBuffer();
            if (body != null && body.Length > 0)
            {
                uwr.uploadHandler = new UploadHandlerRaw(body);
                if (!string.IsNullOrEmpty(contentType))
                    uwr.uploadHandler.contentType = contentType;
            }
            if (!string.IsNullOrEmpty(contentType))
                uwr.SetRequestHeader("Content-Type", contentType);

            if (headers != null)
            {
                foreach (var kv in headers)
                    uwr.SetRequestHeader(kv.Key, kv.Value);
            }

            var op = uwr.SendWebRequest();
            while (!op.isDone)
            {
                cancellationToken.ThrowIfCancellationRequested();
                await Task.Yield();
            }

            var responseHeaders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var rawHeaders = uwr.GetResponseHeaders();
            if (rawHeaders != null)
            {
                foreach (var kv in rawHeaders)
                    responseHeaders[kv.Key] = kv.Value;
            }

            return new OpenGamingHttpResponse
            {
                StatusCode = (int)uwr.responseCode,
                BodyText = uwr.downloadHandler?.text ?? string.Empty,
                Headers = responseHeaders
            };
        }
    }

    /// <summary>
    /// Drop-in Unity MonoBehaviour manager handling ATProto deep-link OAuth callbacks,
    /// `UnityWebRequest` transport, and `Application.persistentDataPath` offline write queueing.
    /// </summary>
    public sealed class OpenGamingManager : MonoBehaviour
    {
        public static OpenGamingManager? Instance { get; private set; }

        [Header("Open Gaming Configuration")]
        [SerializeField] private string appViewBaseUrl = "https://opengaming.games";
        [SerializeField] private string gameUri = "at://did:plc:yourgame/games.atmosphere.define/your-game";

        public OpenGamingClient Client { get; private set; } = null!;
        public string GameUri => gameUri;
        public string OfflineQueuePath => Path.Combine(Application.persistentDataPath, "opengaming_offline_queue.json");

        public event Action<string>? OnOAuthDeepLinkReceived;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);

            var dpopKey = OpenGamingSigningKey.Generate();
            Client = new OpenGamingClient(appViewBaseUrl, new UnityWebRequestTransport(), dpopKey);
            Application.deepLinkActivated += HandleDeepLink;

            if (!string.IsNullOrEmpty(Application.absoluteURL))
            {
                HandleDeepLink(Application.absoluteURL);
            }
        }

        private void OnDestroy()
        {
            if (Instance == this)
            {
                Application.deepLinkActivated -= HandleDeepLink;
            }
        }

        private void HandleDeepLink(string url)
        {
            OnOAuthDeepLinkReceived?.Invoke(url);
        }

        public void OpenSystemBrowserForOAuth(string authorizeUrl)
        {
            Application.OpenURL(authorizeUrl);
        }

        public async Task SubmitOrQueueRecordAsync(
            string collection,
            string writeMode,
            IDictionary<string, object?> record,
            string? rkey = null)
        {
            try
            {
                if (writeMode == "putRecord" && !string.IsNullOrEmpty(rkey))
                    await Client.PutRecordAsync(collection, rkey!, record);
                else
                    await Client.CreateRecordAsync(collection, record, rkey);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[OpenGaming] Offline or PDS unreachable ({ex.Message}); queueing record locally.");
                OpenGamingClient.EnqueueOfflineWrite(OfflineQueuePath, new QueuedPdsWrite
                {
                    Collection = collection,
                    Rkey = rkey,
                    WriteMode = writeMode,
                    Record = new Dictionary<string, object?>(record)
                });
            }
        }
    }
}
#endif
