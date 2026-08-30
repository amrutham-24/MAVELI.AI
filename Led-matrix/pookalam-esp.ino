#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>

// ============================================================
// WIFI
// ============================================================
const char* WIFI_SSID = "POOKALAM_NET";
const char* WIFI_PASSWORD = "pookalam_pass";

WebServer server(80);
WebSocketsServer webSocket(81);

// ============================================================
// ESP32 -> TEENSY
// ============================================================
HardwareSerial teensySerial(1);
#define TEENSY_RX 4
#define TEENSY_TX 5
#define TEENSY_BAUD 1500000

// ============================================================
// POOKALAM STATE
// ============================================================
int p_petals = 8;
int p_rings = 6;
float p_wobble = 0.18;
float p_spin_speed = 0.6;
int p_inner = 1;
int p_mask = 1;

void sendTeensyParams() {
  String cmd = "<K," + String(p_petals) + "," + String(p_rings) + "," + String(p_wobble, 3) + "," + String(p_spin_speed, 3) + "," + String(p_inner) + "," + String(p_mask) + ">";
  teensySerial.print(cmd);
  Serial.print("TEENSY << "); Serial.println(cmd);
}

void broadcastState() {
  String msg = "STATE," + String(p_petals) + "," + String(p_rings) + "," + String(p_wobble, 3) + "," + String(p_spin_speed, 3) + "," + String(p_inner) + "," + String(p_mask);
  webSocket.broadcastTXT(msg);
}

// ============================================================
// WEBSOCKET
// ============================================================
void webSocketEvent(uint8_t client, WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    String msg = "STATE," + String(p_petals) + "," + String(p_rings) + "," + String(p_wobble, 3) + "," + String(p_spin_speed, 3) + "," + String(p_inner) + "," + String(p_mask);
    webSocket.sendTXT(client, msg);
    return;
  }
  
  if (type == WStype_TEXT) {
    String cmd;
    for (size_t i = 0; i < length; i++) cmd += (char)payload[i];
    
    if (cmd.startsWith("SET,")) {
      int c1 = cmd.indexOf(',');
      int c2 = cmd.indexOf(',', c1 + 1);
      int c3 = cmd.indexOf(',', c2 + 1);
      int c4 = cmd.indexOf(',', c3 + 1);
      int c5 = cmd.indexOf(',', c4 + 1);
      int c6 = cmd.indexOf(',', c5 + 1);
      
      if (c1 >= 0 && c2 >= 0 && c3 >= 0 && c4 >= 0 && c5 >= 0 && c6 >= 0) {
        p_petals = cmd.substring(c1 + 1, c2).toInt();
        p_rings = cmd.substring(c2 + 1, c3).toInt();
        p_wobble = cmd.substring(c3 + 1, c4).toFloat();
        p_spin_speed = cmd.substring(c4 + 1, c5).toFloat();
        p_inner = cmd.substring(c5 + 1, c6).toInt();
        p_mask = cmd.substring(c6 + 1).toInt();
        
        sendTeensyParams();
        broadcastState();
      }
    }
  }
}

// ============================================================
// HTML DASHBOARD
// ============================================================
const char PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pookalam Dashboard</title>
<style>
* { box-sizing:border-box; }
body { margin:0; padding:15px; background:#0b0b0f; color:#e7e7ea; font-family:sans-serif; max-width:500px; margin:auto; }
h1 { text-align:center; color:#ffc857; margin:5px 0; }
.card { background:#1b1b22; border-radius:12px; padding:20px; margin-bottom:12px; }
.control { margin-bottom: 20px; }
.control label { display:flex; justify-content:space-between; margin-bottom:8px; font-weight:bold; color:#888; }
input[type="range"] { width: 100%; accent-color: #ffc857; }
.checkbox { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; font-weight:bold; color:#888; }
input[type="checkbox"] { width: 20px; height: 20px; accent-color: #ffc857; }
#connection { text-align:center; margin:10px; color:#ffcc00; }
.connected { color:#00ff88 !important; }
</style>
</head>
<body>
<h1>🌸 Native Pookalam</h1>
<div class="card">
  <div class="control">
    <label><span>Petals</span><span id="l-petals">8</span></label>
    <input type="range" id="petals" min="3" max="16" step="1" value="8" oninput="update()">
  </div>
  <div class="control">
    <label><span>Rings</span><span id="l-rings">6</span></label>
    <input type="range" id="rings" min="2" max="10" step="1" value="6" oninput="update()">
  </div>
  <div class="control">
    <label><span>Wobble</span><span id="l-wobble">0.18</span></label>
    <input type="range" id="wobble" min="0" max="0.35" step="0.01" value="0.18" oninput="update()">
  </div>
  <div class="control">
    <label><span>Spin Speed</span><span id="l-spin">0.6</span></label>
    <input type="range" id="spin" min="-2.0" max="2.0" step="0.05" value="0.6" oninput="update()">
  </div>
  <div class="checkbox">
    <span>Inner Petals</span>
    <input type="checkbox" id="inner" checked onchange="update()">
  </div>
  <div class="checkbox">
    <span>Circle Mask</span>
    <input type="checkbox" id="mask" checked onchange="update()">
  </div>
</div>
<div id="connection">Connecting...</div>

<script>
let socket;
const I = id => document.getElementById(id);

function update() {
  I("l-petals").innerText = I("petals").value;
  I("l-rings").innerText = I("rings").value;
  I("l-wobble").innerText = I("wobble").value;
  I("l-spin").innerText = I("spin").value;
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send("SET," + 
      I("petals").value + "," + 
      I("rings").value + "," + 
      I("wobble").value + "," + 
      I("spin").value + "," + 
      (I("inner").checked ? 1 : 0) + "," + 
      (I("mask").checked ? 1 : 0));
  }
}

function connect() {
  socket = new WebSocket("ws://" + location.hostname + ":81/");
  socket.onopen = function() {
    I("connection").innerHTML = "● CONNECTED";
    I("connection").className = "connected";
  };
  socket.onclose = function() {
    I("connection").innerHTML = "● DISCONNECTED";
    I("connection").className = "";
    setTimeout(connect, 1000);
  };
  socket.onmessage = function(e) {
    const p = e.data.split(",");
    if (p[0] === "STATE") {
      I("petals").value = p[1];
      I("rings").value = p[2];
      I("wobble").value = p[3];
      I("spin").value = p[4];
      I("inner").checked = p[5] == "1";
      I("mask").checked = p[6] == "1";
      
      I("l-petals").innerText = p[1];
      I("l-rings").innerText = p[2];
      I("l-wobble").innerText = p[3];
      I("l-spin").innerText = p[4];
    }
  };
}
connect();
</script>
</body>
</html>
)rawliteral";

void handleRoot() {
  server.send_P(200, "text/html", PAGE);
}

// ============================================================
// SETUP / LOOP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("POOKALAM DASHBOARD - ESP32");

  teensySerial.begin(TEENSY_BAUD, SERIAL_8N1, TEENSY_RX, TEENSY_TX);

  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi IP: "); Serial.println(WiFi.softAPIP());

  server.on("/", handleRoot);
  server.begin();

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  
  sendTeensyParams();
}

void loop() {
  server.handleClient();
  webSocket.loop();
}
