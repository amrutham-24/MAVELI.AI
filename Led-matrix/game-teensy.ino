#include <ObjectFLED.h>
#include <FastLED.h>

// ============================================================
// HARDWARE — 20 physical rows (pins 33, 34 added earlier + the
// original 18). With CELL_H=4, 20 rows divides evenly (5 cell
// rows), so no border strip is needed anymore.
// ============================================================
#define GRID_ROWS 20
#define GRID_COLS 20
#define SERIAL_LINK Serial1
#define BRIGHTNESS 35
#define LED_COLOR_ORDER CORDER_GRB

uint8_t rowPins[GRID_ROWS] = {
  33, 34,
  3, 5, 7, 9, 11, 24, 26, 28, 30, 32,
  37, 39, 41, 14, 16, 18, 20, 22
};

CRGB canvas[GRID_ROWS][GRID_COLS];
ObjectFLED leds(GRID_ROWS * GRID_COLS, canvas, LED_COLOR_ORDER, GRID_ROWS, rowPins, 0);

// ============================================================
// ORIENTATION — flip if the board looks mirrored/upside down
// ============================================================
#define FLIP_H false
#define FLIP_V false

// ============================================================
// BOARD LAYOUT
// Cells are now 5(w) x 4(h) = 20 pixels each.
// 4 cells across x 5 cells down = 20 cells, numbered 1-20 in
// serpentine order starting bottom-left (cell 1).
// ============================================================
#define CELL_W 4
#define CELL_H 5
#define CELLS_ACROSS (GRID_COLS / CELL_W)     // 4
#define CELLS_DOWN   (GRID_ROWS / CELL_H)     // 5
#define TOTAL_CELLS  (CELLS_ACROSS * CELLS_DOWN) // 20

enum CellType { BLANK = 0, TRIVIA = 1, VR = 2 };

// EDIT THIS to match your actual board layout — placeholder
// scatter. Must match the ESP32's copy exactly.
const CellType CELL_TYPES[TOTAL_CELLS] = {
  BLANK,  BLANK, TRIVIA, BLANK,   // cells 1-4
  BLANK,  VR,    BLANK,  TRIVIA,  // cells 5-8
  BLANK,  BLANK, VR,     BLANK,   // cells 9-12
  TRIVIA, BLANK, BLANK,  VR,      // cells 13-16
  BLANK,  TRIVIA,BLANK,  BLANK    // cells 17-20
};

// ============================================================
// COLORS
// ============================================================
CRGB BLANK_COLOR  = CRGB(50, 50, 50);   // dim white ("nothing")
CRGB TRIVIA_COLOR = CRGB(255, 200, 0);  // yellow
CRGB VR_COLOR     = CRGB(255, 0, 0);    // red
CRGB PLAYER_COLOR = CRGB(0, 80, 255);   // blue
CRGB BLACK        = CRGB(0, 0, 0);

// ============================================================
// PLAYER SHAPE — a plus/cross icon, centered in the 5x4 cell.
// Vertical bar down the center column (col 2, all 4 rows) +
// a horizontal arm 1 pixel to each side.
// ============================================================
#define PLAYER_POINTS 6
const int PLAYER_SHAPE[PLAYER_POINTS][2] = { // {dx, dy} within the cell
  {1, 1}, {2, 1},  // vertical bar
  {1, 2}, {2, 2},
  {1,3},{2,3}                   // horizontal arms
};

// ============================================================
// GAME STATE
// ============================================================
int playerCell = 1;

// ============================================================
// CELL -> TOP-LEFT PIXEL
// ============================================================
void cellTopLeft(int cellNum, int &col0, int &row0) {
  cellNum = constrain(cellNum, 1, TOTAL_CELLS);
  int index = cellNum - 1;
  int cellRow = index / CELLS_ACROSS;   // 0 (bottom) .. CELLS_DOWN-1 (top)
  int cellCol = index % CELLS_ACROSS;

  if (cellRow % 2 == 1) cellCol = (CELLS_ACROSS - 1) - cellCol; // serpentine

  int physRow = (CELLS_DOWN - 1 - cellRow) * CELL_H;
  int physCol = cellCol * CELL_W;

  if (FLIP_H) physCol = (GRID_COLS - CELL_W) - physCol;
  if (FLIP_V) physRow = (GRID_ROWS - CELL_H) - physRow;

  col0 = physCol;
  row0 = physRow;
}

// ============================================================
// DRAWING
// ============================================================
void setPixel(int col, int row, CRGB color) {
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return;
  canvas[row][col] = color;
}

CRGB colorForType(CellType t) {
  if (t == TRIVIA) return TRIVIA_COLOR;
  if (t == VR) return VR_COLOR;
  return BLANK_COLOR;
}

void clearCanvas() {
  for (int y = 0; y < GRID_ROWS; y++)
    for (int x = 0; x < GRID_COLS; x++)
      canvas[y][x] = BLACK;
}

void drawCellBackground(int cellNum) {
  int col0, row0;
  cellTopLeft(cellNum, col0, row0);
  CRGB color = colorForType(CELL_TYPES[cellNum - 1]);
  for (int y = 0; y < CELL_H; y++)
    for (int x = 0; x < CELL_W; x++)
      setPixel(col0 + x, row0 + y, color);
}

void drawAllCells() {
  for (int c = 1; c <= TOTAL_CELLS; c++) drawCellBackground(c);
}

void drawPlayer() {
  int col0, row0;
  cellTopLeft(playerCell, col0, row0);
  for (int i = 0; i < PLAYER_POINTS; i++) {
    setPixel(col0 + PLAYER_SHAPE[i][0], row0 + PLAYER_SHAPE[i][1], PLAYER_COLOR);
  }
}

void drawBoard() {
  drawAllCells();
  drawPlayer();
  leds.show();
}

// ============================================================
// MOVEMENT — steps one cell at a time so the move is visible
// ============================================================
void movePlayerTo(int targetCell) {
  targetCell = constrain(targetCell, 1, TOTAL_CELLS);
  int dir = (targetCell > playerCell) ? 1 : -1;
  while (playerCell != targetCell) {
    playerCell += dir;
    drawBoard();
    delay(300);
  }
  drawBoard();
}

// ============================================================
// FLASH — landed on trivia/vr, signal "waiting for input"
// ============================================================
void flashCurrentCell(CRGB color, int times = 4) {
  int col0, row0;
  cellTopLeft(playerCell, col0, row0);

  for (int i = 0; i < times; i++) {
    for (int y = 0; y < CELL_H; y++)
      for (int x = 0; x < CELL_W; x++)
        setPixel(col0 + x, row0 + y, color);
    drawPlayer();
    leds.show();
    delay(150);

    drawBoard();
    delay(150);
  }
}

// ============================================================
// WIN
// ============================================================
void winFlash() {
  for (int i = 0; i < 4; i++) {
    clearCanvas();
    leds.show();
    delay(150);
    drawBoard();
    delay(150);
  }
}

// ============================================================
// SERIAL PROTOCOL (unchanged)
//   <R>       reset - player to cell 1
//   <M,n>     move to cell n (animated, one cell per step)
//   <F,1>     flash current cell yellow (trivia pending)
//   <F,2>     flash current cell red (vr pending)
//   <W>       win flash
// ============================================================
String command = "";

void processCommand(String cmd) {
  cmd.trim();
  Serial.print("RX: <"); Serial.print(cmd); Serial.println(">");

  if (cmd == "R") {
    playerCell = 1;
    drawBoard();
    return;
  }

  if (cmd == "W") {
    winFlash();
    return;
  }

  if (cmd.startsWith("M,")) {
    movePlayerTo(cmd.substring(2).toInt());
    return;
  }

  if (cmd.startsWith("F,")) {
    int type = cmd.substring(2).toInt();
    if (type == 1) flashCurrentCell(TRIVIA_COLOR);
    else if (type == 2) flashCurrentCell(VR_COLOR);
    return;
  }
}

void readSerial() {
  while (SERIAL_LINK.available()) {
    char c = SERIAL_LINK.read();
    if (c == '<') command = "";
    else if (c == '>') processCommand(command);
    else command += c;
  }
}

// ============================================================
// SETUP / LOOP
// ============================================================
void setup() {
  Serial.begin(115200);
  SERIAL_LINK.begin(1500000);

  leds.begin();
  leds.setBrightness(BRIGHTNESS);

  playerCell = 1;
  drawBoard();

  Serial.println("ONAMANJI - TEENSY READY (5x4 cells, 20 cells)");
}

void loop() {
  readSerial();
}
