#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>

// ============================================================
// WIFI
// ============================================================
const char* WIFI_SSID = "MAVELI_GAME";
const char* WIFI_PASSWORD = "maveli123";

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
// BOARD LAYOUT — must exactly match the Teensy's CELL_TYPES
// ============================================================
#define TOTAL_CELLS 20

enum CellType { BLANK = 0, TRIVIA = 1, VR = 2 };

const CellType CELL_TYPES[TOTAL_CELLS] = {
  BLANK,  BLANK, TRIVIA, BLANK,
  BLANK,  VR,    BLANK,  TRIVIA,
  BLANK,  BLANK, VR,     BLANK,
  TRIVIA, BLANK, BLANK,  VR,
  BLANK,  TRIVIA,BLANK,  BLANK
};

// Placeholder trivia bank — replace with your real Onam questions.
const char* TRIVIA_QUESTIONS[] = {
  "What flower carpet is made during Onam?",
  "Which king's return does Onam celebrate?",
  "What is the traditional Onam feast called?"
};
#define NUM_TRIVIA_QUESTIONS 3

// VR links, one per VR cell, in board order (cell 6, then cell 11, then cell 16).
const char* VR_URLS[] = {
  "https://uri-adi.vercel.app/",
  "https://level-2-memory.vercel.app/",
  "https://vallamkali.vercel.app/"
};

// Returns the VR link for a given board cell (1-indexed), or "" if that
// cell isn't a VR cell. Counts VR cells in order and matches to VR_URLS.
String vrUrlForCell(int cell) {
  int vrIndex = 0;
  for (int i = 0; i < TOTAL_CELLS; i++) {
    if (CELL_TYPES[i] == VR) {
      if (i == cell - 1) return String(VR_URLS[vrIndex]);
      vrIndex++;
    }
  }
  return "";
}

// ============================================================
// GAME STATE
// ============================================================
int playerCell = 1;
int diceValue = 0;
bool gameBusy = false;
bool gameWon = false;
bool awaitingChallenge = false;
CellType pendingType = BLANK;
String currentEvent = "READY";

// ============================================================
// TEENSY COMMS
// ============================================================
void sendTeensy(String command) {
  teensySerial.print("<");
  teensySerial.print(command);
  teensySerial.print(">");
  Serial.print("TEENSY << <"); Serial.print(command); Serial.println(">");
}

void broadcast(const String &message) {
  String copy = message;
  webSocket.broadcastTXT(copy);
}

void sendState() {
  broadcast("STATE," + String(playerCell) + "," + String(diceValue) + "," + currentEvent);
}

void logEvent(const String &message) {
  Serial.println(message);
  broadcast("LOG," + message);
}

// ============================================================
// MOVEMENT
// ============================================================
void movePlayerAnimated(int target) {
  target = constrain(target, 1, TOTAL_CELLS);
  currentEvent = "MOVING TO " + String(target);
  sendState();

  sendTeensy("M," + String(target));

  int steps = abs(target - playerCell);
  playerCell = target;
  delay(steps * 300 + 200); // matches Teensy's per-cell delay(300)

  sendState();
}

// ============================================================
// GAME ACTIONS
// ============================================================
void resetGame() {
  gameBusy = true;
  gameWon = false;
  awaitingChallenge = false;
  pendingType = BLANK;
  playerCell = 1;
  diceValue = 0;
  currentEvent = "RESETTING";

  broadcast("BUSY");
  broadcast("CHALLENGE_CLEAR");
  sendTeensy("R");
  delay(300);

  sendState();
  logEvent("Game reset - player at cell 1");
  delay(300);

  currentEvent = "READY";
  gameBusy = false;
  sendState();
  broadcast("READY");
}

void winGame() {
  gameWon = true;
  currentEvent = "YOU WIN!";
  sendState();
  logEvent("PLAYER REACHED CELL " + String(TOTAL_CELLS));
  sendTeensy("W");
  gameBusy = false;
  broadcast("READY");
  sendState();
}

void rollDice() {
  if (gameBusy || gameWon || awaitingChallenge) return;

  gameBusy = true;
  broadcast("BUSY");

  currentEvent = "ROLLING...";
  sendState();
  delay(500);

  diceValue = random(1, 7);
  currentEvent = "DICE = " + String(diceValue);
  sendState();
  logEvent("Dice = " + String(diceValue));
  delay(400);

  int target = playerCell + diceValue;

  if (target > TOTAL_CELLS) {
    currentEvent = "Need exact roll";
    sendState();
    logEvent("Roll too high");
    delay(500);
    gameBusy = false;
    broadcast("READY");
    return;
  }

  logEvent("Moving " + String(playerCell) + " -> " + String(target));
  movePlayerAnimated(target);

  if (playerCell == TOTAL_CELLS) {
    winGame();
    return;
  }

  CellType landed = CELL_TYPES[playerCell - 1];

  if (landed == TRIVIA) {
    awaitingChallenge = true;
    pendingType = TRIVIA;
    currentEvent = "TRIVIA! Answer on screen";
    sendState();
    sendTeensy("F,1");
    String q = TRIVIA_QUESTIONS[random(0, NUM_TRIVIA_QUESTIONS)];
    broadcast("CHALLENGE,TRIVIA," + String(q));
    return;
  }

  if (landed == VR) {
    awaitingChallenge = true;
    pendingType = VR;
    currentEvent = "VR CHALLENGE! Put on headset";
    sendState();
    sendTeensy("F,2");
    broadcast("CHALLENGE,VR," + vrUrlForCell(playerCell));
    return;
  }

  gameBusy = false;
  broadcast("READY");
  sendState();
}

void resolveChallenge(bool bonus) {
  if (!awaitingChallenge) return;

  awaitingChallenge = false;
  pendingType = BLANK;
  broadcast("CHALLENGE_CLEAR");

  if (bonus) {
    int target = min(playerCell + 1, TOTAL_CELLS);
    logEvent("Challenge passed - bonus move");
    movePlayerAnimated(target);
    if (playerCell == TOTAL_CELLS) {
      winGame();
      return;
    }
  } else {
    logEvent("Challenge skipped");
  }

  currentEvent = "READY";
  gameBusy = false;
  sendState();
  broadcast("READY");
}

// ============================================================
// WEBSOCKET
// ============================================================
void webSocketEvent(uint8_t client, WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    Serial.println("Dashboard connected");
    String message = "STATE," + String(playerCell) + "," + String(diceValue) + "," + currentEvent;
    webSocket.sendTXT(client, message);
    return;
  }

  if (type != WStype_TEXT) return;

  String command;
  for (size_t i = 0; i < length; i++) command += (char)payload[i];
  command.trim();

  Serial.print("WEB << "); Serial.println(command);

  if (command == "ROLL") rollDice();
  else if (command == "RESET") resetGame();
  else if (command == "SKIP") resolveChallenge(false);
  else if (command == "CHALLENGE_SUCCESS") resolveChallenge(true);
}

// ============================================================
// HTML DASHBOARD
// ============================================================
const char PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onamanji</title>
<style>
* { box-sizing:border-box; }
body { margin:0; padding:15px; background:#080b10; color:white; font-family:Arial; max-width:600px; margin:auto; }
h1 { text-align:center; color:#00e5ff; margin:5px 0; }
.subtitle { text-align:center; color:#888; margin-bottom:15px; }
.card { background:#151a22; border-radius:12px; padding:15px; margin-bottom:12px; }
.stats { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.stat { background:#202631; padding:15px; border-radius:10px; text-align:center; }
.label { font-size:12px; color:#888; margin-bottom:5px; }
.value { font-size:32px; font-weight:bold; }
#dice { color:#ffd600; }
#event { text-align:center; font-size:20px; font-weight:bold; padding:5px; }
button, a.btn { display:block; width:100%; height:52px; line-height:52px; text-align:center; text-decoration:none; border:0; border-radius:10px; margin-top:9px; font-size:17px; font-weight:bold; }
#roll { background:#00e5ff; }
#reset { background:#333b48; color:white; }
#skipTrivia, #skipVr { background:#333b48; color:white; }
#triviaCard { display:none; border:2px solid #ffd600; }
#vrCard { display:none; border:2px solid #d32f2f; }
#vrOpen { background:#d32f2f; color:white; }
button:disabled { opacity:.35; }
#connection { text-align:center; margin:10px; color:#ffcc00; }
.connected { color:#00ff88 !important; }
#log { height:160px; overflow:auto; background:#080a0e; padding:10px; border-radius:8px; font-family:monospace; font-size:12px; white-space:pre-wrap; }
</style>
</head>
<body>

<h1>🌸 ONAMANJI</h1>
<div class="subtitle">20 × 20 Matrix — Onam Board Game</div>

<div class="card">
  <div class="stats">
    <div class="stat"><div class="label">CELL</div><div id="cell" class="value">1</div></div>
    <div class="stat"><div class="label">DICE</div><div id="dice" class="value">-</div></div>
  </div>
  <button id="roll" onclick="send('ROLL')">🎲 ROLL DICE</button>
</div>

<div class="card">
  <div class="label">CURRENT EVENT</div>
  <div id="event">READY</div>
</div>

<div class="card" id="triviaCard">
  <div class="label">TRIVIA</div>
  <div id="triviaQuestion" style="margin:10px 0;"></div>
  <button id="skipTrivia" onclick="send('SKIP')">⏭ SKIP</button>
</div>

<div class="card" id="vrCard">
  <div class="label">VR CHALLENGE</div>
  <p>Put on the Quest 3 headset and complete the challenge.</p>
  <a class="btn" id="vrOpen" href="#" target="_blank">Open VR Game ↗</a>
  <button id="skipVr" onclick="send('SKIP')">⏭ SKIP</button>
</div>

<div class="card">
  <button id="reset" onclick="send('RESET')">↻ RESET</button>
</div>

<div class="card">
  <div class="label">LIVE LOG</div>
  <div id="log"></div>
</div>

<div id="connection">Connecting...</div>

<script>
let socket;
const cellEl = document.getElementById("cell");
const dice = document.getElementById("dice");
const eventBox = document.getElementById("event");
const logBox = document.getElementById("log");
const roll = document.getElementById("roll");
const triviaCard = document.getElementById("triviaCard");
const vrCard = document.getElementById("vrCard");
const triviaQuestion = document.getElementById("triviaQuestion");

function log(text) {
  const time = new Date().toLocaleTimeString();
  logBox.textContent += "[" + time + "] " + text + "\n";
  logBox.scrollTop = logBox.scrollHeight;
}

function connect() {
  socket = new WebSocket("ws://" + location.hostname + ":81/");

  socket.onopen = function() {
    document.getElementById("connection").innerHTML = "● CONNECTED";
    document.getElementById("connection").className = "connected";
    log("Dashboard connected");
  };

  socket.onclose = function() {
    document.getElementById("connection").innerHTML = "● DISCONNECTED";
    document.getElementById("connection").className = "";
    setBusy(true);
    setTimeout(connect, 1000);
  };

  socket.onmessage = function(message) {
    const parts = message.data.split(",");

    if (parts[0] == "STATE") {
      cellEl.textContent = parts[1];
      dice.textContent = parts[2] == "0" ? "-" : parts[2];
      eventBox.textContent = parts.slice(3).join(",");
      return;
    }
    if (parts[0] == "LOG") { log(parts.slice(1).join(",")); return; }
    if (parts[0] == "BUSY") { setBusy(true); return; }
    if (parts[0] == "READY") { setBusy(false); return; }

    if (parts[0] == "CHALLENGE") {
      if (parts[1] == "TRIVIA") {
        triviaQuestion.textContent = parts.slice(2).join(",");
        triviaCard.style.display = "block";
        vrCard.style.display = "none";
      } else if (parts[1] == "VR") {
        const vrUrl = parts.slice(2).join(",");
        document.getElementById("vrOpen").href = vrUrl;
        vrCard.style.display = "block";
        triviaCard.style.display = "none";
      }
      return;
    }

    if (parts[0] == "CHALLENGE_CLEAR") {
      triviaCard.style.display = "none";
      vrCard.style.display = "none";
      return;
    }
  };
}

function setBusy(disabled) {
  roll.disabled = disabled;
}

function send(command) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(command);
    log("Command: " + command);
  }
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
  Serial.println("ONAMANJI - ESP32");

  teensySerial.begin(TEENSY_BAUD, SERIAL_8N1, TEENSY_RX, TEENSY_TX);
  randomSeed(micros());

  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi IP: "); Serial.println(WiFi.softAPIP());

  server.on("/", handleRoot);
  server.begin();

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

  playerCell = 1;
  diceValue = 0;
  gameBusy = false;
  gameWon = false;
  awaitingChallenge = false;
  currentEvent = "READY";
  sendTeensy("R");

  Serial.println("READY");
}

void loop() {
  server.handleClient();
  webSocket.loop();
}
