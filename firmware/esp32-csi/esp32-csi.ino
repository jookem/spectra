/*
 * SPECTRA RF — ESP32 CSI bridge
 *
 * Streams WiFi channel state information to the VJ engine over a websocket.
 * Frame format: one binary message per CSI capture, N uint8 subcarrier
 * amplitudes (0..255). csi.js infers N from the first frame.
 *
 * Hardware: ESP32, ESP32-S3 or ESP32-C3. NOT ESP32-S2 (no CSI support).
 * Libraries: ESPAsyncWebServer + AsyncTCP (install both via Library Manager).
 *
 * Board must be in station mode and associated with an AP — CSI is only
 * produced for packets the radio actually receives, so we generate steady
 * downlink traffic by pinging the gateway. Movement between the ESP32 and
 * the AP is what shows up in the data, so place them 3-5m apart with the
 * area you care about in between.
 */

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <esp_wifi.h>
#include <ESP32Ping.h>
#include <math.h>

// ---- config ---------------------------------------------------------------

static const char* SSID     = "YOUR_SSID";
static const char* PASSWORD = "YOUR_PASSWORD";
static const uint16_t PORT  = 8787;

// LLTF gives 64 subcarriers; the outer ones are guard bands and carry no
// useful energy. These two runs are the 52 that 802.11 actually modulates.
static const int SC_LO_START = 6,  SC_LO_END = 31;   // maps to -26..-1
static const int SC_HI_START = 33, SC_HI_END = 58;   // maps to  +1..+26
static const int N_SC = (SC_LO_END - SC_LO_START + 1) + (SC_HI_END - SC_HI_START + 1); // 52

static const int PING_HZ = 50;   // downlink packet rate → CSI frame rate

// ---- state ----------------------------------------------------------------

AsyncWebServer server(80);
AsyncWebSocket ws("/");

// Single-slot handoff from the WiFi task to loop(). The CSI callback runs in
// the WiFi driver's context and must not block or allocate, so it only writes
// here; loop() drains it. Dropping frames under load is correct behaviour —
// a stale frame is worse than a missing one.
static volatile bool     frameReady = false;
static uint8_t           frameBuf[N_SC];
static portMUX_TYPE      frameMux = portMUX_INITIALIZER_UNLOCKED;

static uint32_t framesIn = 0, framesOut = 0, lastStat = 0;

// ---- CSI ------------------------------------------------------------------

static void IRAM_ATTR csi_cb(void* ctx, wifi_csi_info_t* info) {
  if (!info || !info->buf) return;
  // Only accept full LLTF captures (128 bytes = 64 subcarriers x 2 int8).
  if (info->len < 128) return;

  const int8_t* b = info->buf;
  uint8_t tmp[N_SC];
  int k = 0;

  for (int i = SC_LO_START; i <= SC_LO_END; i++) {
    int im = b[i * 2], re = b[i * 2 + 1];
    float a = sqrtf((float)(im * im + re * re));
    tmp[k++] = (uint8_t)(a > 127.0f ? 255 : a * 2.0f);
  }
  for (int i = SC_HI_START; i <= SC_HI_END; i++) {
    int im = b[i * 2], re = b[i * 2 + 1];
    float a = sqrtf((float)(im * im + re * re));
    tmp[k++] = (uint8_t)(a > 127.0f ? 255 : a * 2.0f);
  }

  portENTER_CRITICAL_ISR(&frameMux);
  memcpy(frameBuf, tmp, N_SC);
  frameReady = true;
  portEXIT_CRITICAL_ISR(&frameMux);
  framesIn++;
}

static void startCSI() {
  wifi_csi_config_t cfg = {};
  cfg.lltf_en           = true;   // legacy long training field — the 64 we read
  cfg.htltf_en          = false;
  cfg.stbc_htltf2_en    = false;
  cfg.ltf_merge_en      = false;
  cfg.channel_filter_en = false;  // keep raw; filtering smears the motion signal
  cfg.manu_scale        = false;

  ESP_ERROR_CHECK(esp_wifi_set_csi_config(&cfg));
  ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(csi_cb, NULL));
  ESP_ERROR_CHECK(esp_wifi_set_csi(true));
  Serial.printf("CSI on — %d subcarriers per frame\n", N_SC);
}

// ---- setup / loop ---------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);

  WiFi.mode(WIFI_STA);
  WiFi.begin(SSID, PASSWORD);
  Serial.print("connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.printf("\nip %s   gw %s   ch %d\n",
    WiFi.localIP().toString().c_str(),
    WiFi.gatewayIP().toString().c_str(),
    WiFi.channel());

  // Fixed rate, no sleep — power save gates the receiver and kills CSI cadence.
  esp_wifi_set_ps(WIFI_PS_NONE);

  ws.onEvent([](AsyncWebSocket*, AsyncWebSocketClient* c, AwsEventType t,
                void*, uint8_t*, size_t) {
    if (t == WS_EVT_CONNECT)    Serial.printf("client %u up\n", c->id());
    if (t == WS_EVT_DISCONNECT) Serial.println("client down");
  });
  server.addHandler(&ws);
  server.begin();
  Serial.printf("websocket → ws://%s:80/\n", WiFi.localIP().toString().c_str());

  startCSI();
}

void loop() {
  static uint32_t lastPing = 0;
  const uint32_t now = millis();

  // Drive downlink traffic so the radio has packets to measure.
  if (now - lastPing >= (uint32_t)(1000 / PING_HZ)) {
    lastPing = now;
    Ping.ping(WiFi.gatewayIP(), 1);
  }

  if (frameReady && ws.count()) {
    uint8_t out[N_SC];
    portENTER_CRITICAL(&frameMux);
    memcpy(out, frameBuf, N_SC);
    frameReady = false;
    portEXIT_CRITICAL(&frameMux);
    ws.binaryAll((const char*)out, N_SC);
    framesOut++;
  } else if (frameReady) {
    frameReady = false;   // no listener; discard
  }

  if (now - lastStat > 2000) {
    Serial.printf("csi %lu/s   sent %lu/s   clients %u\n",
      framesIn / 2, framesOut / 2, ws.count());
    framesIn = framesOut = 0;
    lastStat = now;
  }

  ws.cleanupClients();
}
